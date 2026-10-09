#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber

# Deploy to a Move over SSH. Stages beside the live directory and swaps, so a
# failed transfer cannot leave a half-installed module behind.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/src/module.json")
MOVE_HOST=${MOVE_HOST:-move.local}
MOVE_USER=${MOVE_USER:-ableton}
REMOTE_BASE="/data/UserData/schwung/modules/tools"
REMOTE="$REMOTE_BASE/drums-practice"
TOKEN=$$
REMOTE_STAGE="$REMOTE_BASE/.drums-practice.install.$TOKEN"
REMOTE_OLD="$REMOTE_BASE/.drums-practice.old.$TOKEN"
REMOTE_ARCHIVE="/tmp/drums-practice-$TOKEN.tar.gz"

test -f "$ROOT/dist/dsp.so"
# Always repackage: an old tarball left in dist/ would otherwise be deployed
# without a word, and the Move would run code that is not the code here.
"$ROOT/scripts/package.sh"

scp "$ROOT/dist/drums-practice-module.tar.gz" "$MOVE_USER@$MOVE_HOST:$REMOTE_ARCHIVE"
ssh "$MOVE_USER@$MOVE_HOST" sh -s -- \
  "$REMOTE" "$REMOTE_STAGE" "$REMOTE_OLD" "$REMOTE_ARCHIVE" <<'REMOTE_SCRIPT'
set -eu
remote=$1
stage=$2
old=$3
archive=$4

rollback() {
  status=$?
  trap - 0 1 2 15
  rm -rf "$stage" "$old"
  rm -f "$archive"
  exit "$status"
}
trap rollback 0 1 2 15

rm -rf "$stage" "$old"
mkdir -p "$stage"
tar -xzf "$archive" -C "$stage" --strip-components=1

# Keep the player's settings across an update.
if [ -f "$remote/settings.json" ]; then
  cp "$remote/settings.json" "$stage/settings.json"
fi
# And their progress history. Forgetting this would wipe every recorded round
# on the next install, silently, and nobody would notice until they went
# looking for a trend that was no longer there.
if [ -f "$remote/stats.json" ]; then
  cp "$remote/stats.json" "$stage/stats.json"
fi
# Its backup copy, and a damaged file kept aside, travel with it.
for f in stats.bak.json stats.bad.json; do
  if [ -f "$remote/$f" ]; then cp "$remote/$f" "$stage/$f"; fi
done
# Keep any drills they added by hand, AND the manifest that makes them
# visible. Preserving the files alone was not enough: index.json is shipped
# and therefore replaced, so a hand-written drill used to survive an update
# with its entry gone — still on disk, never in the list again.
#
# user.json is never shipped, so anything listed in it is theirs. Copying it
# forward is also what stops a drill this module no longer ships being carried
# along for ever: it is in neither manifest, so it simply does not load.
if [ -f "$remote/exercises/user.json" ]; then
  cp "$remote/exercises/user.json" "$stage/exercises/user.json"
  for f in "$remote/exercises/"*.json; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    [ "$base" = "index.json" ] && continue
    [ -e "$stage/exercises/$base" ] || cp "$f" "$stage/exercises/$base"
  done
fi
chown -R ableton:users "$stage"

if [ -d "$remote" ]; then
  mv "$remote" "$old"
fi
mv "$stage" "$remote"
rm -rf "$old"
REMOTE_SCRIPT

echo "Installed Drums Practice $VERSION. Open it from Schwung Tools."
