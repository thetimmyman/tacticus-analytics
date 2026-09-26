#!/usr/bin/env bash
# Scan a pushed image with a pinned, checksum-verified Trivy CLI (trivy-action is
# disallowed); a tampered asset fails closed. Usage: trivy-scan-image.sh <image-ref>
# Env: TRIVY_ENFORCE (only `warn` downgrades), TRIVY_IGNOREFILE, TRIVY_DOWNLOAD_BASE.
set -euo pipefail

readonly TRIVY_VERSION="0.70.0"
readonly TRIVY_ASSET_AMD64="trivy_0.70.0_Linux-64bit.tar.gz"
readonly TRIVY_ASSET_ARM64="trivy_0.70.0_Linux-ARM64.tar.gz"
# From trivy_0.70.0_checksums.txt in the official v0.70.0 release.
readonly TRIVY_SHA256_AMD64="8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9"
readonly TRIVY_SHA256_ARM64="2f6bb988b553a1bbac6bdd1ce890f5e412439564e17522b88a4541b4f364fc8d"

ignorefile="${TRIVY_IGNOREFILE:-.trivyignore}"
download_base="${TRIVY_DOWNLOAD_BASE:-https://github.com/aquasecurity/trivy/releases/download}"

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo "usage: $0 <image-ref>" >&2
  exit 2
fi
image_ref="$1"
if [[ ! "$image_ref" =~ ^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$ ]]; then
  echo "::error::expected a complete immutable image@sha256:<64 lowercase hex> reference" >&2
  exit 2
fi

if [[ ! -f "$ignorefile" ]]; then
  echo "::error::Trivy ignorefile '$ignorefile' not found; refusing to scan without the committed allowlist" >&2
  exit 1
fi

case "$(uname -m)" in
x86_64 | amd64)
  platform="linux/amd64"
  asset="$TRIVY_ASSET_AMD64"
  expected_sha256="$TRIVY_SHA256_AMD64"
  ;;
aarch64 | arm64)
  platform="linux/arm64"
  asset="$TRIVY_ASSET_ARM64"
  expected_sha256="$TRIVY_SHA256_ARM64"
  ;;
*)
  echo "::error::unsupported runner architecture '$(uname -m)' for the pinned Trivy release" >&2
  exit 1
  ;;
esac

if [[ "${TRIVY_ENFORCE:-enforce}" == "warn" ]]; then
  exit_code=0
else
  exit_code=1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "::error::curl is required to download the pinned Trivy release" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
archive="$work_dir/$asset"
url="$download_base/v$TRIVY_VERSION/$asset"

if ! curl --fail --silent --show-error --location \
  --retry 3 --retry-delay 2 --output "$archive" "$url"; then
  echo "::error::failed to download Trivy $TRIVY_VERSION from $url; failing closed" >&2
  exit 1
fi

if ! printf '%s  %s\n' "$expected_sha256" "$archive" | sha256sum --check --status -; then
  echo "::error::Trivy $TRIVY_VERSION checksum mismatch for $asset; refusing to run an unverified scanner" >&2
  exit 1
fi

if ! tar -xzf "$archive" -C "$work_dir" trivy; then
  echo "::error::failed to extract Trivy $TRIVY_VERSION from $asset" >&2
  exit 1
fi
chmod +x "$work_dir/trivy"

# Fixable CVEs only, committed allowlist; any scanner or registry error fails closed even in warn mode.
set +e
"$work_dir/trivy" image \
  --platform "$platform" \
  --severity CRITICAL \
  --ignore-unfixed \
  --ignorefile "$ignorefile" \
  --exit-code "$exit_code" \
  "$image_ref"
status=$?
set -e

if ((status != 0)); then
  if ((exit_code == 0)); then
    echo "::error::Trivy scan of $image_ref failed (exit $status) in warn mode; scanner and download errors always fail closed" >&2
  else
    echo "::error::Trivy scan of $image_ref reported CRITICAL findings or failed (exit $status)" >&2
  fi
  exit "$status"
fi
