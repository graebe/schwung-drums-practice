# Third-party notices

Drums Practice is GPL-3.0-or-later (see `LICENSE`). It carries very little
code that is not its own, and all of that is MIT — compatible with the GPL, on
the condition that the notices below travel with it.

Two RECORDINGS ship beside the code as data, in `samples/`: the kit and the
metronome. They are content, not code, and keep their own licences (below);
the full licence texts travel with them in `samples/LICENSES/`.

This file exists because `src/vendor/host/plugin_api_v1.h` points at it.

## Schwung — the host ABI header

`src/vendor/host/plugin_api_v1.h` is a verbatim copy of `src/host/plugin_api_v1.h`
from the Schwung host, at v1.7.3.

- Upstream: https://github.com/charlesvestal/schwung
- MIT License. Copyright (c) 2025-2026 Charles Vestal.

It is carried so that `tests/dsp/test_drums.c` exercises the engine through
exactly the C ABI the Move calls, rather than through a Rust-side restatement
of it that could drift from the real one.

```
MIT License

Copyright (c) 2025-2026 Charles Vestal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## libm

The only external crate the DSP depends on. `dsp/drums` is `no_std`, so its
`sinf`, `expf` and `powf` come from here rather than from the Rust standard
library.

- https://github.com/rust-lang/libm — MIT.

## Naked Drums — CC-BY-4.0

The built-in kit (`samples/drums.nisp`) is cut from **Naked Drums** by
**Wilkinson Audio**, a Yamaha Recording Custom kit with Sabian and Zildjian
cymbals, licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
(full text: `samples/LICENSES/CC-BY-4.0.txt`). Source: the SFZ edition by
kinwie, <https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums>
(commit 407732a).

**Modified:** seventeen pieces (crash, China, closed / open / pedal hi-hat,
ride, the five toms, snare, second snare, side stick, kick) taken from the
"CR" mix — direct mics, overheads and close room — summed to mono at that
preset's own levels, then rebalanced between pieces (+6 to +16 dB against the
snare), all velocity layers and four of the ten round robins, the silence
before each hit trimmed and the tails ended at 0.8–3.5 s with a fade; the
smallest tom also pitched up three semitones for the high tom, and the kick
down a whole tone for a second kick; by Piano Practice's `tools/nisp-build`
from `samples/drums.manifest.toml`. Licensor endorsement is neither claimed
nor implied.

## VCSL claves and hand percussion — CC0-1.0

The metronome (`samples/click.nisp`, shared with Piano Practice) is two claves,
and the hand percussion (`samples/perc.nisp`: hand clap, tambourine, cowbell,
large shaker) one hit each, from the **Versilian Community Sample Library** by
Versilian Studios (<https://github.com/sgossner/VCSL>, commit c1ea7bc),
dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (text:
`samples/LICENSES/CC0-1.0.txt`). No credit is required; it is given anyway.
The percussion is cut by `tools/nisp-build` from `samples/perc.manifest.toml`,
levelled against the kit.

## The drills

Nothing in `src/exercises/` is transcribed from anyone's recording or book.

- **Rudiments** — the forty International Drum Rudiments are traditional
  material, standardised by the Percussive Arts Society. The stickings and
  accents were checked against the PAS sheet; the sheet itself is not copied,
  and each rudiment is written out here in its own open form.
- **Grooves** — every one is an original pattern written for this module in
  the manner of its style, and named by the style, never after a record.

## Everything else

- `dsp/schwung-plugin` and `dsp/ni-sampler` (which plays the recordings) —
  this project's own crates, GPL-3.0-or-later, Copyright (C) 2026 Torben
  Gräber. They are shared verbatim with `schwung-piano-practice`, which holds
  the canonical copies (`scripts/check-vendored.sh`).
- The JavaScript has **no dependencies at all**, runtime or development. The
  test suite is `node --test` from the standard library, and the module ships
  as ES modules the host's QuickJS loads directly. There is nothing here to
  attribute and nothing to keep up to date.
