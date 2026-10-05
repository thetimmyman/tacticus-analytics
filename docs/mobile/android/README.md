# Native Android preview

This is an installed local app with native Views, private SQLite and Android Keystore. It reads complete sanitized Player roster/inventory/progress and retained Guild/Raid responses offline, provides paginated native inspection and integer raid calculations, and records manual unverified raids. It has no hosted login or embedded website. This preview is not a qualified release or full application port.

Requirements for the reproducible Linux build: JDK 17, official Android command-line tools, Android SDK API 35/build-tools 35.0.0, curl, unzip, Python 3 and ripgrep. Set `JAVA_HOME`, `ANDROID_HOME` and add the SDK tools to PATH. Gradle 8.13 is downloaded outside the repository and checked against its pinned SHA-256. Maven artifacts use committed Gradle dependency verification. Review dependency updates before changing those hashes.

```bash
apps/mobile/android/scripts/prepare-sdk.sh 35
apps/mobile/android/scripts/build.sh
apps/mobile/android/scripts/emulator-check.sh 35
apps/mobile/android/scripts/prepare-sdk.sh 26
apps/mobile/android/scripts/emulator-check.sh 26
```

The emulator runner requires working acceleration and a free emulator port. `ANDROID_TEST_EMULATOR_PORT` selects another port. It creates and removes its own temporary AVD, resets only the synthetic preview package on an emulator, installs the compiled APK/test APK, enables airplane mode, tests native storage/security, force-stops/relaunches and records source/artifact-bound observations plus platform-evidence/v1 records for offline-core and restart-persistence. The test APK digest identifies the synthetic fixture recipe; dirty source observations are classified as harness self-tests. Hosted checkout uses the exact PR head, not a synthetic merge commit. It refuses physical-device resets. Raw emulator/device logs are temporary and excluded from uploaded evidence; canary leakage fails the runner.

Development APK: `app/build/outputs/apk/debug/app-debug.apk`, package `com.tacticusanalytics.mobile.preview`. Install with the standard Android SDK `adb install -r` command or an authorized system installer. This separate package is developer signed; its signing identity does not prove an owner release. Release builds default to unsigned APK/AAB under `app/build/outputs/apk/release` and `app/build/outputs/bundle/release`. Do not install or distribute them as qualified releases.

First launch requires Player scope plus observed-name confirmation for new personal content. Guild/Raid are optional; one key may grant all scopes and separate optional keys are supported. No stable Player ID is supplied upstream. A different Player display name or Guild ID does not silently mix data. Missing optional access leaves that capability unavailable. Replacing Player access invalidates old optional live references; changing Guild access invalidates old Raid binding. Scoped Guild disconnect also disconnects Raid live access, while retaining historical data. Disconnect deletes local credential files/references, cancels scheduled refresh and revokes contribution queues while keeping local data.

Portable export is `mobile-workspace/v1` for roster/resources/manual raids. Full local export is `android-local-backup/v1`, a secret-free JSON backup of complete retained data, including inventory/progress. Its SHA-256 detects accidental corruption, not authenticity. Both contain personal data and should be kept private. Export/import uses Android's system document picker; there is no broad storage permission. Imports require an explicit replacement confirmation and become historical with no verified capability or copied consent. Synthetic imports stay in the isolated demo slot. Three prior local checkpoints are retained; restoration requires fresh access checks afterward.

The DB is schema v1. Unknown versions fail closed and preserve existing files; there is no destructive migration or downgrade. An update with the same package/signing identity retains private data; a changed identity cannot replace the install. Uninstall removes app-private data and Keystore material; user-selected exported files remain under the user's control. Reinstall requires fresh keys. Back up with the full local export before rollback: Android generally refuses lower version codes, and schema downgrades remain unsupported. Portable core export alone does not preserve all native data.

Scheduled official refresh starts off. The user must explicitly enable it after Player verification; it runs no more frequently than every six hours, only while idle, charging and on an unmetered network. It uses the fixed official API and native vault, never cloud contribution. Android can postpone or stop it. After a device restart, explicitly enable scheduled reads again; failed access pauses scheduling. Disable or disconnect cancels it. Foreground local operation needs no background process.

Cloud contribution remains off and unavailable pending the independent authority/transport integration. Local revocation advances the generation and purges queued work. No telemetry/crash SDK or cloud upload is configured. The privacy boundary and qualification gaps are in [acceptance.md](acceptance.md); module support is in [modules.md](modules.md).

The secret-free PR workflow is `platform-android.yml`. Owner signing is a separate manual-only `platform-android-release.yml`, restricted to main and a protected environment with existing owner inputs. Credential and document operations require a secure device screen lock and the current unlocked OS session; background refresh pauses when locked. No workspace password is collected.

The installed-check scripts require ripgrep, Python 3 and KVM. Hosted PR jobs install ripgrep explicitly. Secure-lock setup checks the emulator command result and the installed native guard; an unavailable GateKeeper service is a failed environment check, never synthetic authorization.
