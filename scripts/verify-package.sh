#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber

# Assert the tarball carries everything the module imports at runtime.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
ARCHIVE=${1:-$ROOT/dist/drums-practice-module.tar.gz}
test -f "$ARCHIVE"

LIST=$(tar -tzf "$ARCHIVE")
for entry in \
  drums-practice/module.json \
  drums-practice/ui.js \
  drums-practice/dsp.so \
  drums-practice/help.json \
  drums-practice/exercises/index.json \
  drums-practice/LICENSE \
  drums-practice/THIRD-PARTY-NOTICES.md
do
  echo "$LIST" | grep -qx "$entry" || { echo "missing from package: $entry" >&2; exit 1; }
done

# The siblings are stamped per build, so check by count rather than by name —
# and the count is READ from package.sh's MODULES, not restated here, so adding
# a module cannot leave this check asserting last month's number.
EXPECT=$(sed -n 's/^MODULES="\(.*\)"$/\1/p' "$(dirname "$0")/package.sh" | wc -w | tr -d ' ')
MJS=$(echo "$LIST" | grep -c '/[A-Za-z0-9_]*-[0-9][0-9]*\.mjs$' || true)
[ "$MJS" -eq "$EXPECT" ] || { echo "expected $EXPECT stamped modules, found $MJS" >&2; exit 1; }

# Every relative import, from any packaged file, must resolve to a packaged
# file — and must carry this build's stamp. An unstamped sibling would be
# served from QuickJS's runtime-lifetime module cache by whatever version of
# this module was opened first, and link against stale exports.
TMPD=$(mktemp -d)
tar -xzf "$ARCHIVE" -C "$TMPD"
MODDIR="$TMPD/drums-practice"
for f in "$MODDIR/ui.js" "$MODDIR"/*.mjs; do
  for imp in $(sed -n "s/.*from '\.\/\([A-Za-z0-9_-]*\.mjs\)'.*/\1/p" "$f"); do
    if [ ! -f "$MODDIR/$imp" ]; then
      echo "$(basename "$f") imports $imp, which is not in the package" >&2
      rm -rf "$TMPD"; exit 1
    fi
    case "$imp" in
      *-[0-9]*.mjs) ;;
      *) echo "$(basename "$f") imports unstamped $imp — it would be served from a stale cache" >&2
         rm -rf "$TMPD"; exit 1 ;;
    esac
  done
done
rm -rf "$TMPD"

# Every exercise the manifest names must be in the archive.
for file in $(sed -n 's/.*"file": *"\([^"]*\)".*/\1/p' "$ROOT/src/exercises/index.json"); do
  echo "$LIST" | grep -qx "drums-practice/exercises/$file" || { echo "manifest names $file, not packaged" >&2; exit 1; }
done

# macOS AppleDouble forks must never ship.
if echo "$LIST" | grep -q '/\._'; then
  echo "AppleDouble junk in package (set COPYFILE_DISABLE=1):" >&2
  echo "$LIST" | grep '/\._' >&2
  exit 1
fi

echo "package ok: $(echo "$LIST" | wc -l | tr -d ' ') entries"
