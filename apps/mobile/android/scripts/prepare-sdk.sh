#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
API=${1:-35}
[[ "$API" == 26 || "$API" == 35 ]] || { printf 'Unsupported test API\n' >&2; exit 1; }
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
[[ -x "$SDKMANAGER" ]] || { printf 'Install official Android command-line tools first\n' >&2; exit 1; }
licenses=$(mktemp)
trap 'rm -f "$licenses"' EXIT
for ((i=0;i<30;i++)); do printf 'y\n' >> "$licenses"; done
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses < "$licenses" > /dev/null
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" 'platform-tools' 'emulator' 'platforms;android-35' 'build-tools;35.0.0' "system-images;android-$API;default;x86_64"
