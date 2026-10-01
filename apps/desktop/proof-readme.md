# Native runtime proof

This is a disposable synthetic compatibility experiment, not an installer or a
complete desktop implementation. The read slice uses the canonical historical
performance orchestrator and source SQL bodies. Each installation owns separate
PostgreSQL data, Auth subjects and JWT keys. Hosted migrations are not replayed.

`local-schema/manifest.json` pins every selected canonical statement and source
file by hash. `authority.sql` describes deliberate local constraints and grants.
The cluster aggregate uses an invoker view so a normal caller cannot read another
workspace through an unscoped materialized view. Aggregate definers have a
non-login, non-bypass owner, not the database superuser. Player authority remains
behind the canonical attestation resolver; no game-account claims are created.

Native binaries and generated passwords stay outside source control. The first
Linux exercise uses verified upstream Auth/PostgREST releases and an extracted
signed PostgreSQL package. Its shared libraries still need portability packaging.
No platform or redistribution approval follows from a successful local run.

## Run the experiment

Build the application with `NEXT_PUBLIC_RUNTIME_PROFILE=desktop` and
`STANDALONE_BUILD=true`. Build-time public Supabase settings must use a disposable
loopback URL and the placeholder key `desktop-public`; never copy a hosted env
file into the proof. Stage the standalone output and its assets once:

```sh
node apps/desktop/proof/stage-standalone.mjs /absolute/private/staged-application
node --conditions=react-server --import tsx apps/desktop/proof/native-journey.mts /absolute/private/config.json
node apps/desktop/proof/checkpoint-journey.mjs /absolute/private/config.json
```

The configuration supplies absolute paths for `state`, `schemaDirectory`,
`evidence`, and `binaries` (`initdb`, `postgres`, `psql`, `auth`, `authCwd`,
`postgrest`). Optional `application` supplies `node`, `directory`, `electron`,
`shell`, `screenshot`, and `rendererEvidence`. All paths belong to private,
disposable storage. The renderer exercise currently requires a Linux Wayland
session. Run it inside a loopback-only network namespace to establish the offline
claim; the harness alone does not remove the host's external networking.

The test harness uses checkout dependencies and `tsx`. The staged application
itself runs with the supplied Node binary, native services and local assets.
This separation leaves an end-user launcher and installation test outstanding.

## Observed scope

The real historical-performance API and hydrated player-performance page use
native Auth/PostgREST/PostgreSQL and a persisted eight-row synthetic fixture.
Expected scores are +58.33% versus guild and +26.67% versus cluster, with four
tokens, guild rank 1 and cluster rank 2. The renderer shows both synthetic players
(+58% and -50%), exposes no Node globals, and has no unexpected failed requests
or console errors. A member's officer-only token request remains forbidden.
Local health executes actual database and calculation RPCs and Auth health;
hosted sync controls and telemetry do not mount in the desktop profile.

Negative controls cover missing transport authorization, foreign Origin,
anonymous reads, foreign-guild reads (raw and definer), privileged authority RPC
access, absent RPC, missing player, malformed fixture, import rollback, duplicate
instance, service crash, incompatible schema, restart and stopped-state restore.
Recovery retains the same installation identity; rekeying into a new installation
is unproven. Only this selected page and API closure is exercised.

The staged runtime inputs occupy approximately 836 MB uncompressed before
portable PostgreSQL libraries and installer overhead. This includes upstream
ancillary files and is not an optimized installation-size claim. Whole-stack
idle memory, cold/warm timing, additional platforms and equivalent-service Tauri
measurements remain experimental. `runtime-inputs.json` records the verified
binary inputs and remaining packaging gates.

A warm native-services launch measured about 1.1 seconds. One post-render sample
recorded approximately 603 MiB summed RSS for the native services and Next.js,
plus 658 MiB summed Electron working sets. These are a single development-machine
observation, include shared pages more than once, and exclude the verification
harness; they are not idle memory or cross-platform benchmark results.
