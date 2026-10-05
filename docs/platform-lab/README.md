# Platform lab

The lab runs explicitly supplied installed-product adapters against synthetic fixtures and writes private, hash-bound evidence. It supplies environments and orchestration; platform applications and packaging belong to their adapters. Run with Node 22.23.x:

```sh
node --test tests/platform-lab/*.test.mjs
node apps/platform-lab/cli.mjs inventory /absolute/private/inventory.json
node apps/platform-lab/cli.mjs fixture /absolute/private/fixture.json
node apps/platform-lab/cli.mjs run /absolute/private/plan.json
node apps/platform-lab/cli.mjs reset /absolute/private/lab/platform-lab-generated
```

Use a dedicated private directory. The runner creates a random workspace with a private owner marker and keeps state, fixtures, captures, snapshots and evidence beneath it. Reset requires the matching marker and owner, refuses symlinks and active run locks, removes only disposable state/fixtures/snapshots, and retains evidence and captures. It never uses an application's default data directory. A lock is never removed by guessing whether its owner process has died; inspect the disposable workspace before manually recovering a stale run. State snapshots and restores also require an idle workspace lock; stop the disposable application before taking or restoring them.

The private plan uses `platform-plan/v1` with `evidenceKind`, `build` (`sha`, `artifactPath`, `format`), `environment` from the evidence contract, `labRoot`, the complete `fixture`, an array of scenario IDs and nullable `adapter`. An adapter contains its absolute `modulePath` and optional `options`. Modules export either a `platform-adapter/v1` default object or `createAdapter(options)`. Explicitly select trusted adapters: they execute application and host operations with the caller's privileges. Do not load adapters from imports or downloaded replay data.

```js
const plan = {
  schemaVersion: 'platform-plan/v1',
  evidenceKind: 'product-acceptance',
  build: {
    sha: '<full-public-build-commit>',
    artifactPath: '/absolute/private/installer',
    format: 'pkg.tar.zst'
  },
  environment: {
    os: 'linux',
    osVersion: '<observed-version>',
    arch: 'x64',
    classification: 'physical',
    installation: 'existing-install',
    runtimeVersions: { node: '22.23.2' }
  },
  labRoot: '/absolute/private/lab',
  fixture: {
    /* complete platform-fixture/v1; use deny mode for Linux regression */
  },
  scenarios: ['offline-core', 'restart-persistence', 'backup-restore'],
  adapter: {
    modulePath: '/absolute/checkout/apps/platform-lab/linux-installed.mjs',
    options: { runtimeRoot: '/absolute/installed/application' }
  }
}
```

Build identity must come from reviewed build provenance. The lab computes the supplied artifact digest; the platform owner must independently establish that the installed files correspond to that artifact. The Linux adapter operates a caller-supplied existing installation through its supported `--state` and `--verify` entry points. It requires a graphical session, util-linux `unshare` and `ip`; kernel isolation checks that only loopback interfaces exist before launch. The installed preview's bundled runtime executes the application. Developer tools are required by this harness and do not establish an ordinary-user clean-install pass.

The Linux regression covers the preview's selected synthetic calculation slice, ordinary restart and stopped-state backup/restore. It does not establish full feature parity, new onboarding capability verification, signing, bad-update recovery, token expiry, suspend, real-device mobile behavior or secret-integration egress. A passing record's `actual` states this scope. Unsupported scenarios produce blocked records and a nonzero CLI exit. No scenario is silently skipped.

Fixture mode serves only declared loopback routes, rejects other routes and records bounded counters without request headers. Deny and allow-list modes are adapter enforcement requirements. Fixture clocks are adapter inputs, not host clock changes; expiry needs an observed application result. Platform-specific suspend/background, storage quota/full-device, fault, upgrade and uninstall operations must be implemented by their owning platform adapters. `boundedDiskPressure` is limited to 64 MiB of disposable data and must never be described as proof of a full disk unless a disposable filesystem quota is independently enforced.

`disposableVmImage` creates a small empty qcow2 image and can snapshot/restore only `state/guest.qcow2` inside a marked workspace. This tests snapshot orchestration, not a Windows guest or licensed OS image. QEMU image locking prevents concurrent mutation by a running guest. OS image rights and an approved clean guest remain separate gates. macOS virtualization is restricted to authorized Apple hardware; iOS Simulator requires Xcode on such a host. Physical release-build testing remains mandatory for Android and iOS.

Captures must already be redacted by the adapter. Canary checks reject literal, URI, hexadecimal, base64 and base64url forms plus common nested encodings before records or returned textual captures are saved. This bounded scanner does not prove that arbitrary unknown secrets are absent. Raw platform diagnostics and screenshots remain private and must be separately reviewed before sharing. Never commit private plans, inventories, captures or real device identities.

See [contract v1](contract-v1.md) and [qualification matrix](matrix.md) for cross-platform handoff. GitHub-hosted CI runs harness self-tests on Linux, Windows and macOS; these results do not qualify packaged applications or physical devices.
