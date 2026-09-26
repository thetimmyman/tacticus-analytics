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

## Common commands

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run security:clean-repo
```

## Layout

```text
app/                 Next.js routes, API routes, UI, and auth
packages/            shared application packages
data/game-data/      generated character and item catalogs used by the app
supabase/            migrations, tests, and edge functions
tests/               application tests
```

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
