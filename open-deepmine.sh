#!/bin/sh
here=$(CDPATH= cd -P "$(dirname "$0")" && pwd -P) || exit 1
# Finder and other desktop launchers often start without the interactive
# shell's Homebrew, Volta or nvm paths. Try the user's active Node first.
for runtime in node /opt/homebrew/bin/node /usr/local/bin/node \
    "${VOLTA_HOME:-$HOME/.volta}/bin/node" "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin/node; do
  if "$runtime" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" 2>/dev/null; then
    case "$runtime" in
      */*) PATH="${runtime%/*}:$PATH"; export PATH ;;
    esac
    exec "$runtime" "$here/scripts/open-mine.cjs" "$@"
  fi
done
echo 'Install Node.js 20 or newer from https://nodejs.org/ then open Deepmine again.' >&2
exit 1
