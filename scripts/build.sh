#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber

set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
# Every stage timed into the shared build-timing log.
# shellcheck source=scripts/timing.sh
. "$ROOT/scripts/timing.sh"
COMPILER=${CC:-${CROSS_PREFIX:-aarch64-linux-gnu-}gcc}

if command -v "$COMPILER" >/dev/null 2>&1; then
  ni_time_stage build-dsp -- "$ROOT/scripts/build-dsp.sh" || exit
elif command -v docker >/dev/null 2>&1; then
  ni_time_stage docker-image -- docker build -q -t drums-practice-build "$ROOT" >/dev/null || exit
  ni_time_stage build-dsp -- docker run --rm --user "$(id -u):$(id -g)" -v "$ROOT:/build" \
    drums-practice-build ./scripts/build-dsp.sh || exit
else
  echo "Need Docker or an aarch64-linux-gnu-gcc cross-compiler." >&2
  exit 1
fi

ni_time_stage package -- "$ROOT/scripts/package.sh" || exit
