# Tacticus Analytics

Guild raid, roster and guild war analytics for _Warhammer 40,000: Tacticus_,
built with Next.js and Supabase.

Live app: <https://www.tacticusanalytics.com>

## Setup

```bash
git clone https://github.com/thetimmyman/tacticus-analytics.git
cd tacticus-analytics
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Use Node 22 (see `.nvmrc`) and npm 10.9.7. At minimum, configure:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Never commit `.env.local`, service-role keys, client secrets, or user exports.

### Run the web app with Docker Compose

The optional local Compose file runs only the Next.js web app and Redis. It
does not start Supabase or provide database credentials. Install Docker with
the Compose plugin. If you use the repository's local Supabase CLI stack,
install Node 22 and npm 10.9.7 on the host as well.

Start or connect to a Supabase instance first, then copy the local environment
template and replace both key placeholders with that instance's actual keys:

```bash
cp .env.compose.example .env.local
# Edit .env.local; never commit it.
```

For the repository's local Supabase CLI instance, `npm run supabase:start` and
`npm run supabase:status` run on the host. Use the reported anon and service
role keys in `.env.local`. Keep both Supabase URLs on one of the local hosts
in `.app-identity.json` (`localhost`, `127.0.0.1`, or `host.docker.internal`);
`npm run dev`'s `predev` identity check rejects any other host, including a
remote `*.supabase.co` project, before Next.js starts.

On a brand-new Supabase CLI database, the CLI's own migration pass cannot
get past migration version `20260831150100`, which revokes `PUBLIC`'s
`SELECT` on `pg_catalog.pg_db_role_setting`: the CLI's postgres image makes
`supabase_admin`, not `postgres`, the owner of that relation, and the
migration's verify block checks the relation's actual owner
(`pg_class.relowner`) rather than which role executes the migration, so no
choice of migration-executing role changes the outcome. That check is
intentional (it is the production hardening the migration exists to add)
and is not something this repository can or should work around in the
migration itself.

`npm run supabase:start` therefore does not hand migrations to the CLI.
Instead it starts the CLI stack with its own migration pass and seed
disabled, then applies this repository's migrations itself the same way
the pgTAP and integration test lanes already do (see
`scripts/dev/supabase-start-fresh.sh` and
`scripts/dev/lib/replay-migrations.sh`). That replay prints and skips each
migration listed in `scripts/dev/lib/replay-unappliable.txt` — one
CLI-stack-only failure (the migration above) plus others that depend on
data or objects that exist only in production — as "not applied (known)"
rather than silently, and applies the seed (`supabase/seed.sql`) once the
schema is in place. The result is close to production's schema but not
identical to it. `npm run supabase:status` then reports the usual API URL
and keys.

Running `npm run supabase:start` again against a stack that already has
this repository's migrations applied (still running, or restarted without
`--no-backup`) is a no-op: it detects the existing schema and skips the
replay and seed. `npm run supabase:reset` stops the stack, discards its
data (`--no-backup`), and runs the same fresh-start path, so it also no
longer goes through the CLI's own migration pass.

Launch and stop the web-plus-Redis services with:

```bash
docker compose -f docker-compose.local.yml up
docker compose -f docker-compose.local.yml down
```

Compose installs from the lockfile into the named `node_modules` volume before
starting Next.js, and retains Redis data in a separate named volume. Browser
traffic uses `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`; server-side
traffic uses `SUPABASE_URL=http://host.docker.internal:54321`, mapped to the
host gateway for Linux Compose. Keep these URLs pointed at the same Supabase
instance. Replace the template keys before using authentication or data routes;
placeholder keys and an unreachable Supabase instance do not make the app
functional. Open <http://localhost:3000> in the host browser.

## Common commands

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run security:clean-repo
```

## Deploying

`docker/Dockerfile.prod` builds the production web image. A generic Kubernetes
example for the web tier is in
[examples/kubernetes/README.md](examples/kubernetes/README.md).

## Layout

```text
app/                 Next.js routes, API routes, UI, and auth
packages/            shared application packages
data/game-data/      generated character and item catalogs used by the app
supabase/            migrations, tests, and edge functions
tests/               application tests
```

## Database migrations

New tables, sequences and functions in `public` grant `anon`, `authenticated`
and `analytics_ro` nothing by default; only `service_role` inherits access. A
migration that creates a table must, in the same file, enable row level
security and `GRANT` each role that reads or writes it (column lists where
only some columns are client-safe). A new function needs its own
`GRANT EXECUTE`, and a new serial sequence written by a client role needs
`GRANT USAGE`. `analytics_ro` exists only in production, so grant it inside
`IF to_regrole('analytics_ro') IS NOT NULL`. `npm run lint:sql` enforces the
table rule, and the `default_privileges_no_client_grants` pgTAP suite pins the
defaults.

## Contributing

Pull requests from forks are not merged directly: the CI gates run only for
branches in this repository, so a maintainer re-creates reviewed changes as a
branch here. Report security issues privately; see
[SECURITY.md](.github/SECURITY.md).

## License and notices

**Source-available, not open source.** Copyright (c) 2025-2026 Tacticus
Analytics. All rights reserved; see [LICENSE](LICENSE). You may read the code
and report issues; no licence to use, copy, modify or redistribute it is
granted.

Warhammer 40,000: Tacticus is a trademark of Games Workshop and Snowprint
Studios. This project is unofficial and not endorsed by either. Third-party
material is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
