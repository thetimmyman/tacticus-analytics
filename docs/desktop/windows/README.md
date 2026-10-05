# Windows qualification candidate

The candidate adapts the existing Electron, Next standalone, PostgreSQL, Supabase Auth and PostgREST application to Windows x64. It preserves the existing local schema and synthetic graphical journey. It does not establish full application parity or authorize a public release.

The intended consumer target is Windows 11 x64. The workflow exercises Windows Server on standard GitHub-hosted capacity. That evidence cannot establish ordinary standard-user installation, UAC prompts, SmartScreen, antivirus behavior or a consumer Windows host. Other Windows versions and architectures remain unqualified.

## Native ownership and storage

`TacticusDesktop.exe` creates a private Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. It creates the bundled Node process suspended, assigns it before resuming, and terminates it if assignment fails. The job handle is never inherited. Node owns the existing real service and Electron processes; closing or killing their native owner closes the job. The native proof exercises a child and grandchild on normal job close and forced owner death.

The owner rejects reparse paths, applies a protected current-user/SYSTEM ACL to workspace and installation roots, and holds an exclusive OS file handle to prevent concurrent workspace launch. An abandoned process releases this handle without stale PID guessing. PostgreSQL, Auth, REST and the application bind only loopback and choose separate ports. A competing port causes startup failure, rather than binding a public interface. No firewall rule is installed.

Official API input uses Windows CredUI and Credential Manager. The fixed operations are prompt/store, read Player/Guild/Guild Raid from `https://api.tacticusgame.com`, confirm displayed Player and delete a known opaque reference. There is no arbitrary URL, credential enumeration or game-client protocol. Keys never enter renderer input, workspace JSON, backups, diagnostics or Node IPC. Response size, redirects and key echoes are rejected in the native process. Windows vault failures fail closed; there is no plaintext fallback. Managed HTTP header strings cannot be guaranteed erased immediately; native buffers and mutable byte arrays are cleared.

The exact reviewed workspace onboarding v1 guard runs in the device supervisor. Native calls return opaque references and bounded responses; the guard returns projected roster/resources and capability/freshness state. Player validation and user confirmation are required for a new personal experience. Optional scopes can be absent. Offline reopen uses retained projections. This upstream API provides a Player display name rather than independent account ownership proof, and Raid requires same-key Guild access for guild binding. Contribution enrollment requires separate consent. Applying official projections throughout all existing application pages is still an integration gate. The separate demo route contains synthetic data and is not a personal account.

Local PostgreSQL/Auth/REST service material is stored in a distinct Credential Manager target and read only by the supervisor. Temporary initialization/SQL files live under the protected workspace and are deleted after use. Service output is drained without recording bodies; transport configuration reaches Electron over stdin rather than an ordinary JSON file.

## Build and installation

Development builds require Node 22, .NET SDK 10.0.401 and Go 1.27.0. They are build inputs, not end-user prerequisites. The published native host includes the .NET runtime in a single executable. Runtime staging bundles Node 22.23.2, Electron 44.5.1, PostgreSQL 18.6, PostgREST 16.4 and Auth 2.197.0. Archive digests and the exact Auth source commit are pinned in `build-runtime.ps1`; Auth has no upstream Windows release binary and must successfully build from that source. Go module verification runs before compiling it.

The unmodified Auth release fails Windows compilation because its HTTP listener unconditionally calls Unix `SO_REUSEPORT`. The small owned `auth-windows.patch` adapts only that source copy to Windows `SO_EXCLUSIVEADDRUSE`, retaining the service and migrations and avoiding Windows address reuse. The derived version is labeled `2.197.0+windows.1`; it is not an upstream Windows release. [Microsoft socket options](https://learn.microsoft.com/en-us/windows/win32/winsock/using-so-reuseaddr-and-so-exclusiveaddruse) explain the exclusive binding choice.

```powershell
npm ci --no-audit --no-fund
npm run build
./apps/desktop/platform/windows/build-runtime.ps1 -Output "$env:TEMP/Tacticus candidate"
& "$env:TEMP/Tacticus candidate/TacticusDesktop.exe" setup-candidate "$env:TEMP/Tacticus candidate"
```

The native setup prompts before installing into the user's Programs directory, creates a Start menu shortcut and an HKCU uninstall entry, and requests `asInvoker` privileges. It stages exact inventoried files into a new version directory, verifies sizes/digests while reading the same locked file handles, and atomically changes the active pointer only after verification. A failed update leaves the previous pointer intact. The `rollback` operation verifies the previous version before activating it. Schema hash mismatch refuses startup without replacing existing data; arbitrary migrations are not accepted. A transactional schema upgrade with full canonical parity remains a gate.

Uninstall retains the workspace and vault references for reinstall. A temporary single-file helper waits for the installed process to exit before deleting its installation. Its small temporary executable remains for later maintenance; complete cleanup and locked-file recovery require consumer qualification. Workspace deletion is not offered by this candidate.

`install` deliberately refuses production installation because no owner-approved signing identity or signed release trust policy is enrolled. Candidate SHA-256 verification detects substitution against its supplied inventory, and is not publisher authentication. Signed manifest integration, Authenticode verification and malicious signed release qualification are required for production promotion.

## Qualification and remaining acceptance

The workflow builds the native host and runs the adversarial native proof. A separate job builds the complete application, stages the real Windows components, installs the candidate under a space/non-ASCII path and performs the existing graphical synthetic first-launch/restart journey through the installed artifact. Evidence includes source commit, manifest digest, package bytes, timings and explicit candidate/standard-user flags. Failed builds or journeys are failures, not parity evidence.

Portable adapter tests exercise the actual shared onboarding guard with synthetic upstream responses: Player-only access, missing Player, unavailable vault, combined scopes, wrong guild, revoked replacement retaining local data, disconnect and secret-free renderer views. Inventory tests reject mutable state and package links. These are adapter tests, not claims of native CredUI automation or live API validation.

Native common file dialogs implement projection export and historical import. Export strips vault references by taking the guard's public projection; native validation refuses credential-bearing fields and applies a current-user/SYSTEM ACL to the chosen file. Import uses a bounded same-handle read and preserves its historical/offline status rather than claiming new verified Player access. The optional-scope UI accepts separate keys or rechecks the connected Player key and provides explicit disconnect. Interactive file dialogs and secure prompts still require consumer-host testing.

The installed recovery journey exercises the real components after the synthetic graphical import: a failed SQL transaction, Auth crash stopping the stack, restart retaining canonical rows, incompatible schema rejection before services, and stopped-database checkpoint/restore under the same workspace/vault binding. PostgreSQL attempts a fast `pg_ctl` stop before termination. Fresh-install identity transfer, arbitrary backup imports and full transactional schema upgrades remain separate gates.

The full accepted feature matrix remains open. Required external or integration gates include consumer standard-user install/uninstall and signing identity; SmartScreen/antivirus and locked files; suspend/resume; native file chooser and export/backup/restore; token expiry and interrupted migrations; full local schema/extensions and application feature parity; official projection integration and progressive separate-key UI; license/redistribution and complete bundled notices; release-manifest trust and real module/broker integration. Hosted native proof cannot replace these measurements.

Primary implementation references: [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [suspended process assignment](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject), [CredUI](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-creduipromptforcredentialsw), [PostgreSQL Windows distribution](https://www.postgresql.org/download/windows/), and [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core).
