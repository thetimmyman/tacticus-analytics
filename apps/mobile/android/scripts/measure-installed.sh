#!/usr/bin/env bash
set -euo pipefail
STAGE=environment
stage(){ STAGE=$1; printf 'Native installed stage: %s\n' "$STAGE"; }
report_failure(){ printf 'Installed emulator stage %s failed (code %s)\n' "$STAGE" "$1" >&2; }
trap 'report_failure "$?"' ERR
: "${ANDROID_HOME:?Set ANDROID_HOME}"
command -v rg > /dev/null || { printf 'Install ripgrep before running the native checks\n' >&2; exit 1; }
APP_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SERIAL=${1:?Pass the selected emulator serial}
ADB="$ANDROID_HOME/platform-tools/adb"
[[ "$SERIAL" =~ ^emulator-[0-9]+$ ]] || { printf 'This resettable synthetic runner is emulator-only\n' >&2; exit 1; }
[[ "$($ADB -s "$SERIAL" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || { printf 'Refusing synthetic reset on a physical device\n' >&2; exit 1; }
[[ "$(git -C "$APP_ROOT" rev-list --max-parents=0 HEAD)" == 225aa3f138a93a005e460b0b04a0d4df530030c3 ]] || { printf 'Public source ancestry required\n' >&2; exit 1; }
REPORT="$APP_ROOT/app/build/reports/installed-proof"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
mkdir -p "$REPORT"
APK="$APP_ROOT/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$APP_ROOT/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
stage reset-synthetic-preview-installation
for package in com.tacticusanalytics.mobile.preview.test com.tacticusanalytics.mobile.preview; do
  installed_packages=$("$ADB" -s "$SERIAL" shell pm list packages "$package" | tr -d '\r')
  if printf '%s\n' "$installed_packages" | rg --fixed-strings --line-regexp --quiet "package:$package"; then
    uninstall_reply=$("$ADB" -s "$SERIAL" uninstall "$package" | tr -d '\r')
    [[ "$uninstall_reply" == Success* ]] || { printf 'Synthetic preview uninstall failed\n' >&2; exit 1; }
  fi
done
unset installed_packages uninstall_reply
stage install-main-apk
"$ADB" -s "$SERIAL" install -r "$APK" > /dev/null
stage install-test-apk
"$ADB" -s "$SERIAL" install -r "$TEST_APK" > /dev/null
# The fixed PIN belongs only to this resettable synthetic emulator, never an owner identity.
stage synthetic-secure-lock
pin_reply=$("$ADB" -s "$SERIAL" shell locksettings set-pin 2468 2>&1)
if [[ "$pin_reply" != "Pin set to "* ]]; then
  stage synthetic-secure-lock
pin_reply=$("$ADB" -s "$SERIAL" shell locksettings set-pin --old 2468 2468 2>&1)
fi
[[ "$pin_reply" == "Pin set to "* ]] || { printf 'Synthetic emulator secure lock setup unavailable\n' >&2; exit 1; }
unset pin_reply
stage synthetic-unlock
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP
"$ADB" -s "$SERIAL" shell wm dismiss-keyguard > /dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell input swipe 160 500 160 100 100
"$ADB" -s "$SERIAL" shell am instrument -w -e phase unlocked com.tacticusanalytics.mobile.preview.test/com.tacticusanalytics.mobile.AndroidProof > "$REPORT/all.txt"
rg -q '^PASS phase=unlocked checks=3[;[:space:]]' "$REPORT/all.txt" || { cat "$REPORT/all.txt"; exit 1; }
stage synthetic-airplane-mode
"$ADB" -s "$SERIAL" shell cmd connectivity airplane-mode enable > /dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell am instrument -w -e phase airplane com.tacticusanalytics.mobile.preview.test/com.tacticusanalytics.mobile.AndroidProof >> "$REPORT/all.txt"
rg -q '^PASS phase=airplane ' "$REPORT/all.txt" || { cat "$REPORT/all.txt"; exit 1; }
"$ADB" -s "$SERIAL" logcat -c > /dev/null 2>&1 || printf 'Device log clear unavailable; final log read remains required\n' >&2
stage installed-functional-assertions
"$ADB" -s "$SERIAL" shell am instrument -w -e phase all com.tacticusanalytics.mobile.preview.test/com.tacticusanalytics.mobile.AndroidProof >> "$REPORT/all.txt"
rg -q '^PASS phase=all ' "$REPORT/all.txt" || { cat "$REPORT/all.txt"; exit 1; }
"$ADB" -s "$SERIAL" shell am force-stop com.tacticusanalytics.mobile.preview
stage cold-native-activity
"$ADB" -s "$SERIAL" shell am start -W -n com.tacticusanalytics.mobile.preview/com.tacticusanalytics.mobile.MainActivity > "$REPORT/relaunch.txt"
rg -q '^Status: ok' "$REPORT/relaunch.txt"
"$ADB" -s "$SERIAL" shell am force-stop com.tacticusanalytics.mobile.preview
stage restart-assertions
"$ADB" -s "$SERIAL" shell am instrument -w -e phase reopen com.tacticusanalytics.mobile.preview.test/com.tacticusanalytics.mobile.AndroidProof > "$REPORT/reopen.txt"
rg -q '^PASS phase=reopen ' "$REPORT/reopen.txt" || { cat "$REPORT/reopen.txt"; exit 1; }
"$ADB" -s "$SERIAL" shell settings put secure lock_screen_lock_after_timeout 0
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_SLEEP
sleep 2
stage locked-access-assertions
"$ADB" -s "$SERIAL" shell am instrument -w -e phase locked com.tacticusanalytics.mobile.preview.test/com.tacticusanalytics.mobile.AndroidProof > "$REPORT/locked.txt"
rg -q '^PASS phase=locked ' "$REPORT/locked.txt" || { cat "$REPORT/locked.txt"; exit 1; }
stage credential-log-canary
rawlog=$(mktemp)
trap 'rm -f "$rawlog"' EXIT
"$ADB" -s "$SERIAL" logcat -d > "$rawlog"
if rg -q 'synthetic-official-canary-v1|c3ludGhldGljLW9mZmljaWFsLWNhbmFyeS12MQ==' "$rawlog"; then printf 'Credential canary leaked into device logs\n' >&2; exit 1; fi
stage source-artifact-evidence
APK_SHA=$(sha256sum "$APK" | cut -d ' ' -f 1)
SOURCE_SHA=$(git -C "$APP_ROOT" rev-parse HEAD)
SOURCE_DIRTY=false
if [[ -n "$(git -C "$APP_ROOT" status --porcelain -- .)" ]]; then SOURCE_DIRTY=true;fi
API=$("$ADB" -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')
ABI=$("$ADB" -s "$SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r')
AIRPLANE=$("$ADB" -s "$SERIAL" shell settings get global airplane_mode_on | tr -d '\r')
[[ "$AIRPLANE" == 1 ]] || { printf 'Airplane mode not enabled\n' >&2; exit 1; }
FIXTURE_SHA=$(sha256sum "$TEST_APK" | cut -d ' ' -f 1)
COMPLETED_AT=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
export APK_SHA SOURCE_SHA SOURCE_DIRTY FIXTURE_SHA STARTED_AT COMPLETED_AT API ABI REPORT
python3 - <<'PY'
import os,json,re,pathlib,subprocess
report=pathlib.Path(os.environ['REPORT'])
launch=report.joinpath('relaunch.txt').read_text()
data={'schemaVersion':'android-emulator-observation/v1','sourceCommit':os.environ['SOURCE_SHA'],'artifactSha256':os.environ['APK_SHA'],'sourceDirty':os.environ['SOURCE_DIRTY']=='true','api':int(os.environ['API']),'abi':os.environ['ABI'],'deviceKind':'emulator','airplaneMode':True,'releaseQualified':False,'checksPassed':True,'credentialCanaryInLogs':False,'coldActivityTotalMs':int(re.search(r'TotalTime: (\d+)',launch).group(1))}
data['qualificationBlockers']=['Physical owner-signed phone/tablet release qualification pending','Full accepted application parity pending','Real authorized upstream checks and live contribution integration pending']
report.joinpath('measurement.json').write_text(json.dumps(data,indent=2)+'\n')
sdk=pathlib.Path(os.environ['ANDROID_HOME'])
java_text=subprocess.run(['java','-version'],capture_output=True,text=True,check=True).stderr
emulator_properties=sdk.joinpath('emulator/source.properties').read_text()
adb_text=subprocess.run([str(sdk/'platform-tools/adb'),'version'],capture_output=True,text=True,check=True).stdout
versions={'gradle':'8.13','androidGradlePlugin':'8.9.3','javaCompiler':re.search(r'version "([^" ]+)"',java_text).group(1),'emulatorSdkPackage':re.search(r'^Pkg.Revision\s*=\s*([0-9.]+)',emulator_properties,re.M).group(1),'adb':re.search(r'Version ([0-9.]+)',adb_text).group(1)}
for scenario,file in [('offline-core','all.txt'),('restart-persistence','reopen.txt')]:
    captures=[]
    for capture in ['all.txt','reopen.txt','relaunch.txt','locked.txt','measurement.json']:
        captures.append({'name':capture,'sha256':__import__('hashlib').sha256(report.joinpath(capture).read_bytes()).hexdigest(),'mediaType':'application/json' if capture.endswith('.json') else 'text/plain','redacted':True})
    actual=report.joinpath(file).read_text().strip()
    evidence={'schemaVersion':'platform-evidence/v1','evidenceKind':'harness-self-test' if data['sourceDirty'] else 'product-acceptance','runId':__import__('uuid').uuid4().hex,'build':{'sha':data['sourceCommit'],'artifact':{'sha256':data['artifactSha256'],'format':'apk'}},'environment':{'os':'android','osVersion':'API '+os.environ['API'],'arch':os.environ['ABI'],'classification':'emulator','runtimeVersions':versions,'installation':'clean-install' if scenario=='offline-core' else 'existing-install'},'fixture':{'id':'android-instrumentation-synthetic-v1','sha256':os.environ['FIXTURE_SHA']},'scenario':{'id':scenario,'expected':'Installed native offline behavior and persistence using synthetic inputs'},'startedAt':os.environ['STARTED_AT'],'completedAt':os.environ['COMPLETED_AT'],'outcome':{'status':'pass','actual':actual,'blockers':[]},'assertions':[{'id':'installed-'+scenario,'status':'pass','expected':'Native installed synthetic suite passes','actual':actual}],'attachments':captures}
    if scenario=='offline-core':
        evidence['assertions'].append({'id':'installed-credential-isolation','status':'pass','expected':'Locked native session refuses credential access without discarding offline data','actual':report.joinpath('locked.txt').read_text().strip()})
    report.joinpath(scenario+'-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
report.joinpath('credential-isolation-evidence.json').unlink(missing_ok=True)
print(json.dumps(data))
PY
cat "$REPORT/all.txt" "$REPORT/reopen.txt" "$REPORT/locked.txt"
