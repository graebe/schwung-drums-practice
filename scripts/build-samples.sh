#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# Re-cut the committed kit, samples/drums.nisp, and its hand percussion,
# samples/perc.nisp, from their pinned sources:
# Naked Drums by Wilkinson Audio (CC-BY-4.0), cloned at the commit the pack
# was cut from into the shared dataset cache (~/Library/Caches/neon-ingvy,
# kept across worktrees), through Piano Practice's tools/nisp-build.
#
#   scripts/build-samples.sh [<piano-practice checkout>]
#
# The checkout defaults to the sibling of this repository's main checkout. It
# must have nisp-build's piece `tune` (the high tom and Kick 2 are pitched):
# until that is on Piano Practice's main, pass its feature/nisp-piece-tune
# worktree.
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
# The hand percussion, from VCSL (CC0-1.0) at the commit Piano Practice's
# claves come from: URL path and sha256, and a download that does not match is
# deleted rather than cut.
VCSL_REV=c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e
PERC=$CACHE/vcsl-perc
fetch_perc() {
    mkdir -p "$PERC"
    while read -r path sum; do
        local file got
        file=$PERC/$(basename "$path")
        [ -f "$file" ] || curl -sfL -o "$file" "https://raw.githubusercontent.com/sgossner/VCSL/$VCSL_REV/$path"
        got=$(shasum -a 256 "$file" | cut -d' ' -f1)
        [ "$got" = "$sum" ] || { rm -f "$file"; echo "build-samples: $path has sha256 $got, want $sum" >&2; return 1; }
    done <<LIST
Idiophones/Struck%20Idiophones/Claps/Clap_rr1.wav 4c9f3fe4a34733b9be6ed9ce5e5aad48b19c1029ae9c6dd1b96294a847539e3f
Idiophones/Struck%20Idiophones/Tambourine%201/Tamb1_Hit_v2_rr1_Mid.wav 885ebf1d70f8e888f576682e4e4112b92b69649162f392c83b3379c91a09cf41
Idiophones/Struck%20Idiophones/Cowbells/Cowbell1_Hit_v3_rr1_Mid.wav 36e9243e18b299bde0ebbb108c65846ddb5d46b35a61655fa18a0327e3390e87
Idiophones/Struck%20Idiophones/Shaker%2C%20Large/LShaker_Hit_rr1_Mid.wav 0d3d62742a6c01ec8b8812faee945eaa2e75bfe02f83df3cc622ba7f00213ddf
LIST
}
ni_time_stage fetch-naked-drums --here -- fetch || exit
ni_time_stage fetch-vcsl-perc --here -- fetch_perc || exit
ni_time_stage nisp-build-tool -- cargo build --release --quiet --manifest-path "$PIANO/tools/nisp-build/Cargo.toml" || exit
ni_time_stage pack-drums -- "$PIANO/tools/nisp-build/target/release/nisp-build" build samples/drums.manifest.toml \
    --source "$KIT" --out samples/drums.nisp --report samples/drums.report.txt || exit
ni_time_stage pack-perc -- "$PIANO/tools/nisp-build/target/release/nisp-build" build samples/perc.manifest.toml \
    --source "$PERC" --out samples/perc.nisp --report samples/perc.report.txt || exit
