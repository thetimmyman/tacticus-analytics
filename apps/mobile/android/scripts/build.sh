#!/usr/bin/env bash
set -euo pipefail
APP_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TOOLS_CACHE=${ANDROID_BUILD_TOOLS_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/tacticus-android-tools}
GRADLE_VERSION=8.13
GRADLE_SHA256=20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78
mkdir -p "$TOOLS_CACHE"
if [[ ! -x "$TOOLS_CACHE/gradle-$GRADLE_VERSION/bin/gradle" ]]; then
  archive="$TOOLS_CACHE/gradle-$GRADLE_VERSION-bin.zip"
  curl --fail --location --retry 3 "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip" --output "$archive"
  printf '%s  %s\n' "$GRADLE_SHA256" "$archive" | sha256sum --check --status
  unzip -q -o "$archive" -d "$TOOLS_CACHE"
fi
if (($# == 0)); then set -- :app:assembleDebug :app:assembleDebugAndroidTest :app:assembleRelease :app:bundleRelease :app:lintDebug :app:lintRelease :app:testDebugUnitTest; fi
exec "$TOOLS_CACHE/gradle-$GRADLE_VERSION/bin/gradle" -p "$APP_ROOT" --no-daemon --console=plain --dependency-verification strict "$@"
