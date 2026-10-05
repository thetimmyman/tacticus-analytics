#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME}"
API=${1:-35}
[[ "$API" == 26 || "$API" == 35 ]] || exit 1
APP_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
AVD_TMP=$(mktemp -d)
export ANDROID_AVD_HOME="$AVD_TMP"
EMULATOR="$ANDROID_HOME/emulator/emulator"
ADB="$ANDROID_HOME/platform-tools/adb"
PORT=${ANDROID_TEST_EMULATOR_PORT:-5554}
[[ "$PORT" =~ ^[0-9]+$ ]] || exit 1
SERIAL="emulator-$PORT"
[[ -z "$("$ADB" devices | rg "^${SERIAL}[[:space:]]" || true)" ]] || { printf 'Selected emulator port is already occupied\n' >&2; exit 1; }
cleanup(){ "$ADB" -s "$SERIAL" emu kill > /dev/null 2>&1 || true; rm -rf "$AVD_TMP"; }
trap cleanup EXIT
printf 'no\n' | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd --name mobile_synthetic_check --package "system-images;android-$API;default;x86_64" --path "$AVD_TMP/check" > /dev/null
"$EMULATOR" -accel-check
"$EMULATOR" -avd mobile_synthetic_check -port "$PORT" -no-window -no-audio -no-boot-anim -gpu swiftshader -no-snapshot -memory 2048 -cores 2 > "$AVD_TMP/emulator.log" 2>&1 &
booted=false
for ((i=0;i<120;i++)); do
  if [[ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then booted=true;break;fi
  sleep 2
done
[[ "$booted" == true ]] || { printf 'Android emulator did not boot within the bounded wait\n' >&2; exit 1; }
"$APP_ROOT/scripts/measure-installed.sh" "$SERIAL"
