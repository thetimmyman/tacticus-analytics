# Desktop runtime: why Electron for this proof

## Decision

Use Electron as the proof-of-concept shell for a bundled, offline-capable
Linux desktop preview, rather than Tauri or a plain browser tab against a
local server. This is a proof-candidate decision for this draft only; it is
not a commitment to ship Electron (or any shell) as the production desktop
packaging.

## Why Electron was chosen for the proof

- **Packaged Next.js standalone compatibility.** The application already
  builds a `next build` standalone output (`STANDALONE_BUILD=true`). Electron
  can host that output's Node server process directly and point its own
  renderer at a loopback URL with no code changes to the existing React
  tree, routes, or data-fetching layer. This let the proof reuse the real
  `/player-performance` page and its existing client code as-is (see
  `apps/desktop/proof/native-journey.mts`), rather than requiring a second,
  parallel UI implementation.
- **Mature loopback/offline posture.** Electron's `BrowserWindow` plus a
  Node-hosted HTTP gateway gave a straightforward way to enforce the
  loopback-only, signed-transport boundary proven in
  `apps/desktop/proof/loopback-gateway.mjs` and exercised by
  `apps/desktop/proof/loopback-gateway.test.mjs`.
- **Known packaging path.** `dpkg-deb` packaging of a staged Electron +
  Node + native-service bundle (see `apps/desktop/package/stage-linux.mjs`,
  `apps/desktop/package/build-deb.mjs`) is a well-understood, inspectable
  path for a private synthetic preview, without requiring a new build
  toolchain.

These are reasons to use Electron for _this proof_, not a claim that it is
the right production choice. The tradeoffs below (size, memory, startup) are
real costs that a production decision would need to weigh against Tauri or
another shell.

## Measured numbers (this proof, this machine, Linux x64)

All numbers below are single-sample, single-development-machine
observations from the existing proof harness output recorded in
`apps/desktop/proof-readme.md`. They are not benchmarks, not idle-memory
figures, and not cross-platform claims:

| Metric                                      | Observed value       | Source / caveat                                                                                                             |
| ------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Staged runtime inputs (uncompressed)        | ~836 MB              | Before portable PostgreSQL shared libraries and installer overhead; includes upstream ancillary files not stripped for size |
| Native-services cold start                  | ~1.1 s (warm launch) | Single warm-launch sample on one development machine; not a cross-platform or cold-cache benchmark                          |
| Post-render RSS (native services + Next.js) | ~603 MiB summed      | Includes shared pages counted per-process more than once; excludes the verification harness itself                          |
| Post-render RSS (Electron working sets)     | ~658 MiB summed      | Same caveats as above                                                                                                       |

No package-size, cold-start, or RSS numbers were newly measured as part of
this task; the table above restates what the existing proof already
recorded, since this sandbox has no native PostgreSQL/Auth/PostgREST
binaries available to re-run the measurement (see
`apps/desktop/proof/run-all.mjs` output for what was and was not re-executed
here).

## Tauri comparison: explicitly deferred

No Tauri prototype was built for this proof. A real comparison would need,
at minimum:

- A Tauri shell hosting the same standalone Next.js server (or a Tauri-native
  reimplementation of the `/player-performance` data path), built on the
  same machine immediately before/after the Electron build to control for
  machine noise.
- The same four proof gates (loopback/origin enforcement, offline journey,
  restart/checkpoint recovery, component manifest) re-run against the Tauri
  build using the same scripts in `apps/desktop/proof/` and
  `apps/desktop/package/`.
- Package size (installer and extracted), cold-start time (cold cache, not
  just warm), and idle + post-render RSS, each as a multi-sample measurement
  rather than the single samples above.
- A review of which native-service bundling approach (sidecar binaries vs.
  Tauri's own plugin ecosystem) is actually needed for PostgreSQL, Auth, and
  PostgREST, since Tauri's smaller base footprint is usually attributed to
  not bundling a full Chromium/Node runtime — a difference that may matter
  less once native PostgreSQL/Auth/PostgREST processes dominate the bundle.

This work is out of scope for this draft and is tracked as an open item for
whoever owns the production packaging decision.

## Platform scope

This proof claims **Linux x64 only** (built and run on Ubuntu/Arch-family
glibc, GLIBC_2.34-and-above, as recorded in
`apps/desktop/runtime-inputs.json`). Windows and macOS (arm64 and x64) are
explicitly **unclaimed**: no build, no binaries, and no proof scripts have
been run or written for those platforms. `runtime-inputs.json` lists them
under `unverifiedPlatforms` for exactly this reason.

## Redistribution and notices review: open item for the owner

This proof bundles (or, for the proof candidate, is designed to eventually
bundle) third-party native binaries whose licenses allow redistribution but
each carry their own notice obligations:

- **PostgreSQL** — the [PostgreSQL License](https://www.postgresql.org/about/licence/),
  a liberal, OSI-approved license similar to the MIT/BSD family. It requires
  retaining the copyright notice and disclaimer; it does not require source
  distribution or copyleft. `runtime-inputs.json`'s
  `portablePostgresqlCandidate` records the verified source digest for the
  version considered; it does not yet record a notices file for the
  binary distribution produced by `apps/desktop/package/Dockerfile.postgres`.
- **PostgREST** — [MIT](https://github.com/PostgREST/postgrest/blob/main/LICENSE).
  Requires retaining the copyright and permission notice in distributed
  copies.
- **Supabase Auth** and **Node.js** are also MIT-licensed; **Electron** is
  MIT-licensed but itself bundles Chromium and other components under a mix
  of licenses that Electron's own `LICENSES.chromium.html` documents.

None of this has been reviewed for what `THIRD_PARTY_NOTICES.md` needs to
say once (if ever) a packaged bundle is actually redistributed outside this
private, synthetic proof. This is flagged here as an **open item for the
repository owner**: before any packaged artifact leaves this private proof
stage, the notices file should be checked against the actual bundled
binaries' accompanying license/notice files (not just the project-level
license names recorded in `apps/desktop/package/expected-component-manifest.json`).

## Reproducing the gate evidence

See `apps/desktop/proof-readme.md` for the full experiment setup and
`npm run desktop:proof` (implemented in `apps/desktop/proof/run-all.mjs`)
for the checked-in, runnable proof scripts for each gate, including which
gates could and could not be executed in a given environment and why.
