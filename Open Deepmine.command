#!/bin/sh
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export PATH
here=$(CDPATH= cd -P "$(dirname "$0")" && pwd -P) || exit 1
exec /bin/sh "$here/open-deepmine.sh" "$@"
