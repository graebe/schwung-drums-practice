#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# The files this module shares with Piano Practice, which holds the canonical
# copies, must be those copies byte for byte:
#
#   dsp/ni-sampler          the recorded-instrument player and its format
#   dsp/schwung-plugin/src  the Schwung ABI binding
#   samples/click.*         the metronome pack, its manifest and report
#   samples/LICENSES/CC0-1.0.txt
#   src/pathmap             the Path map engine, and its tests/pathmap_*.test.mjs
#   src/home                the home screen's circles, and tests/home_*.test.mjs
#   tools/screen_buffer.mjs the preview and test screen, the Move's font in full,
#                           and tests/screen_font.test.mjs
#
#   scripts/check-vendored.sh [<piano-practice checkout>] [<ref>]
#
# The checkout defaults to the sibling of this repository's main checkout
# (schwung-pinao-practice beside schwung-drums-practice), the ref to main.
# Name the ref to check against a branch that is not merged yet: the shared
# scene player (src/pathmap/scenes.mjs) and the beaded sticks icon exist in
# Piano Practice only on feature/piano-followups until it merges, so until
# then run
#   scripts/check-vendored.sh <piano checkout> feature/piano-followups
# Each file is compared by its git blob id, the Git LFS pointer for a pack, so
# a pack is checked without its objects. A local, deliberate check: run it
# whenever either side changes, and before a release.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
COMMON=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)
PIANO=${1:-$(dirname "$(dirname "$COMMON")")/schwung-pinao-practice}
REF=${2:-main}
git -C "$PIANO" rev-parse --verify --quiet "$REF^{commit}" >/dev/null \
  || { echo "check-vendored: no $REF in $PIANO" >&2; exit 1; }

FILES=$(cd "$ROOT" && find dsp/ni-sampler/src dsp/ni-sampler/Cargo.toml dsp/schwung-plugin/src -type f | sort)
FILES="$FILES
$(cd "$ROOT" && find src/pathmap src/home -name '*.mjs' -type f | sort)
$(cd "$ROOT" && find tests -name 'pathmap_*.test.mjs' -type f | sort)
$(cd "$ROOT" && find tests -name 'home_*.test.mjs' -type f | sort)
tools/screen_buffer.mjs
tests/screen_font.test.mjs
samples/click.nisp
samples/click.manifest.toml
samples/click.report.txt
samples/LICENSES/CC0-1.0.txt"

bad=0
for f in $FILES; do
  ours=$(cd "$ROOT" && git hash-object --path="$f" "$f")
  theirs=$(git -C "$PIANO" rev-parse --verify --quiet "$REF:$f" || echo missing)
  if [ "$ours" != "$theirs" ]; then
    echo "differs from $PIANO@$REF: $f" >&2
    bad=1
  fi
done
# And nothing there that is missing here.
for f in $(git -C "$PIANO" ls-tree -r --name-only "$REF" -- dsp/ni-sampler dsp/schwung-plugin/src src/pathmap src/home) \
         $(git -C "$PIANO" ls-tree -r --name-only "$REF" -- tests | grep -E '^tests/(pathmap|home)_.*\.test\.mjs$'); do
  [ -f "$ROOT/$f" ] || { echo "missing here: $f" >&2; bad=1; }
done
[ "$bad" = 0 ] || exit 1
echo "vendored: $(echo "$FILES" | wc -l | tr -d ' ') files identical to $PIANO@$REF"
