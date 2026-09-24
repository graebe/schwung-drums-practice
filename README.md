# Drums Practice

A rhythm trainer for [Schwung](https://github.com/charlesvestal/schwung) on the Ableton Move.

A percussion staff sits still on the left of the 128×64 screen. Notes and bar lines scroll in from
the right, cross the hit line, and vanish just before the clef. Play the right pad at the right
moment and the notehead opens into a **ring**. Miss it and it turns into an **✗**. A second ring
marks where you actually played, so the gap between the two is your timing error — and under the
staff a **timing bar** collects those errors into the two numbers that matter: whether you rush or
drag, and how consistent you are.

Drums Practice is an independent module for Schwung. It is not made or supported by Ableton.

**What it is not:** Move's pads are finger pads. This trains rhythm reading, timing accuracy,
dynamic control, sticking logic and groove vocabulary. It does not train stick technique, rebound
or foot control — no pad controller can. It is a rhythm trainer you happen to play with your
fingers, in the same way its sister module is a reading trainer rather than a piano.

```
 DRUMS PRACTICE   120                            -4ms  σ9
 ────────────────────────────────────────────────────────────
        ✗     ✗  │  ✗     ✗     ✗     ✗     ✗     ✗
 ═══════╪════════╪══════════════════════════════════════════
        │        │        ●                 ○
 ═══════╪════════╪══════════════════════════════════════════
        ●        │  ●                 ●
 ────────────────┼───────────────────────────────────────────
        R     L  │  R     R     L     R     L     L
 ────────────────────────────────────────────────────────────
     ◄────┼──●───┼────►            bar 2/4            96%
              ↑ hit line        ←── notes scroll this way
```

## What it does

- **Reads like a drum chart.** A five-line percussion staff with the standard legend: kick in the
  bottom space, snare in the third, toms above it, cymbals as ✗ heads over the top line. Stems up
  for hands, down for feet. Beams group the subdivision, because sixteenths without beams are not
  reading.
- **Or like a drum machine.** The same chart in lanes — one row per voice, one column per
  subdivision, a playhead sweeping across. Immediately legible, and the way Move itself shows a
  pattern. One setting switches between them; both read the same data.
- **Scores the distribution, not just the hits.** A hit inside ±30 ms is *perfect*, ±60 ms is
  *good*, past 120 ms the note is gone. But the score is the **mean** — are you rushing or
  dragging — and the **standard deviation**, which is how consistent you are and the number that
  actually improves with practice. Broken down per voice, because your kick can be 12 ms late
  while your hats are tight.
- **Scores your hands.** The pads are split down the middle: left half is your left hand, right
  half your right. So `RLRR LRLL` is not a suggestion printed under the staff — it is checked, and
  a wrong hand is its own kind of error, counted apart from a missed note.
- **Scores your dynamics.** An accent has to be loud and a ghost note has to be quiet. That is
  most of what separates a groove that feels good from the same notes played flat.
- **Loops.** A groove that stops is not a groove. A bar repeats until you stop it, and the score is
  a rolling window over the last few bars rather than a verdict on one pass.
- **Climbs.** The Ladder plays a rudiment at a tempo, and if you keep it clean it puts the tempo up
  and asks again. Your score is the fastest tempo you held it together at, kept per drill, plotted
  over time.
- **Sounds like a kit, with no setup** — the module renders its own drums and its own click and
  mixes them into Move's audio. No track, no instrument, no MIDI channel to match.
- **Generates its own material**, seeded, so you can re-attempt the exact drill you just fluffed —
  and takes hand-written exercises as JSON, interchangeable with the generated ones.

## The kit

Nine voices, at their standard positions on the staff. This is the whole vertical vocabulary, and
unlike a pitch it is learned in an evening — which is the point. On drums the difficulty is in the
horizontal axis.

| | Voice | Staff | Head | Stem |
| --- | --- | --- | --- | --- |
| `CR` | Crash | above the staff | circled ✗ | up |
| `HH` | Hi-hat | above the staff | ✗ | up |
| `HO` | Hi-hat, open | above the staff | circled ✗ | up |
| `RD` | Ride | top line | ✗ | up |
| `HT` | High tom | 4th space | ● | up |
| `SN` | Snare | 3rd space | ● | up |
| `LT` | Low tom | 2nd space | ● | up |
| `KK` | Kick | bottom space | ● | **down** |
| `HF` | Hi-hat pedal | below the staff | ✗ | **down** |

Stems up are hands, stems down are feet. That is how a drum chart is engraved and it costs one
line of code to honour.

The hi-hat pedal `HF` is engraved but has no pad. A foot articulation means nothing under a
finger, and a pad for it would be one taken from a voice that earns it; it is in the legend so
that a chart written elsewhere still renders. Nothing bundled uses it, and a drill that asks for a
voice the current layout cannot reach says so before it starts.

## The pads

The grid is split down the middle: **columns 1–4 are your left hand, columns 5–8 your right.**
Each voice owns a block of pads within each half, and the two halves mirror about the centre, so a
voice sits at the same height under either hand and the layout is learned once rather than twice.

Several pads per voice per hand is deliberate, and it is the one idea carried over unchanged from
the piano module: any pad in the block counts, so doubles and rolls have two fingers to land on
instead of one, and nothing is lost to fumbling for a single 12 mm square.

```
 sticking                       kit4                      kit8
 ┌───────────────┬───────────────┐  ┌──────────┬──────────┐  ┌──┬──┬──┬──┬──┬──┬──┬──┐
 │               │               │  │    HH    │    HH    │  │CR│CR│HH│HH│HH│HH│CR│CR│
 │       L       │       R       │  │    RD    │    RD    │  │HO│HO│RD│RD│RD│RD│HO│HO│
 │               │               │  │    SN    │    SN    │  │HT│HT│SN│SN│SN│SN│HT│HT│
 │               │               │  │    KK    │    KK    │  │LT│LT│KK│KK│KK│KK│LT│LT│
 └───────────────┴───────────────┘  └──────────┴──────────┘  └──┴──┴──┴──┴──┴──┴──┴──┘
   one surface, two hands —          rows are voices,          two per row per hand;
   the rudiment layout               halves are hands          the most-played inside
```

**Knob 4** changes layout. Start on `sticking` for rudiments, where the only question is which
hand and when; move to `kit4` for grooves; `kit8` when you want the toms and the crash.

### Colours

Everything that describes the *music* is one violet ramp; everything that is a **judgement** keeps
its own hue, because within one family only brightness is left to rank with and right-or-wrong is
the one signal you should never have to read.

| Pad | Means |
| --- | --- |
| dark | not in this layout |
| dim purple | a voice lives here — background |
| pale lavender | the voice you are being asked for, with **Guide pads** on |
| bright violet | it is now — and what **Listen** is playing |
| yellow | your finger is on it |
| green | you got it |
| **amber** | right voice, **wrong hand** |
| red | you missed it |

Amber is its own colour on purpose. "Right note, wrong hand" is a different mistake from "wrong
note", it is fixed differently, and it must not read as a failure at a glance.

## Timing

Accuracy — how many you hit — is the least interesting thing a rhythm trainer can tell a drummer.
Two players at 96% can be nothing alike: one is scattered either side of the beat, the other is
tight and eight milliseconds late. The first needs a metronome, the second needs to nudge.

So every hit's signed error is kept, and the header carries the two numbers that come out of them:

- **mean** — `-4ms` is four milliseconds early. You rush. Negative is ahead of the beat.
- **σ** — the standard deviation, in milliseconds. How *consistent* you are. This is the number
  that improves with practice, and the one to watch.

The **timing bar** under the staff shows the same thing as a picture: zero in the middle, your
last hits as dots either side, the running mean as a marker. Early is left, late is right. When
the cloud is centred and narrow you are playing in time; when it is centred and wide you are not,
whatever the hit count says.

The summary at the end of a run breaks both down **per voice**, because limbs have their own
habits and a drummer usually has one that drags.

| `Strict` | perfect | good | gone |
| --- | --- | --- | --- |
| loose | ±50 ms | ±100 ms | 160 ms |
| **normal** | ±30 ms | ±60 ms | 120 ms |
| tight | ±15 ms | ±35 ms | 80 ms |

`normal` is the default. `tight` is a real standard — it is roughly where a listener stops hearing
a flam — and it is punishing until the σ on `normal` is already small.

## Playing

**Play listens, Record practises** — at an instrument "play" means play it to me, and "record"
means capture what I do. Both pulse when a drill is armed, in their own colours; whichever is
running goes solid and the other dims. Four beats count you in.

| Control | Does |
| --- | --- |
| **Play** | **listen** — the drill plays itself and the pads light as it goes. Nothing scored |
| **Record** | **practice** — you play it, it scores you |
| **Jog turn** | moves the highlight in the drill list and in settings, and does nothing anywhere else — a knock cannot change what you are playing |
| **Jog click** | open the list / pick a drill; in settings, edit the selected row |
| **Menu** | open the drill list |
| **Shift + jog click** | settings |
| **Back** | up a level, then out of the module |
| **Shift + Back** | close immediately from anywhere |
| **Knob 1** | tempo, 40–240 |
| **Knob 2** | read ahead — pixels per beat |
| **Knob 3** | loop length — 1, 2, 4 or 8 bars |
| **Knob 4** | kit layout — sticking / kit4 / kit8 |

## The drills

### Rudiments

Sixteen, with sticking enforced: single and double stroke rolls, the paradiddle family, flams,
drags, ratamacues and the numbered rolls. These are the drum scales — the vocabulary everything
else is assembled from — and they are the material the Ladder is for.

### Grooves

Fourteen styles: rock backbeat, straight eights, sixteenth funk, shuffle, half-time shuffle, bossa
nova, samba, reggae one-drop, jazz ride, disco, motown, second line, afrobeat, boom-bap. Sticking
is off for these; what matters is the voice and the time.

### Subdivisions

Generated: quarters, eighths, triplets, sixteenths, sextuplets — and **switching between them** on
a cue, which is the actual skill and the one that does not survive being practised one subdivision
at a time.

### Reading

Generated random rhythm lines at a chosen subdivision and density, seeded. The drum equivalent of
a sight-reading exercise: you have not seen this bar before and you get one pass at it.

### The Ladder

Wraps any rudiment or groove. Play `Ladder bars` bars clean — no misses, no sticking errors, σ
inside the strictness threshold — and the tempo goes up by `Ladder step` and it asks again. Fail
and the ladder ends.

Your score is the **top clean tempo**, kept per drill and plotted over time, the same way a piece
of sheet music gets a pencilled metronome mark that creeps up over a month. It is a single
comparable number for a drill, which is what makes progress legible at all.

### Ear training

Three shapes, because they isolate three different skills. Which entry you open is also how you
pick.

| Drill | Asks |
| --- | --- |
| **Guess: drum** | a notehead sits on the staff; play it. Reading the legend — which line is the tom? |
| **Hear: drum** | a drum sounds; play it back. The notation stays hidden until you get it, then it is revealed — which is where the teaching is |
| **Pick: drum** | a drum sounds; name it from three near misses. The only drill that runs name-first, and the only one you can do in a room where you cannot make noise |
| **Hear: subdivision** | a figure plays; is it eighths, triplets or sixteenths? Ear training for *time* |
| **Pick: groove** | a groove plays; name it from three |

The wrong options are always near misses — the drum either side of it on the staff, the
subdivision either side of it, a groove with the same density — because three options where two
are absurd is a quiz you pass by elimination without ever hearing the answer.

There is no *guess the subdivision* and no *guess the groove*: for both, the notation **is** the
answer, so there would be nothing left to ask.

### Clock

The exam. Open it on top of any drill: the click plays for four bars and then **stops**, and you
keep going. The header shows how far you have drifted, live, so you can hear yourself going wrong
and pull it back rather than only finding out at the end. Then the click returns, and you find out
whether you were right.

Nothing else in the module has to change to measure this. The chart's beats are still the truth,
so your drift is simply the mean offset over the silent bars — which is the number the timing bar
has been showing you all along.

Everything else here is played against a metronome, which is a crutch you eventually have to put
down. This is the drill that tells you whether you can.

**Record** is help, two presses deep, and what each press does depends on what the drill is
withholding. A hinted answer still counts and keeps your streak — a hint you are afraid to use is
a hint that does not help you learn — but the round records how many you took.

**The answer is never lit on the pads**, not even with Guide pads on. That setting is a playing
aid for the reading modes, where the music is moving and a hint keeps you with it. In a quiz the
hint is the answer.

## Settings

Click a row to edit it, turn the jog to change the value, click again when done. Knobs 1–4 are
shortcuts to the first four.

| Setting | Default | |
| --- | --- | --- |
| View | **staff** | `staff` reads like a chart; `grid` reads like a drum machine |
| Strict | **normal** | the timing windows, above |
| Sticking | **strict** | `strict` counts a wrong hand as its own error; `loose` shows it amber but does not count it; `off` ignores hands, which is right for grooves |
| Dynamics | on | score accents and ghost notes |
| Accent vel | 90 | an accent must reach this |
| Ghost vel | 45 | a ghost note must stay under this |
| Guide pads | **off** | light the voice you need next. This is a reading trainer first |
| Loop | **on** | repeat the bar until you stop. Off plays the drill once |
| Study | off | stop the scroll at a note until it is played. For learning a rudiment, not for keeping time |
| Click | **on** | the built-in metronome |
| Click sub | beat | `off` / `beat` / `8ths` / `16ths` |
| Count in | 4 | beats before the first note |
| Ladder + | 5 | BPM added per rung |
| Ladder bars | 4 | clean bars needed to climb |
| Clock bars | 4 | bars of click, then that many without |
| Round | 20 | prompts in a quiz round, or `endless` |
| Latency | 0 ms | subtract a fixed offset from every hit, if your setup has one |
| MIDI out | kit | `kit` is the built-in one. Also `track`, `USB`, `trk+USB` |
| MIDI ch | all | which channel a Move track listens on |

## Hearing it

**The module has its own kit and its own click, and they are the default.** Nothing has to be set
up: no Move track, no drum rack loaded on it, no MIDI channel to match. It is rendered by the Rust
engine in `dsp/` in the overtake generator slot and *mixed into* Move's audio.

The click gets more care here than anywhere else in the module. It is the thing you are being
measured against, so it is synthesised on its own path ahead of the kit, it cannot be starved by
a busy bar, and the downbeat is pitched higher than the other beats so you always know where you
are without counting.

## Writing your own drills

Drop a JSON file in `exercises/` and add a line to `exercises/index.json`. There is no
directory-listing call in the host, which is why the manifest exists.

```json
{
  "id": "my-groove",
  "name": "My groove",
  "bpm": 90,
  "timeSig": [4, 4],
  "loopBars": 1,
  "sticking": "off",
  "events": [
    { "beat": 0,   "voices": ["KK", "HH"] },
    { "beat": 0.5, "voices": ["HH"], "dyn": "ghost" },
    { "beat": 1,   "voices": ["SN", "HH"], "dyn": "accent" },
    { "beat": 1.5, "voices": ["HH"], "hand": "L" }
  ]
}
```

`beat` is always in quarter notes whatever the time signature — an eighth is `0.5`, a dotted
quarter `1.5`. `timeSig` only decides where the bar lines fall. There is no rest event: a gap in
the beat numbers is a rest.

`voices` names any of the nine ids above; several at once is a simultaneous hit, judged per voice,
so nailing the kick and missing the hat marks one of each in the same stack. `hand` is `"R"` or
`"L"` and is only checked when the drill's `sticking` is not `off`. `dyn` is `"accent"` or
`"ghost"`; leave it out for a normal stroke.

## Requirements

- Ableton Move with [Schwung](https://github.com/charlesvestal/schwung) installed

Schwung is unofficial software that modifies Move's software. Back up anything you care about and
read Schwung's recovery guidance before installing it.

## Install

```sh
git clone https://github.com/graebe/schwung-drums-practice.git
cd schwung-drums-practice
sh scripts/install.sh
```

`MOVE_HOST` (default `move.local`) and `MOVE_USER` (default `ableton`) override the target. The
install stages beside the live directory and swaps, so a failed transfer cannot leave a
half-installed module behind; your settings, your history and any drills you added by hand survive
an update.

Open it from the Schwung Tools menu. If it does not appear, trigger a module rescan from
schwung-manager.

## Development

```sh
npm test              # everything below, in order — no Move needed
npm run preview       # dump the screens as ASCII art in the terminal
```

| | |
| --- | --- |
| `test:js` | unit, rendering, contract and layout tests for the JavaScript |
| `test:dsp` | `tests/dsp/test_drums.c` against the engine, through the C ABI the Move calls |
| `test:rust` | the Rust unit tests (`cargo test --no-default-features`) |
| `test:package` | what the tarball must contain and what the install must not destroy |

Everything except `ui.js` is pure and runs under plain `node`.

### Layout

| File | |
| --- | --- |
| `src/ui.js` | host glue only: lifecycle, MIDI, LEDs, settings, state machine |
| `src/kit.mjs` | the nine voices — staff position, notehead, stem, DSP channel |
| `src/layout.mjs` | every screen coordinate, in one leaf module |
| `src/notation.mjs` | staff placement and ledger lines |
| `src/beam.mjs` | beat-grouped stems and beams, computed once per chart |
| `src/staff_render.mjs` | the percussion staff: heads, stems, beams, accents, bar lines |
| `src/grid_render.mjs` | the lane view |
| `src/view.mjs` | whole screens, composed from the above |
| `src/chart.mjs` | the scroll engine — beat to x, looping, and what is on screen |
| `src/scoring.mjs` | hit windows, sticking, dynamics and run state |
| `src/timing.mjs` | mean, σ and the per-voice breakdown |
| `src/generator.mjs` | seeded procedural drills |
| `src/exercise_io.mjs` | JSON loading and validation |
| `src/padmap.mjs` | the zoned pad grid and the hand split |

### The DSP

The kit is Rust, in `dsp/`, as two crates: `schwung-plugin` — the reusable Schwung plugin-API
binding, where every FFI hazard is paid for once — and `drums`, the synthesis, which contains no
`unsafe` at all.

It is `no_std` over libc. Not for elegance: the Move runs **glibc 2.35** and the build image is
Debian bookworm at **2.36**, so `std` could reference a symbol that links here and fails to load
there. `scripts/build-dsp.sh` refuses any build that is not aarch64, needs a glibc above the
ceiling, or has ballooned in size.

`panic = "abort"`, a `#[panic_handler]` that calls `abort()`, and
`#![deny(clippy::indexing_slicing, unwrap_used, expect_used, panic)]` on both crates. `render`
runs on the SPI callback: unwinding out through `extern "C"` is undefined behaviour and a fault
there takes Move's firmware down with it, so a Rust panic has to be unreachable rather than
merely unlikely.

Building it needs Docker (or a local `aarch64-unknown-linux-gnu` Rust toolchain plus
`aarch64-linux-gnu-gcc` as its linker); `scripts/build.sh` picks whichever is present.

### Ableton Live

Not built. The kit is meant to become a Live plugin as well as a Move one, and the shape that
takes is settled even though the work is not: the **synthesis stays in Rust behind a plain C ABI**,
and a second shell links the same crate. One set of constants, so the two builds cannot drift into
sounding different.

That shell will be **iPlug2**, which is MIT. It is not nih-plug: exporting VST3 from nih-plug pulls
in Steinberg's VST3 SDK, which is GPLv3-or-commercial, and a plugin built that way could not be
distributed under this licence. Nothing in this repository depends on either today — the Schwung
module reaches the host through a C ABI it declares itself — so the choice costs nothing until the
Live build starts.

## AI assistance disclaimer

This module was developed with AI assistance. Architecture and release decisions are reviewed by a
human maintainer. Please validate functionality and licence compatibility before relying on it.

## Licence

MIT
