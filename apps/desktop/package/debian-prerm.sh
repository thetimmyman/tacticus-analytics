#!/bin/sh
set -eu

case "${1:-}" in remove|deconfigure) ;; *) exit 0 ;; esac
profile=/etc/apparmor.d/tacticus-analytics-preview
source=/usr/share/tacticus-analytics-preview/apparmor-profile
if [ ! -L "$profile" ] || [ "$(readlink "$profile")" != "$source" ]; then exit 0; fi
if [ -r /sys/kernel/security/apparmor/profiles ] &&
   grep -q '^tacticus-analytics-preview ' /sys/kernel/security/apparmor/profiles; then
  apparmor_parser -R "$profile"
fi
rm "$profile"
