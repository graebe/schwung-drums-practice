#!/usr/bin/env sh
# Build the engine natively and link the C harness against it, so the ABI is
# exercised the way the Move exercises it.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/build/dsptest"
mkdir -p "$OUT"

# cargo needs rustc BESIDE it on PATH, so the toolchain's whole bin directory
# goes on rather than just the one binary.
if ! command -v cargo >/dev/null 2>&1; then
  if [ -x "$HOME/.cargo/bin/cargo" ]; then
    PATH="$HOME/.cargo/bin:$PATH"
  elif command -v rustup >/dev/null 2>&1 && rustup which cargo >/dev/null 2>&1; then
    PATH="$(dirname "$(rustup which cargo)"):$PATH"
  else
    echo "cargo not found — skipping the C ABI test" >&2
    exit 0
  fi
  export PATH
fi
CARGO=${CARGO:-cargo}

# --no-default-features turns the `rt` feature off, so std supplies the panic
# handler and the allocator and the object links into an ordinary binary.
( cd "$ROOT/dsp" && $CARGO build --quiet --no-default-features -p drums )

LIB=$(find "$ROOT/dsp/target/debug" -maxdepth 1 -name 'libdrums.*' \
        \( -name '*.dylib' -o -name '*.so' \) | head -1)
test -n "$LIB" || { echo "cargo produced no shared library" >&2; exit 1; }

CC_BIN=${CC:-cc}
"$CC_BIN" -std=c11 -Wall -Wextra -Werror -o "$OUT/test_drums" \
  "$ROOT/tests/dsp/test_drums.c" "$LIB"

DIR=$(dirname "$LIB")
DYLD_LIBRARY_PATH="$DIR" LD_LIBRARY_PATH="$DIR" "$OUT/test_drums"
