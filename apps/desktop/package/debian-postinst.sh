#!/bin/sh
set -eu

if [ "${1:-}" != configure ]; then exit 0; fi
if [ ! -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then exit 0; fi
if [ ! -r /etc/apparmor.d/abi/4.0 ]; then
  if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1 ]; then
    echo 'AppArmor 4 policy support is required while namespace restrictions are enabled.' >&2
    exit 1
  fi
  exit 0
fi
if ! command -v apparmor_parser >/dev/null 2>&1; then
  echo 'The system AppArmor parser is required for the desktop sandbox.' >&2
  exit 1
fi

profile=/etc/apparmor.d/tacticus-analytics-preview
source=/usr/share/tacticus-analytics-preview/apparmor-profile
mkdir -p /etc/apparmor.d
if [ ! -e "$profile" ] && [ ! -L "$profile" ]; then
  ln -s "$source" "$profile"
fi
# Existing administrator policy takes precedence. Package-owned policy lives
# under /usr/share so normal upgrades refresh it without replacing local rules.
apparmor_parser -r "$profile"
