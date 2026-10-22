#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# The whole test tier, each stage timed into the shared build-timing log
# (scripts/timing.sh), so test runs can be read against each other and
# against the builds. `npm test` runs this; a stage that fails stops it.
#
#   scripts/test.sh [js|dsp|rust|package]...   (default: all four, in order)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/timing.sh
. scripts/timing.sh

stages=("$@")
[ ${#stages[@]} -gt 0 ] || stages=(js dsp rust package)
for stage in "${stages[@]}"; do
    case "$stage" in
        js)      ni_time_stage test-js --here -- node --test tests/*.test.mjs || exit ;;
        dsp)     ni_time_stage test-dsp --here -- sh tests/dsp/run.sh || exit ;;
        rust)    ni_time_stage test-rust --here -- sh -c 'cd dsp && cargo test --no-default-features' || exit ;;
        package) ni_time_stage test-package --here -- sh tests/package/run.sh || exit ;;
        *) echo "test.sh: no stage '$stage' (js, dsp, rust, package)" >&2; exit 2 ;;
    esac
done
