#!/bin/sh
set -eu

case "${1:-}" in remove|purge) ;; *) exit 0 ;; esac
profile=/etc/apparmor.d/tacticus-analytics-preview
source=/usr/share/tacticus-analytics-preview/apparmor-profile
if [ -L "$profile" ] && [ "$(readlink "$profile")" = "$source" ]; then
  rm "$profile"
fi
