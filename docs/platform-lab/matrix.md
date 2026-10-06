# Qualification matrix

Minimum/current OS versions must be pinned by each platform owner to measured installed-artifact evidence. A tool or CI runner does not prove consumer installation. This matrix intentionally leaves unmeasured support declarations open.

| Platform | Required environments                                         | Architecture to qualify                              | Minimum/current OS gate                                                | Current adapter scope                                 |
| -------- | ------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| Linux    | Existing installed regression, clean supported guest          | x64                                                  | Packaged system-library baseline and ordinary install/removal evidence | Selected offline calculation, restart, backup/restore |
| Windows  | Licensed clean VM, snapshot/restore, ordinary install/removal | x64; additional architectures need separate evidence | Licensed image and signed packaged-artifact qualification              | Adapter required                                      |
| macOS    | Authorized Apple host; permitted VM or physical install       | arm64 and x64                                        | Minimum/current OS, signatures and notarization                        | Adapter required                                      |
| Android  | Emulator and physical release-build device                    | arm64; emulator architecture separately recorded     | Platform owner's SDK/OS matrix and package installation                | Adapter required                                      |
| iOS      | Xcode Simulator on Apple host and physical iPhone/iPad        | arm64; simulator architecture separately recorded    | Platform owner's deployment target, signing and device install         | Adapter required                                      |

Private inventories record available environments, image rights, signing access and budget approval without moving device identities into public source. Missing environments produce explicit blocker evidence. VM, emulator and simulator classifications never inherit physical-device qualification. No Apple host, mobile device, Windows image licence or signing access is presumed.

All platform adapters receive the same scenario IDs: clean install, onboarding, offline core operation, restart persistence, token expiry, shutdown recovery, backup/restore, bad update, opt-in egress, suspend/resume, disk pressure, upgrade/rollback and uninstall. Onboarding includes player-only, optional-scope skip, combined/separate scopes, wrong account/guild, partial failure, revoked access, offline creation versus reopen and key replacement. Adapters must supply separate observed assertions for each relevant case; a synthetic upstream fixture alone does not validate real capabilities.

Qualification also requires field-level synthetic-secret canaries, consent revocation and contribution boundaries from the respective application integrations. Game-client secrets and official read credentials remain separate. A client hash or signature does not establish upstream truth.
