#!/bin/sh
set -eu

# Railway uses root for the API so it can access its SQLite volume. Chromium
# must run separately as node, with its sandbox enabled, even in that case.
if [ "$(id -u)" = "0" ]; then
  profile=''
  for arg in "$@"; do
    case "$arg" in --user-data-dir=*) profile="${arg#--user-data-dir=}" ;; esac
  done
  if [ -z "$profile" ]; then
    echo 'Chromium requires an explicit user-data-dir' >&2
    exit 1
  fi
  profile="$(realpath "$profile")"
  case "$profile" in
    /app/.tiktok-profile|/data/*|/tmp/puppeteer_dev_chrome_profile-*) ;;
    *) echo 'Chromium profile must be in an application runtime directory' >&2; exit 1 ;;
  esac
  chown -R node:node "$profile"
  export HOME=/home/node
  export XDG_CONFIG_HOME=/home/node/.config
  export XDG_CACHE_HOME=/home/node/.cache
  exec su-exec node:node /usr/bin/chromium-browser --disable-dev-shm-usage "$@"
fi

exec /usr/bin/chromium-browser --disable-dev-shm-usage "$@"
