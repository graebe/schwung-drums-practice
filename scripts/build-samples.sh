#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# Re-cut the committed kit, samples/drums.nisp, from its pinned source:
# Naked Drums by Wilkinson Audio (CC-BY-4.0), cloned at the commit the pack
# was cut from into the shared dataset cache (~/Library/Caches/neon-ingvy,
# kept across worktrees), through Piano Practice's tools/nisp-build.
#
#   scripts/build-samples.sh [<piano-practice checkout>]
#
# The checkout defaults to the sibling of this repository's main checkout.
# The build is deterministic: the same source and manifest give the same
# bytes, so an unchanged pack shows no diff. The click (samples/click.*) is
# Piano Practice's and is not cut here; scripts/check-vendored.sh keeps it
# identical. Every stage is timed into the shared build-timing log.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/timing.sh
. scripts/timing.sh

COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
PIANO=${1:-$(dirname "$(dirname "$COMMON")")/schwung-pinao-practice}
[ -f "$PIANO/tools/nisp-build/Cargo.toml" ] \
  || { echo "build-samples: no tools/nisp-build in $PIANO" >&2; exit 1; }

CACHE=${NI_SAMPLES_CACHE:-$HOME/Library/Caches/neon-ingvy/samples}
KIT=$CACHE/naked-drums
URL=https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums.git
REV=407732a548606ac715ad8f3fbac63d9f4df77c0d
fetch() {
    mkdir -p "$CACHE"
    if [ ! -d "$KIT/.git" ]; then
        git clone --quiet --no-checkout "$URL" "$KIT"
        git -C "$KIT" checkout --quiet "$REV"
    fi
    local have
    have=$(git -C "$KIT" rev-parse HEAD)
    [ "$have" = "$REV" ] || { echo "build-samples: $KIT is at $have, the pack was cut from $REV" >&2; return 1; }
}
ni_time_stage fetch-naked-drums --here -- fetch || exit
ni_time_stage nisp-build-tool -- cargo build --release --quiet --manifest-path "$PIANO/tools/nisp-build/Cargo.toml" || exit
ni_time_stage pack-drums -- "$PIANO/tools/nisp-build/target/release/nisp-build" build samples/drums.manifest.toml \
    --source "$KIT" --out samples/drums.nisp --report samples/drums.report.txt || exit
