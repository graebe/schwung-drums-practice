#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber

# What the manifest must say, what the versions must agree on, and what the
# install must never destroy.
#
# These are asserted rather than trusted because every one of them fails
# INVISIBLY: a bad manifest field makes the module not appear, a version
# mismatch fails the release after the tag is pushed, and an install script
# that forgets stats.json wipes someone's history silently — nobody notices
# until they go looking for a trend that is no longer there.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
ID=drums-practice
fail() { echo "FAIL: $1" >&2; exit 1; }
checks=0
ok() { checks=$((checks + 1)); }

MANIFEST="$ROOT/src/module.json"
test -f "$MANIFEST" || fail "no src/module.json"

node -e '
const fs = require("fs");
const root = process.argv[1];
const id = process.argv[2];
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

const raw = fs.readFileSync(root + "/src/module.json", "utf8");
/* The loader caps module.json at 8KB and parses it with a MINIMAL JSON
 * reader: double quotes, lowercase booleans, no comments. */
if (Buffer.byteLength(raw) > 8192) fail("module.json is over the 8KB loader cap");
if (/\/\//.test(raw.replace(/"[^"]*"/g, ""))) fail("module.json has a comment");
let m;
try { m = JSON.parse(raw); } catch (e) { fail("module.json is not valid JSON"); }

for (const k of ["id", "name", "version", "api_version", "ui", "dsp", "component_type"]) {
  if (m[k] === undefined) fail("module.json has no " + k);
}
if (m.id !== id) fail("module.json id is " + m.id);
if (m.api_version !== 2) fail("api_version must be 2");
if (m.component_type !== "tool") fail("component_type must be tool");
/* overtake is what grants the pads and the audio generator slot. Without it
 * the module opens and can do neither, with nothing on screen to say why. */
if (!m.tool_config || m.tool_config.overtake !== true) fail("pads need tool_config.overtake");
if (!m.capabilities || !m.capabilities.audio_out) fail("the kit needs audio_out");
if (!m.capabilities.midi_in) fail("the pads need midi_in");
/* component_type tool means the host opens modules/tools/<id>/dsp.so — the
 * name differs by type and getting it wrong fails silently. */
if (m.dsp !== "dsp.so") fail("a tool DSP must be named dsp.so");
if (!m.abbrev || m.abbrev.length < 2 || m.abbrev.length > 6) fail("abbrev must be 2-6 chars");
if (m.license !== "GPL-3.0-or-later") fail("module.json must declare its licence");

const rel = JSON.parse(fs.readFileSync(root + "/release.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync(root + "/package.json", "utf8"));
if (rel.version !== m.version) fail("release.json " + rel.version + " != module.json " + m.version);
if (pkg.version !== m.version) fail("package.json " + pkg.version + " != module.json " + m.version);
if (!rel.download_url.includes("/v" + m.version + "/")) fail("release.json url is not the tagged one");
if (!rel.download_url.endsWith(id + "-module.tar.gz")) fail("release.json asset name is wrong");
console.log("manifest ok: " + m.name + " " + m.version);
' "$ROOT" "$ID" || exit 1
ok

# Every sibling the UI imports must be in the packaged module list, or the
# tarball ships a module that imports a file that is not there.
MODS=$(sed -n 's/^MODULES="\(.*\)"$/\1/p' "$ROOT/scripts/package.sh")
test -n "$MODS" || fail "scripts/package.sh declares no MODULES"
for f in "$ROOT"/src/*.mjs; do
  base=$(basename "$f" .mjs)
  echo " $MODS " | grep -q " $base " || fail "src/$base.mjs is not in the packaged MODULES list"
done
for m in $MODS; do
  test -f "$ROOT/src/$m.mjs" || fail "MODULES names $m, which does not exist"
done
ok

# The install must carry the player's settings, history and hand-added drills
# across an update.
INSTALL="$ROOT/scripts/install.sh"
for keep in settings.json stats.json user.json; do
  grep -q "$keep" "$INSTALL" || fail "install.sh does not preserve $keep"
done
# A hand-written drill is only preserved if the manifest that makes it VISIBLE
# is preserved too. index.json is shipped and replaced; user.json is not.
grep -q 'exercises/user.json' "$INSTALL" || fail "install.sh loses the user manifest"
if grep -q 'cp "$remote/exercises/index.json"' "$INSTALL"; then
  fail "install.sh preserves the SHIPPED manifest, which would freeze the bundled list"
fi
grep -q 'trap rollback' "$INSTALL" || fail "install.sh has no rollback"
grep -q '/data/UserData/schwung/modules/tools' "$INSTALL" || fail "install.sh uses a stale path"
ok

# Licences ship with the binary: libm is MIT and is linked into dsp.so.
test -f "$ROOT/LICENSE" || fail "no LICENSE"
test -f "$ROOT/THIRD-PARTY-NOTICES.md" || fail "no THIRD-PARTY-NOTICES.md"
# LICENSE is the FSF's text verbatim -- held to its published checksum, since a
# reflowed or trimmed copy is no longer the licence -- so the holder is named
# beside it, in the README and every source file's header.
[ "$(shasum -a 256 "$ROOT/LICENSE" | cut -d' ' -f1)" = \
  3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986 ] \
  || fail "LICENSE is not the GPL v3 text, verbatim"
grep -q 'Copyright (C) 2026 Torben' "$ROOT/README.md" || fail "the README does not name the copyright holder"
grep -q '"license": "GPL-3.0-or-later"' "$ROOT/package.json" || fail "package.json declares another licence"
grep -qi 'libm' "$ROOT/THIRD-PARTY-NOTICES.md" || fail "notices do not cover libm"
grep -q 'cp "$ROOT/THIRD-PARTY-NOTICES.md"' "$ROOT/scripts/package.sh" \
  || fail "the notices are not packaged"
ok

# No accidental dependency creep. Every crate in the DSP is ours or libm (MIT):
# a new one has to be checked against the licence allowlist and named in
# THIRD-PARTY-NOTICES.md before this list may grow.
crates=$(sed -n 's/^name = "\(.*\)"/\1/p' "$ROOT/dsp/Cargo.lock" | sort | tr '\n' ' ')
[ "$crates" = "drums libm schwung-plugin " ] || fail "unexpected crates in dsp/Cargo.lock: $crates"

node -e '
const p = require(process.argv[1] + "/package.json");
if (p.dependencies || p.devDependencies) {
  console.error("FAIL: the JavaScript side must stay dependency-free");
  process.exit(1);
}' "$ROOT" || exit 1
ok

# The tarball, if one has been built.
ARCHIVE="$ROOT/dist/$ID-module.tar.gz"
if [ ! -f "$ARCHIVE" ] && [ -f "$ROOT/dist/dsp.so" ]; then
  sh "$ROOT/scripts/package.sh" >/dev/null
fi
if [ -f "$ARCHIVE" ]; then
  sh "$ROOT/scripts/verify-package.sh" "$ARCHIVE" >/dev/null || fail "verify-package rejected the tarball"
  ok
  echo "package ok: tarball verified"
else
  echo "package: no tarball yet (run scripts/build.sh) — manifest checks only"
fi

echo "ok: $checks package checks"
