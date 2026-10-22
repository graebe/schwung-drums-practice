# Drums Practice

A rhythm trainer for [Schwung](https://github.com/charlesvestal/schwung) on the Ableton Move.

A percussion staff sits still on the left of the 128×64 screen. Notes and bar lines scroll in from
the right, cross the hit line, and vanish just before the clef. Play the right pad at the right
moment and the notehead opens into a **ring**. Miss it and it turns into an **✗**. A second ring
marks where you actually played, so the gap between the two is your timing error — and the header
collects those errors into the two numbers that matter: whether you rush or drag, and how consistent
you are. Along the bottom, a bar fills as the drill goes, with your hits and misses beside it.

Drums Practice is an independent module for Schwung. It is not made or supported by Ableton.

**New here?** [Finding your way](docs/finding-your-way.md) walks you through the first launch, the
list, the keys and where everything lives.

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
- **Reads like drum tab, by default.** One row per voice, `x` for a cymbal and a filled head for a
  drum, a playhead sweeping across. This is what a drummer reads and it is legible while you are
  playing rather than only when you stop. The staff is one setting away when reading notation is
  the point; both views show the same data and teach the same vocabulary.
- **Scores the distribution, not just the hits.** A hit inside ±30 ms is *perfect*, ±60 ms is
  *good*, past 120 ms the note is gone. But the score is the **mean** — are you rushing or
  dragging — and the **standard deviation**, which is how consistent you are and the number that
  actually improves with practice. Broken down per voice, because your kick can be 12 ms late
  while your hats are tight.
- **Scores your hands.** The pads are split down the middle: left half is your left hand, right
  half your right. So `RLRR LRLL` is not a suggestion printed under the staff — it is checked, and
  a wrong hand is its own kind of error, counted apart from a missed note.
- **Scores your dynamics — on their own.** An accent has to stand out and a ghost note has to sit
  back — judged against *your own* strokes, not a fixed number, so it works on any pads and any
  touch. That is most of what separates a groove that feels good from the same notes played flat.
  It is a score of its own, `dyn 30%`, beside the verdict and never inside it: a soft accent on the
  right drum, in time, is a right note with a sound still to work on, not a wrong one.
- **Has a length.** Every drill is a file, and the file says how long the practice is: a one-bar
  beat with `"repeats": 8` is an eight-bar practice that ends by itself and shows you the result.
  Nothing runs until you interrupt it.
- **Climbs.** The Ladder plays a rudiment at a tempo, and if you keep it clean it puts the tempo up
  and asks again. Your score is the fastest tempo you held it together at, kept per drill, plotted
  over time.
- **Knows how far you have got.** Every drill shows your best **clean speed** — 80% means you can
  play it clean at 80% of its written tempo — and a tick once you can play it clean at tempo. The
  **Learning Path** walks you through seven stages, time, hands, grooves and ear side by side, and
  **Review** brings back what you learned on a schedule, so it stays learned. **Continue** — Play
  on the Learning Path's map — always knows the one thing to do next.
- **Starts at home.** Five circles with pictures — Learning Path, Practice, Quiz, Progress, Settings — chosen
  with the jog (the chosen one grows) or by the five lit pads under them.
- **Always says what to press.** The bottom line of every screen names its keys — `CLICK open  BACK
  up` — and **Menu** opens help for the screen you are on. Hold **Shift** and the line shows what
  Shift does there.
- **Sounds like a kit, with no setup** — the module renders its own drums and its own click and
  mixes them into Move's audio. No track, no instrument, no MIDI channel to match.
- **A library, in folders.** All forty PAS rudiments, by family, and forty-two grooves across six
  families from rock to techno, each learned a limb at a time.
- **Waits for you.** With **Study** on, the scroll stops *on* the note you missed, names it, and one
  press of it carries on.
- **Takes its time.** Every groove starts at **L0**, the whole groove with no clock: the bar stands
  still, a cursor waits on the next stack until you strike it, and your pace is measured so you can
  watch yourself get faster.
- **Generates its own material** — subdivision drills, and random reading lines, sticking and
  grooves drawn fresh each time you open one — and takes hand-written exercises as JSON,
  interchangeable with the generated ones.

## The kit

Twenty-one voices: the sixteen General MIDI drums from 36 to 51, and Kick 2, China, tambourine,
cowbell and shaker — a whole kit, every sound recorded. The vertical vocabulary is still learned
in an evening, which is the point: on drums the difficulty is in the horizontal axis. The drills
are written in the nine voices drum charts are made of (bold below), and a beginner meets only
those; the rest are there for the grooves that need them and for your own.

| | Voice | GM | Staff | Head | Stem |
| --- | --- | --- | --- | --- | --- |
| **`CR`** | **Crash** | 49 | A5, ledger | circled ✗ | up |
| `FX` | China | 52 | A5, ledger | ✗ | up |
| `P1` | Cowbell | 56 | A5, ledger | triangle | up |
| **`HH`** | **Hi-hat** | 42 | G5 | ✗ | up |
| **`HO`** | **Hi-hat, open** | 46 | G5 | circled ✗ | up |
| `P2` | Tambourine | 54 | G5 | triangle | up |
| `SH` | Shaker | 70 | G5 | slash | up |
| **`RD`** | **Ride** | 51 | top line | ✗ | up |
| **`HT`** | **High tom** | 50 | 4th space | ● | up |
| `HM` | Hi-mid tom | 48 | 4th line | ● | up |
| **`SN`** | **Snare** | 38 | 3rd space | ● | up |
| `RM` | Rim (cross-stick) | 37 | 3rd space | ✗ | up |
| `CL` | Clap | 39 | 3rd space | circled ✗ | up |
| `S2` | Snare 2 | 40 | 3rd space | diamond | up |
| `MT` | Mid tom | 47 | 3rd line | ● | up |
| **`LT`** | **Low tom** | 45 | 2nd space | ● | up |
| `F1` | Floor tom | 43 | 2nd line | ● | up |
| `F2` | Low floor tom | 41 | bottom space | ● | up |
| **`KK`** | **Kick** | 36 | bottom space | ● | **down** |
| `K2` | Kick 2 | 35 | bottom line | ● | **down** |
| **`HF`** | **Hi-hat pedal** | 44 | below the staff | ✗ | **down** |

Stems up are hands, stems down are feet. That is how a drum chart is engraved. Five lines cannot
give six toms a space each and keep the nine voices where every chart has always had them, and
nothing fits above the crash's ledger on a 64-pixel staff — so voices that share a place differ by
their head or their stem, and no two share all three. In the tab view, each voice has its own lane.

A voice is its GM note everywhere: the module plays its recording by it, MIDI out sends it, and the
Chromatic layout is laid out by it. Bossa nova and reggae one-drop play their cross-stick on the rim,
songo and mozambique their bell on the cowbell, house and trap their backbeat on the clap; takes
played before 2026-10-22 had those on the snare and the ride.

## The pads

The pads are the finger drummer's. **Settings › Pads** chooses the layout, **Flip** mirrors it left to
right for a left-hander, and **Settings › Pad map** shows every pad's drum on screen. New to the
layout? The Learning Path starts with **Meet the pads** (Learning Path › 0 Hello, kit › Ear, and Continue's first
offer): each drum in turn, its pads pulsing, its sound once — strike it to meet the next.

```
 MPC Classic (default)  MPC Family Rows     MPC Centre Core     Chromatic GM 36-51
 CR RD P1 FX            CR RD P1 P2         CR MT FX RD         HM CR HT RD
 LT MT HT P2            HH HO HF SH         SH HH HO HF         HF LT HO MT
 K2 CL RM HF            SN S2 CL RM         P1 KK SN P2         S2 F2 HH F1
 KK SN HH HO            KK K2 LT HT         LT RM CL HT         KK RM SN CL
```

These four are 4×4s that the right half of the grid **duplicates**: the left half is where Move's own
drum mode puts its Drum Rack, and the copy keeps every sound under either hand, which sticking
needs. **MPC Classic** is the default: kick, snare and hats along the bottom row under the strongest
fingers, from the corner, cymbals on top, toms between — the layout most finger drummers learnt
on. Its shaker pad holds the **hat foot**, because the jazz and Latin grooves need one. **Chromatic**
is General MIDI 36–51 bottom left to top right, note for note what Move's drum mode and a Live Drum
Rack play, so it carries straight into Move's own kits; it has no room for the cowbell, and songo
and mozambique say `NO P1 ON PADS` on it.

```
 Mirrored Performance
 SH FX | CR P1 P2 RD | FX SH
 HM HT | HH HO HO HH | HT HM
 MT RM | LT SN CL HT | RM MT
 HF F1 | KK SN SN KK | F1 HF
```

**Mirrored** is a two-handed kit centred on columns 3–6, each hand the mirror of the other, the
extension — toms, China, shaker, the hat foot — on the outer columns. **Sticking** puts the snare on
every pad: the only questions are which hand and when, which is the layout for rudiments. A drum
quiz asks about drums, so under Sticking it plays on MPC Classic.

**The hand split.** Columns 1–4 are your left hand, 5–8 your right, whatever the layout and whether it
is flipped. So `RLRR LRLL` is not a suggestion printed under the staff — it is checked, and a wrong
hand is its own kind of error, counted apart from a missed note.

**Custom** is one layout of your own. In the Pad map, a pad sounds and names its drum, the jog steps
through the layouts, and **Click** on a preset makes Custom a copy of it. On Custom, press a pad to
pick it and turn the jog to give it a sound (or none); **knob 1** says whether the edit lands on both
halves — on the same finger of the other hand for a copied 4×4, on the mirror image for a copied
Mirrored. **Back** saves it to `pads.json` beside the module:

```json
{ "version": 1, "pair": "twin",
  "rows": ["CR RD P1 FX CR RD P1 FX", "LT MT HT P2 LT MT HT P2",
           "K2 CL RM HF K2 CL RM HF", "KK SN HH HO KK SN HH HO"] }
```

Eight voice ids a row, top row first, `.` for a pad with no sound. It doubles as export and import:
copy it off the Move, edit it, copy it back. A file that will not read says `BAD PADS.JSON` and plays
MPC Classic until Custom is saved again. A drill that asks for a drum your layout has no pad for
names it on the ready screen (`NO HF ON PADS`) before you start.

### Colours

Everything that describes the *music* is one violet ramp; everything that is a **judgement** keeps
its own hue, because within one family only brightness is left to rank with and right-or-wrong is
the one signal you should never have to read.

| Pad | Means |
| --- | --- |
| dark | not in this layout |
| dim purple | a voice lives here — background |
| purple | it is coming, with **Guide pads** on |
| bright violet | it is now — with Guide pads on; what **Listen** is playing; and where a **scrub** has landed |
| pale lavender | the drum a quiz is asking for, at its last hint — and, pulsing, the drum **Study** is waiting for (with Guide pads on) |
| yellow | your finger is on it |
| green | you got it |
| **amber** | right voice, **wrong hand** |
| **azure** | right voice, right hand, **wrong dynamic** — an accent too soft, a ghost too loud |
| red | you missed it |

Amber and azure are their own colours on purpose. "Right note, wrong hand" is a different mistake
from "wrong note", and "right note, wrong loudness" is a third: each is fixed differently — the
sticking, the wrist — and none of them should read as a failure at a glance.

## Timing

Accuracy — how many you hit — is the least interesting thing a rhythm trainer can tell a drummer.
Two players at 96% can be nothing alike: one is scattered either side of the beat, the other is
tight and eight milliseconds late. The first needs a metronome, the second needs to nudge.

So every hit's signed error is kept, and the header carries the two numbers that come out of them:

- **mean** — `-4ms` is four milliseconds early. You rush. Negative is ahead of the beat.
- **σ** — the standard deviation, in milliseconds. How *consistent* you are. This is the number
  that improves with practice, and the one to watch.

Both are in the **header** while you play, over your last 48 hits: `+3 s12` is three milliseconds
late on average with a spread of twelve. The **footer** is the drill's progress — a bar that fills
from the left, as in the piano trainer — with `hits/misses` beside it. In the Ladder it fills once
per rung, in the Clock over its four rounds.

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

The ready screen **is the chart**, with the controls laid over it — and, for a groove, the
**level** you play it at:

```
 ROCK BACKBEAT        1/8  8 bars
 ┌──────────────────┬──────────┐
 │ ▶  listen        │  LEVEL   │
 │ ●  practise      │  <  2  > │
 │ ↺  scrub         │          │
 └──────────────────┴──────────┘
 L2  + kick            REC start
```

**Turn the jog to change the level.** A groove is one row in the list: opening it goes straight
to its ready screen, on the first rung you have not learned yet, and the jog walks L0 to L4 from
there — the arrows say where it can still go, a tick beside LEVEL says this rung is learned. Each
turn arms the new rung from the top, its pads lit; turning to L0 swaps in the own-pace screen
(`hear bar`, `own pace`) and back. On the Learning Path the jog walks only the rungs that stage asks for, so
its targets stay the stage's; a review arms the rung that is due. The bottom line names the rung —
`L2  + kick` — beside the keys, taking turns with them when both will not fit.

The third line is only worth printing because **scrubbing works where it is printed**: knob 1
moves you through the drill before you start, so you can pick the bar you want to work on, and the
pads light the drums of the stack you have landed on — so you can see where you are on the grid as
well as on the chart. The box gets out of the way the moment you leave the start — it sits over
the music you are scrubbing through — and comes back when you scroll home, which is also the only
way to find it again. Starting from a scrubbed position begins *there*, with no count-in: it
exists to orient you at the top, and you have just been looking at the bar you chose.

Once it is running they are a **transport**:

```
 READY ──Play──▶ RUNNING ◀──Play──▶ PAUSED ──Back──▶ READY ──Back──▶ its folder
```

The button of the mode that is running **pauses** and holds the playhead rather than throwing it
away; the **other** button switches between listening and practising in place, without going back
to the top — watch a bar, then play it. **Knob 1 scrubs while paused too** — a scrub is a proper
seek, so the bars behind settle rather than counting as misses, the bars ahead re-arm and can be
taken again, and the marks from the last attempt clear. Back restarts; Back from the ready screen
goes to the folder the drill came from, the drill on the highlight. **Shift + Back closes from anywhere**, whatever screen you are on.

Pausing shifts the clock by the time you spent stopped, so resuming carries on in tempo rather
than lurching forward to wall time. `PAUSED` appears under the chart, and the transport light
pulses rather than sitting steady — a paused chart and a chart stuck waiting for you look alike,
and only one of them wants something from you.

| Control | Does |
| --- | --- |
| **Play** | **listen** — the drill plays itself and the pads light as it goes. Nothing scored |
| **Record** | **practice** — you play it, it scores you |
| **Jog turn** | moves the highlight in the list, an action sheet and settings, scrolls help, and does nothing anywhere else — a knock cannot change what you are playing |
| **Jog click** | open the highlighted folder, or arm the drill; in settings, edit the selected row |
| **Menu** | **help for the screen you are on**: what it is, its keys, and what explains it — on a row of the Learning Path, its lesson card. A run pauses first. Menu or Back closes it |
| **Shift + jog click** | on a row of the list, its **options** (the action sheet, below); anywhere else, settings over whatever is on screen: a run pauses, and leaving settings returns to it |
| **Back** | from a run or a result, back to the start of the drill; from the ready screen, up one folder; closes help, a sheet or a tip; out of the module from the top |
| **Shift + Back** | close immediately from anywhere |
| **Knob 1** | scrub, while the music is stopped — on the ready screen or paused |
| **Knob 8** | **speed**, 50–120% of the drill's tempo — on the ready screen, or live while playing |

The bottom line of the list, the ready screen, a result, a card and help names these keys for the
screen they are on, in the Move's own words — `REC start  PLAY listen`. A hint too long for one line
turns over every three seconds; while Shift is held the line shows Shift's keys instead. While the
music runs the line is the progress bar again: paused, it is the keys.

**Only Settings changes settings.** Outside it, the knobs do the two things above in a drill and
nothing anywhere else, so a knob brushed on the way past cannot change a setting, throw a quiz away
or switch the pad layout mid-run.

### Speed

Every drill plays at its own tempo times **Speed** — a hand-written drill at the tempo it is written
at, a generated one at the **Tempo** setting. Slow anything down while it is new: Up-tempo swing is
written at 270. The header shows the tempo you are actually playing, and every take records it,
with the speed and whether Guide pads or Study helped, so a slow, guided take is never mistaken for
a full-speed one on the chart.

A change of speed mid-run takes effect at once, and that take is then passage practice rather than
a whole attempt.

### The result

A run ends on its result, laid out as Piano Practice ends an exercise:

```
 Flam tap                  CLEAN
  85 %             94% right
                    s12 +3ms
  61 bpm          SN +3 s12
  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·   ← 100%
            ■──■─────■          ■
  ■──□─────                          ← every recent take, this one last
       REC again  CLICK next
```

- **The number** is the speed you played at, as a share of the drill's written tempo — the same
  number the list and the Progress chart track, so the result reads straight against them.
- **Beside it** the two things that decide whether the take was clean: how much was right, and
  how tight it was (spread σ, and whether you sat early or late). Whichever one stopped the take
  counting is drawn **inverted** — that is the one to fix.
- **Under it** the tempo, and your loosest limb: the one to go and practise — and, at the right
  end, **the dynamics** whenever the drill had accents or ghosts to judge (below).

```
 Rock backbeat · L3     ✓LEARNED
 100 %             97% right
                    s12 +3ms
  16 soft 74<83          dyn 30%     ← the notes counted; the accents are the next thing
```

**The dynamics are a second question.** Whether a take is clean asks *the right drum, the right
hand, in time?* The dynamics ask *how did it sound?* — and answer with their own number, `dyn 30%`:
how far your accents and ghost notes got towards standing out (or sitting back), on average. An
accent halfway to its target earns half, so the number moves while you work on it, long before
every accent is right. Below 90%, the left of the row says what to fix — `16 soft 74<83` is sixteen
accents played at 74 on average where your own strokes asked for 83, `5 loud 61>48` five ghosts
that came in too loud. At 90% and over the advice gives way to your loosest limb again. A take is
never NOT CLEAN for its dynamics.

A take that did **not** count looks different, because its speed is not a score. At the written
tempo every take is at 100% speed, clean or not, and a big **100** over a take that failed reads
like a perfect one. So the number becomes **how much was right**, and under it, **what cost the
most**:

```
 Rock backbeat · L3    NOT CLEAN
  83 %      ▐right, need 90▌         ← inverted: this is what stopped it
                    s12 +3ms
  16 wrong hands         dyn 30%     ← what to fix, counted
```

`16 wrong hands` names whichever cost the most right notes: **missed** notes, **stray hits** or
**wrong hands**. One correction at a time: while the notes are what stopped the take, the dynamics
keep only their number. When the take failed on its spread instead, the line keeps the tempo and
the loosest limb — that is the one to practise.
- **The chart** is every recent take of this drill, oldest on the left, this one last, against
  the dotted 100% line. A filled dot was clean, an open one did not count — so a run of slow,
  clean takes climbing to the line reads as what it is.
- **The header** says what the take did: **LEARNED** with a tick the first time you play it clean
  at tempo, **BEST YET** (your tightest clean take yet), **CLEAN**, **NOT CLEAN**, **PRACTICE**
  (clean, on easier settings — see below), **STUDY** (not counted) or **not kept**. A take that
  did not count is **NOT CLEAN**, whatever else is true of it: it is never a best.

| On a result | |
| --- | --- |
| **Jog** or **knob 1**, back | look back over the take you just played (below) |
| **Record** | another take, straight away |
| **Play** | listen to it |
| **Back** | back to the start of the drill |
| **Click** | on to the next rung of a groove, else the next drill in the folder — the next rudiment — or, on the Learning Path, the next step of its track; after a review Continue opened, whatever Continue offers next |

Only a whole take is kept: practised from the top and never scrubbed. A take started from a scrubbed
bar, or scrubbed while paused, is practice on a passage, and its result says **not kept**.

An **L0** take ends on the same screen with its own words in it, because it has no spread to show:

```
 Rock backbeat         ✓LEARNED
  47 %           100% 1st try        ← stacks right first time
                  43 of 92bpm        ← your pace, against the written tempo
  16 stacks
  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·   ← 100% of the written tempo
                    ■────────■
  □────────■                          ← your pace, take by take, from 0%
       REC again  CLICK next
```

The number is your pace as a share of the written tempo. When the take did not count it is how
much was right first time instead, and the line under it names what cost the most: **wrong pads**,
stacks **not together**, a drum **struck twice** or **wrong hands**. The dynamics are scored
apart here too, `dyn` at the end of the row. Click goes on to L1.

### Looking back over a take

Turn the jog back on the result and the drill scrolls back into view, **as you played it**: every
note you hit opened into a ring, every one you missed crossed out, and a second ring wherever your
pad actually went down — so a late snare shows as two rings with the gap between them. The header
says **REVIEW** and the bar along the bottom shows where you are in the take.

The jog moves a beat a detent; knob 1 moves finer, as the scrub does. Turn forward past the end of
the take and the result comes back; **Back** brings it back at once. Record, Play and Click do what
they do on the result. A new take forgets the last one.

## Your progress

### Clean at tempo

A drummer has learned a pattern when they can play it **clean at its written tempo**, so that is
what Drums Practice measures. A take is **clean** when, played whole from the top:

- at least **90% of the notes are right** — the right drum (and, with Sticking on `strict`, the
  right hand: then a wrong hand is not right). A stray hit counts against you, so sweeping the pads
  under every note scores nothing. A flat accent *is* right: the dynamics are their own score;
- and the **timing spread** σ is inside the good window of your Strict setting — 60 ms on normal.

Its **clean speed** is the tempo you played over the tempo the drill is written at. Play a flam tap
written at 72 with Speed at 80% and get it clean, and the flam tap reads **80%**. Bring Speed up a
step at a time and the number follows you; at **100%** the drill is **learned** and gets a tick.
The Ladder counts too: its top clean rung is a clean speed, and since it climbs past the written
tempo it can carry a drill beyond 100%.

A drill also keeps its best **dynamics**: the best `dyn` of a clean take at tempo, shown in its
Progress chart beside the speed.

Every row in the list shows where you are:

| Row | Means |
| --- | --- |
| `✓ 100%` | learned — clean at tempo — and your best clean speed |
| `85%` | your best clean speed so far |
| `○` | played, but never clean yet |
| `»` | skipped on purpose |
| `▸` | the next step on the Learning Path |
| `12/40` | a folder: learned out of all |

Your best never drops. Practising slowly is how a drummer gets faster, and a slow take must never
read as going backwards. A **Study** take is never counted at all: Study waits for you, and a take
that waited has no timing to judge.

### What a tick means

A tick means the same thing on every drill: clean at tempo **on the standard settings** — Strict at
*normal* or *tight*, **Guide pads** and **Study** off. The easier settings are there to get you to
it, and a take on them still goes on the drill's chart, but it does not move your best or earn the
tick; its result says **PRACTICE** and `not counted: Loose` (or `Guide`). Otherwise a tick would mean
whatever the settings happened to be that day. **Dynamics** off is no easier setting — the dynamics
never decide a tick — it only leaves the take without a dynamics score.

### Accents and ghost notes

An accent is a stroke **louder than the ones around it**, so that is how it is judged: against your
own normal strokes in this take. Drums Practice keeps the median velocity of your last sixteen
normal strokes, and an accent has to reach that **plus Accent +** (15 by default). A ghost note has
to stay under it **minus Ghost -** (20).

Say your normal strokes sit around 68. An accent then needs 83, and a ghost note must stay at 48 or
under. Play softly overall — strokes around 50 — and an accent at 65 is an accent; hit everything as
hard as the pad goes and nothing is an accent at all, because nothing stands out.

This is why the pads, the velocity curve and your touch do not matter: only the difference does.
Until a take has three normal strokes there is nothing to compare against, so a dynamic is not
judged — and a drill that is accents only, like quarter notes accented on every beat, is not judged
for dynamics at all. A take needs four judged accents or ghosts before it has a `dyn` score.

The score is the **credit** the judged notes earned, on average: an accent at the reference (your
normal stroke) earns nothing, one at the need earns all of it, one halfway earns half — and a ghost
the same, downwards. A missed note is a missed note and is not judged for its dynamic as well: one
mistake, one error.

### One mistake, one error

A stroke that lands after its note's good window (60 ms on normal) but before the note is given up
(120 ms) is that note, **late**: it counts once, as a miss — not as a stray hit and then the miss
again when the window closes. A stroke that lands **early**, before a note's window opens, is a
stray: the note is still ahead, and you may yet play it properly.

A generated drill has no written tempo of its own — it follows the Tempo setting — so each has a
target to measure against: quarters and eighths at 100, triplets at 90, sixteenths and switching at
80, sextuplets at 70, reading 8ths at 90, reading 16ths and random sticking at 80.

A quiz has no tempo either. Its number is your best round: answers right first time, out of all
your answers — an answer you needed a hint for is right but not yet known, so it does not count as
right here. **90%** is learned.

### The Learning Path

The first circle at home: a course from your first beat to pro rhythms, in **seven
stages**. It does not hold drills of its own — every step is a row from elsewhere in the tree, so
**a take anywhere counts**: play the flam tap from Practice › Rudiments › Flams at the tempo a step
asks and the step is done. Nothing is locked; the path only recommends. The whole plan, step by step
and why, is in [docs/curriculum.md](docs/curriculum.md).

| Stage | The world it opens |
| --- | --- |
| **0 Hello, kit** | every pad met by name, the three drums of a beat, the pulse, rests — and your first beat, in session one |
| **1 Eighth notes** | 1 & 2 &, off-beats, kicks on the "&", the open hat, a phrase and keeping time alone |
| **2 Sixteenths** | 1 e & a, accents and ghost notes on purpose, the first rudiments, house and funk |
| **3 Ghosts & flams** | ghost-note grooves, reading a kick line under steady hands, flams and drags |
| **4 Triplets/swing** | triplets, the shuffle, swing, 6/8 and 12/8, the jazz ride with the click on 2 and 4 |
| **5 Clave & world** | the clave, 3 over 2, bossa, samba, songo, mozambique, the long rolls |
| **6 Pro** | odd meters, groupings, displacement, feel on purpose, pro tempos |

Inside a stage four **tracks** run side by side, because time, hands, grooves and ears are different
skills and a session that mixes them beats one that grinds a single list: **Time** (pulse, reading,
the Clock), **Hands** (hand patterns, rudiments, dynamics), **Grooves** (beats rung by rung, fills,
phrases) and **Ear**. Continue only recommends the stage you are in, so the tracks stay in step:
what the hands are asked, the ears and eyes have been given.

**The Learning Path is a map.** It opens on the sea, an island per stage above its pad; a lit pad is a place
you can walk to — green done, pulsing white where Continue goes, dim yellow started, blue skipped,
bright white where you stand. Press a pad and the avatar walks there, press it again to go in; the
jog walks too and Click goes in, Back goes up, Play is Continue, and the pads make no sound there.
A stage is an island of its own — the Lessons hut, a place per track, the Electives cove, the
Checkpoint fort — and going into a place opens its list. *Show as list* on the sheet shows the
folder as a list for the session (that is where Review is); Back returns to the map. See
[Finding your way](docs/finding-your-way.md#the-map).

A stage folder lists its places in the order a lesson takes them — orient, hear, pattern, apply,
show:

```
1 EIGHTH NOTES
  Lessons      its lesson cards, to read again
  Ear          hearing it first
  Time         the pulse, reading, the Clock
  Hands        hand patterns, rudiments, dynamics
  Grooves      beats rung by rung, fills, phrases
  Electives    more of the same idea in other styles
  Checkpoint   the piece that proves the stage
```

A step asks for its drill at a **target** — a share of its written tempo — and opening it sets
**Speed** to that, so 100% of what the step asks is what you are armed at. A drill new to you
arrives slow, 60–85%, and comes back faster in a later stage; the row reads `45/60`, your best
against the target, until it is done. A stage has a **core** (the steps that teach its idea, one new
thing each), **Electives** (never required) and its **Checkpoint**. Pass the checkpoint and the
stage is through, whatever else is open — take it at any time to test out. Closing every core step
does it too. The current stage is marked `▸`, a finished one ✓.

**Continue** — **Play** on the Learning Path's map, and the first row of the Learning Path as a list — opens the next
step of the current stage, from the track you have left longest, and names it: `Continue   Quarters`. A name too long for the row shows only its
rung (`Continue   L0`), and the title bar names the whole step while the cursor is on it. When something you learned is due again it
offers that instead — `Review   Flam tap` — one review, then one new step, in turn.

**The action sheet.** Hold **Shift** and click a row for its options. Only what applies is offered:

| Option | On |
| --- | --- |
| **I know this: skip** | a step, or Continue (the step it would open). It stays playable and still counts if you play it later |
| **I know it all: skip** | a stage, a track, a groove: everything open inside it |
| **Undo skip** | a skipped step, or a folder with skipped steps inside |
| **Start the path here** | a stage: Continue starts there. Earlier stages stay open and nothing is ticked |
| **Test out: checkpoint** | a stage: plays its checkpoint. Pass it and the path moves on |
| **Lessons** | a stage: its lesson cards |
| **Practise: Ladder**, **Practise: Clock** | any drill with a tempo — see the Ladder and the Clock below |
| **Show as list**, **Show as map** | the Learning Path and a stage: the folder as a list for the session, and the map again |
| **Settings...** | always: the Settings folder, on top of where you are, so Back comes back |

**Settings › Learning Path** decides what Continue offers: **Tracks** and **Styles** on or off, **Rungs**
`full` or `short` (L0 and the top rung only), **Start at** a stage, **Intros** `new`/`always`/`off`.
A switched-off style leaves the core of every stage (its checkpoint swaps to an alternative), and
never empties one.

**Lesson cards.** Before a new idea comes a card — a screen or two on what it is, where you hear it
and what to listen for: what a ghost note is, why the clave leans. **Click** starts the practice,
read or not; the **jog** turns a card's pages; **Play** skips the reading and plays the practice to
you; **Back** returns to the list. Each card shows once (Intros `new`), and a stage's **Lessons** row
shows them all again. **Menu** on a row of the path shows its card in help, too.

**Stuck?** After three takes of a step in a row that did not count, the result suggests the easier
way in — `stuck? knob 8 slower`, or `stuck? try L0` on a groove. After six the step is **parked** for
a day (`~` in its row) and Continue offers something else; a plateau is met by coming back tomorrow.
Click on a result goes on to the next step even when the take did not count, so you are never stuck
on one drill; Record plays it again.

A groove learned at a higher level ticks the levels below it: if you can play everything, you can
play the cymbals alone — and you know its notes, which is all L0 asks. Someone who can already play
a groove plays its top rung once and moves on.

### Review

What you have learned comes back after **1, 3, 7, 14 and 30 days** — the spacing that makes
something stay learned — as a short daily routine of at most five drills. A clean take at tempo
moves a drill on to its next interval; one that falls apart brings it back tomorrow and puts it at
the top of the list. Only a take at full speed counts here: working on a learned rudiment slowly is
practice, not a slip. And it never lowers your best. **L0 never comes back** here: repetition asks
whether something is still clean at tempo, which a take with no clock cannot answer, and the timed
rungs carry the groove there. **Learning Path › Review** lists what is due today, and is only there while
something is; Continue offers the reviews in turn with new steps.

### Progress

Fifth in the list, laid out as Piano Practice's is:

| Row | Opens |
| --- | --- |
| **Overall** | every drill on the Learning Path you have learned, as a line along real time that steps up at each tick — flat stretches are weeks off, steep ones are where it clicked |
| **Time**, **Hands**, **Grooves**, **Ear** | the same for one track |
| a drill | its takes: the chart the result draws, with your best and at what tempo, and how many takes |

Drills come most recent first, with their mark and best clean speed. Once a chart is open the jog
walks on through the others without going back to the list — **JOG 3/12** says where you are.

Your progress lives in `progress.json` next to the module, with a backup copy, and survives an
update. The first time a version with progress starts, the takes already in your history are read
into it.

## The drills

The top is **home**, the same as Piano Practice's: five circles, chosen with the jog or by the lit
pads 69–73 under them (they make no sound there), opened with Click or the pad; *Show as list* on
the sheet shows them as rows. Below home the list is a tree: **Click** opens a folder, **Back** goes
up one, and Back at home leaves. Four rows show at a time, with the keys under them.

```
Learning Path  a map: 0 Hello, kit … 6 Pro; as a list Continue first, Review (while something is due) last
Practice       Subdivisions · Grooves › Rock & Pop … Techno · Rudiments › Rolls … Drags · Random
Quiz           Guess / Hear / Pick
Progress
Settings       Learning Path · Practice · Sound · Pads · MIDI · Help
```

The Ladder and the Clock are not rows: they wrap a drill, so they are on the drill's action sheet.

### Levels

Every groove is **one file**, and the ladder is derived from it:

| | plays | is |
| --- | --- | --- |
| **L0** | everything, **no clock** | the notes, at your own pace |
| **L1** | cymbals only | the timekeeper alone |
| **L2** | + kick | hat and kick |
| **L3** | + snare | the backbeat |
| **L4** | everything | as written |

Open a groove and its ready screen walks its rungs with the jog; play them in order and each one
adds a limb to the last.
Because the rungs are projections of the same file rather than separate ones, they are provably
the same groove, and — the part that matters — **a voice never moves between them**. The kick is
the same pad at L2 as at L4, so what you learn at the bottom transfers literally instead of by
analogy.

Every bundled groove has a ladder. The fourth rung appears in the grooves that use **toms** — the
fills, songo, mozambique, tribal techno — because that is the limb it adds. A drill with nothing
to strip, like a rudiment, has one rung and opens straight away.

### L0: at your own pace

Every other rung asks two things at once — *which drums* and *when* — and a groove that is new to
your hands fails the second while you are still working out the first. **L0** asks only the first.

```
 Rock backbeat           1/2  58bpm
 ────────────────────────────▼───────
 HH │ ⊙   ⊙   ✗   ✗   ✗   ✗   ✗   ✗ │ ✗   ← the whole bar, standing still
 SN │         ●               ●     │
 KK │ ⊙                 ●           │ ●   ← past the bar line: the next bar's first stack
 ─────┴───────┴───────┴───────┴──────
 1                           ▲            ← the arrows mark the stack it waits for
 ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬            5/1
```

The whole bar is on one page and nothing moves. An arrow above the chart and a caret below it mark
the next stack — nothing is drawn across the notes, so the drums you are asked for stay in plain
sight. Strike that stack and the arrows move on; strike the last stack of the bar and the page
turns. The beats are ticked on the rule under the chart. Past the closing bar line, on its own, is the
first stack of the **next** bar, so at the end of a bar you can already see where your hands go next.
Take as long as you like over any of it.

- **A stack is struck together.** Hi-hat and kick written on one beat must land within the Strict
  setting's good window of each other — **60 ms** on normal. Hit them one after the other and the
  half you played lapses, flashes red, and the stack is asked for again. This is what keeps L0
  teaching a unison rather than a flam.
- **Only the drums written there, and nothing else.** A stack is judged the moment its window
  closes, so a pad too many in that moment — or a drum struck twice — spoils it and it is asked
  for again. Pressing every pad at once never moves the cursor. Either way the stack is no longer
  *right first time*.
- **Hands are judged only with Sticking on `strict`.** There a wrong hand lets the cursor move on —
  asking again would only add strokes — but the stack does not count as right first time. A soft accent or a
  loud ghost keeps the stack right first time and goes into the take's `dyn` score.
- **Play sounds the bar** at its written tempo times **Speed**, its pads lighting as it goes, so you
  can hear the groove before you step it. **Record** begins at once: there is nothing to count in to.
  Record again pauses; time spent paused never counts against your pace.
- **An L0 take is two passes** of the pattern, so you practise the seam where it comes round again.
  `Reps` overrides it.

The footer counts stacks right first time against the rest; the header shows your **pace**: how many
beats of the groove you get through in a minute, with stops left out — a long look at the page is not
held against you. L0 is learned at **90% right first time** on the standard settings, at **any**
pace. Its number in the list, on the chart and on the result is your best pace as a share of the
written tempo: **✓ 45%** says you know the notes and can step them at 45% of the tempo. When that
number climbs, go on to L1.

The Ladder and the Clock are about time, so they need a timed rung: armed on L0, they say
**ARM A TIMED RUNG**.

### Rudiments

**All forty** of the Percussive Arts Society's International Drum Rudiments, with sticking
enforced, filed as the PAS files them:

| Family | |
| --- | --- |
| Rolls | single stroke roll, four and seven; multiple bounce; triple stroke; double stroke; the 5, 6, 7, 9, 10, 11, 13, 15 and 17 stroke rolls |
| Diddles | single, double and triple paradiddle; paradiddle-diddle |
| Flams | flam, flam accent, flam tap, flamacue, flam paradiddle, single flammed mill, flam paradiddle-diddle, pataflafla, Swiss army triplet, inverted flam tap, flam drag |
| Drags | drag, single and double drag tap, lesson 25, single dragadiddle, drag paradiddle 1 and 2, single, double and triple ratamacue |

These are the drum scales — the vocabulary everything else is assembled from — and they are the
material the Ladder is for. Each sticking and accent follows the PAS sheet; the rhythms are the
**open** forms the sheet itself says to start from. Grace notes are written measured, because a
pad and a scoring window cannot tell a closed flam from a double hit: a **flam** is one grace note
from the other hand, half a step of the rudiment's grid ahead of its stroke, and a **drag** is two,
half and a quarter step ahead. Close them up as the tempo rises. The **multiple bounce roll** cannot
be buzzed on a pad, so it is practised as its hand pulse.

### Grooves

Forty-two, in six families, each running easy to hard. Sticking is off for these; what matters is
the voice and the time.

| Family | |
| --- | --- |
| Rock & Pop | rock backbeat, straight eights, pop four-floor, motown, disco, punk, halftime ballad, rock with a fill |
| Funk & Soul | sixteenth funk, ghost-note funk, halftime shuffle, linear funk, funk with toms |
| Latin & World | reggae one-drop, cha-cha, bossa nova, samba, afrobeat, second line, mambo, songo, mozambique, Afro-Cuban 6/8 |
| Jazz & Swing | two-beat, jazz ride, shuffle, jazz waltz, up-tempo swing |
| Electronic | house, boom bap, dubstep, trap hats, breakbeat, UK garage, drum & bass |
| Techno | peak-time, minimal, dub techno, electro, Detroit, tribal, hard techno |

Every pattern is written for this module in the manner of its style and named by the style — never
after a record's beat.

### Subdivisions and Random

In **Practice**. **Subdivisions**: quarters, eighths, triplets, sixteenths, sextuplets — and **switching between
them** on a cue, which is the actual skill and the one that does not survive being practised one
subdivision at a time.

**Random**: reading lines in eighths and sixteenths, a random sticking, and a groove variation —
drawn from a **fresh seed every time you open one**, because material you have learned by heart is
not reading practice. A restart replays the set you just played.

### How long a practice is

The file decides. A drill writes its pattern once and says how many times that pattern **is** the
practice, so a one-bar groove with `"repeats": 8` runs eight bars, stops, and shows you the timing
summary — which is also when the result is recorded, so every practice produces a score you can
compare against the last one.

The header counts bars through the whole thing (`3/8`) and the rule under it fills as you go.
`Reps` in settings overrides the file when you want to play something longer today; `as written`
leaves the author's intent alone. `"repeats": 0` is endless, which is what the Ladder and the
Clock use, and what open playing wants.

### The Ladder

On a drill's action sheet: **Shift + click** the drill, **Practise: Ladder**. It wraps that drill —
any drill with a tempo; L0 has none to climb — and climbs **from 70% of its tempo, through it**: the written tempo is the goal,
not the first rung. Play `Ladder bars` bars clean — no misses, no sticking errors, σ inside the
strictness threshold — and the tempo goes up by `Ladder step` and it asks again. Slip on a rung and
it is played once more at the same tempo; slip again and the ladder ends. The timing windows stay
the same in milliseconds at every tempo, and the count-in is not part of the first rung.

Your score is the **top clean tempo**, kept per drill and plotted over time, the same way a piece
of sheet music gets a pencilled metronome mark that creeps up over a month. It is a single
comparable number for a drill, which is what makes progress legible at all.

### Ear training

In the **Quiz** folder. Three shapes, because they isolate three different skills. Which entry you open is also how you
pick. The drill plays its question; **Play repeats it**, and a correct answer names the drum and
moves on a beat later — long enough to read what it was, which in the hearing drills is where the
teaching is.

| Drill | Asks |
| --- | --- |
| **Guess: drum** | a notehead sits on the staff; play it. Reading the legend — which line is the tom? |
| **Hear: drum** | a drum sounds; play it back. The notation stays hidden until you get it, then it is revealed — which is where the teaching is |
| **Pick: drum** | a drum sounds; name it. The only drill that runs name-first, and the only one you can do in a room where you cannot make noise |
| **Hear: subdivision** | a figure plays; is it eighths, triplets or sixteenths? Ear training for *time* |
| **Pick: groove** | a groove plays; name it |

**The naming drills answer on the pads**, as Piano Practice does. In *Pick: drum*, *Hear:
subdivision* and *Pick: groove* the bottom row of pads becomes the answers, one pad each.

**The answers never move.** A drill puts the same answers on the same pads for every question, in
the same order, so once you know where *triplets* sits you can answer without looking. When the
drill's whole set fits the bottom row (eight pads), every question offers all of it: the five
subdivisions, the drums of the drill. Only a set bigger than the row (a long list of grooves)
offers three near misses instead, and even those keep the set's order.

Three answers or fewer sit on every other pad, so a near miss lands on nothing, each in its own
colour, and the screen names the colour beside each answer:

```
 PICK: DRUM               3/20
  Kick                  blue      ← the pad second from the left
  Snare                 cyan      ← the middle one
  Hi-hat                white     ← the one after
      PAD answer  REC help
```

More answers fill the row from the left, and the screen draws them as the pads they sit on, with
a short name each and the jog's choice spelled out underneath:

```
 HEAR: SUBDIVISION        3/20
  [4][8][3][16][6]                ← the five pads from the left
        Triplets
      PAD answer  REC help
```

Press the pad to answer, or turn the jog and click; the answer the jog is on pulses on its pad, and
one a hint has struck out goes dark. The answer pads sound nothing — a press there is a choice, not
a drum — and the rows above them are still the kit. *Guess: drum* and *Hear: drum* keep the whole
kit, because their answer **is** a drum and the bottom row holds drums. The colours are piano's,
less its orange, which on these pads already means *right drum, wrong hand*.

When a set is too big for the row, the wrong options are near misses — the drum either side of it
on the staff, the subdivision either side of it, a groove with the same density — because three
options where two are absurd is a quiz you pass by elimination without ever hearing the answer.

There is no *guess the subdivision* and no *guess the groove*: for both, the notation **is** the
answer, so there would be nothing left to ask.

**Record** is help, two presses deep, and what each press does depends on what the drill is
withholding: in **Guess** the first sounds the drum and the second lights its pad; in **Hear** the
first names it — the staff stays hidden — and the second lights its pad; in **Pick** each press
strikes out a wrong option. A hinted answer still counts and keeps your streak — a hint you are
afraid to use is a hint that does not help you learn — but the round records how many you took.

The pad is lit only at the last hint, and never by Guide pads: that setting is a playing aid for
the reading modes, where the music is moving and a hint keeps you with it.

A round that beats every earlier one says **BEST YET**, and so does a clean practice that is your
tightest clean take yet at its tempo.

### Clock

The exam, on a drill's action sheet: **Shift + click** the drill, **Practise: Clock**. The click
plays for four bars and then **stops**, and you keep going. Four rounds of that, then it ends on its result like any other take. The header shows how far you have drifted, live, so you can hear yourself going wrong
and pull it back rather than only finding out at the end. Then the click returns, and you find out
whether you were right.

Nothing else in the module has to change to measure this. The chart's beats are still the truth,
so your drift is simply the mean offset over the silent bars — which is the number the header has
been showing you all along.

Everything else here is played against a metronome, which is a crutch you eventually have to put
down. This is the drill that tells you whether you can.

## Settings

**Settings** is the last row of the list, a folder of groups: **Learning Path** (what Continue offers, see
the Learning Path above), **Practice**, **Sound**, **Pads**, **MIDI** and **Help** — *Show tips again* and
*Welcome again*. Open a group and its settings show; **Shift + click** in a drill shows every
setting at once. Click a row to edit it, turn the jog to change the value, click again when done.

**In settings the knobs follow the rows on screen**: settings shows a page of four, and knobs 1–4
are its rows. The page only turns when the cursor leaves it, so a knob keeps its row however far you
turn it. **Touch a knob** and the cursor jumps to the row it edits, which is how you find the
mapping rather than having to remember it.

| Setting | In | Default | |
| --- | --- | --- | --- |
| Tempo | Practice | 90 | the tempo of the generated drills in Practice › Subdivisions and Random |
| Speed | Practice | **100%** | every drill at this share of its own tempo, 50–120%. Also knob 8 in a drill |
| Read ahead | Practice | 32 | pixels per beat: how far ahead the chart shows |
| View | Practice | **grid** | `grid` is drum tab — what a drummer reads; `staff` is real percussion notation, for reading practice |
| Strict | Practice | **normal** | the timing windows, above |
| Sticking | Practice | **off** | whether the written hand is judged. `off`: only the drum counts, either half of the grid will do — the R and L are still shown as a guide; `loose` shows a wrong hand amber but does not count it; `strict` counts it as its own error. A saved `strict` from an earlier version moves to `off` once |
| Dynamics | Practice | on | score accents and ghost notes, apart from whether a take is clean |
| Accent + | Practice | 15 | how much louder than your own normal strokes an accent must be |
| Ghost - | Practice | 20 | how much softer than your own normal strokes a ghost note must be |
| Guide pads | Practice | **off** | light the voice you need next. This is a reading trainer first |
| Reps | Practice | **as written** | override how many times the drill repeats. The file is the default, and usually right |
| Study | Practice | off | stop the scroll **on** a note you missed until it is played: the lane under the chart names it, its pads pulse with Guide pads on, and one press carries on. For learning a rudiment, not for keeping time |
| Count in | Practice | 4 | beats before the first note |
| Ladder + | Practice | 5 | BPM added per rung |
| Ladder bars | Practice | 4 | clean bars needed to climb |
| Clock bars | Practice | 4 | bars of click, then that many without |
| Round | Practice | 20 | prompts in a quiz round, or `endless` |
| Click | Sound | **on** | the built-in metronome |
| Click sub | Sound | beat | `off` / `beat` / `8ths` / `16ths` |
| Latency | Sound | 0 ms | subtract a fixed offset from every hit, if your setup has one |
| Pads | Pads | **MPC** | the pad layout: `MPC` Classic, `Family`, `Centre`, `GM` chromatic, `Mirror`, `Custom`, `Sticking` (the snare on every pad) |
| Flip | Pads | off | mirror the layout left to right; the hands stay the physical halves |
| Pad map | Pads | › | every pad's drum on screen, and the Custom editor |
| MIDI out | MIDI | kit | `kit` is the built-in one. Also `track`, `USB`, `trk+USB` |
| MIDI ch | MIDI | 10 GM | the channel drum hits are sent on: General MIDI's drum channel by default |

## Hearing it

**The module has its own kit and its own click, and they are the default.** Nothing has to be set
up: no Move track, no drum rack loaded on it, no MIDI channel to match. It is rendered by the Rust
engine in `dsp/` in the overtake generator slot and *mixed into* Move's audio.

The kit is recorded: Naked Drums, a real kit played through five velocity layers with four
alternating takes of every stroke, so a ghost note sounds like a ghost note, an accent like an
accent, and a fast double never machine-guns. A flam's grace note rings on under its stroke, and a
closed hi-hat chokes an open one. See [Sounds and credits](#sounds-and-credits).

The click gets more care here than anywhere else in the module. It is the thing you are being
measured against, so it plays on its own voices ahead of the kit, it cannot be starved by a busy
bar, and it travels in the same message as the tick's hits, so a stroke on the beat never costs
the beat. It is a pair of recorded claves, the brighter one on the downbeat, so you always know
where you are without counting.

Should the recordings be missing or damaged, the module still plays, with the synthesised kit and
click it had before.

## Writing your own drills

Drop a JSON file in `exercises/` and add a line to **`exercises/user.json`** — not `index.json`.
There is no directory-listing call in the host, which is why a manifest exists at all; there are
two of them because `index.json` is what the module ships and is replaced on every update, while
`user.json` is yours and is carried across. List your drill in `index.json` and it will vanish
from the menu the next time you update, with the file still sitting on disk.

```json
{ "exercises": [ { "id": "my-groove", "name": "My groove", "file": "my-groove.json", "category": "rock" } ] }
```

`category` files it into one of the shipped folders — `rock`, `funk`, `latin`, `jazz`,
`electronic`, `techno`, `rolls`, `diddles`, `flams`, `drags`. Leave it out, or name one that does
not exist, and the drill appears in an **Other** folder.

```json
{
  "id": "my-groove",
  "name": "My groove",
  "bpm": 90,
  "timeSig": [4, 4],
  "loopBars": 1,
  "repeats": 8,
  "sticking": "off",
  "events": [
    { "beat": 0,   "voices": ["KK", "HH"] },
    { "beat": 0.5, "voices": ["HH"], "dyn": "ghost" },
    { "beat": 1,   "voices": ["SN", "HH"], "dyn": { "SN": "accent" } },
    { "beat": 1.5, "voices": ["HH"], "hand": "L" }
  ]
}
```

`beat` is always in quarter notes whatever the time signature — an eighth is `0.5`, a dotted
quarter `1.5`. `timeSig` only decides where the bar lines fall. There is no rest event: a gap in
the beat numbers is a rest.

`loopBars` is how long the written pattern is; **`repeats` is how many times that pattern is the
practice**, and together they are the whole length of it. Leave `repeats` out and it defaults to
8 — never to forever. `"repeats": 0` is endless, and has to be asked for.

`voices` names any of the nine ids above; several at once is a simultaneous hit, judged per voice,
so nailing the kick and missing the hat marks one of each in the same stack. `hand` is `"R"` or
`"L"` and is shown whenever the drill's `sticking` is not `off`; whether it is checked is the
Sticking setting's.

`dyn` is `"accent"` or `"ghost"`. A plain string applies to every voice in the stack; a **map**
gives each voice its own, which is what a backbeat needs — an accented snare under a hi-hat that
is *not* accented. Leave it out for a normal stroke.

## Requirements

- Ableton Move with [Schwung](https://github.com/charlesvestal/schwung) 1.4.0 or newer installed —
  tested on 1.7.3

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
half-installed module behind; your settings, your history, your progress and any drills listed in
`exercises/user.json` survive an update.

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
| `src/kit.mjs` | the 21 voices — GM note, staff position, notehead, stem |
| `src/layout.mjs` | every screen coordinate, in one leaf module |
| `src/notation.mjs` | staff placement and ledger lines |
| `src/catalog.mjs` | the drill tree and how the list walks it |
| `src/progress.mjs` | clean takes, clean speed, what is learned, repetition, folder sums |
| `src/program.mjs` | the Learning Path: its stages, tracks and what to practise next |
| `src/path_rows.mjs` | what the Learning Path's rows and Continue say, and what Continue opens |
| `src/row_sheet.mjs` | the action sheet: what can be done to a row besides opening it |
| `src/hints.mjs` | every screen's keys, for its hint line and its help |
| `src/help.mjs` | Menu's help page, from the hints and `help.json` |
| `src/tips.mjs` | the welcome, the placement question and the first-visit tips |
| `src/map_places.mjs` | the Learning Path as places on the map: islands, places, their states |
| `src/pathmap/` | the Learning Path map engine — layout, walk, render, pad colours — vendored from Piano Practice (`scripts/check-vendored.sh`) |
| `src/stats.mjs` | the raw history of every take, capped per drill |
| `src/beam.mjs` | beat-grouped stems and beams |
| `src/staff_render.mjs` | the percussion staff: heads, stems, beams, accents, bar lines |
| `src/grid_render.mjs` | the lane view |
| `src/view.mjs` | whole screens, composed from the above |
| `src/chart.mjs` | the scroll engine — beat to x, looping, and what is on screen |
| `src/untimed.mjs` | L0: the cursor, stacks struck together, right first time, the pace |
| `src/page_view.mjs` | L0's still page: the whole bar, the cursor, the next stack |
| `src/levels.mjs` | the ladder of rungs, projected from one groove file |
| `src/scoring.mjs` | hit windows, sticking, dynamics and run state |
| `src/timing.mjs` | mean, σ and the per-voice breakdown |
| `src/generator.mjs` | seeded procedural drills |
| `src/exercise_io.mjs` | JSON loading and validation |
| `src/padmap.mjs` | the pad layouts, Flip and the hand split |
| `src/pads_io.mjs` | the Custom layout as `pads.json` |

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

### Move only

Drums Practice is a module for the Move and nothing else: there is no Ableton Live or VST3 version,
and none is planned. It is a trainer built around the Move's pads and screen, so the JavaScript
core and the Rust kit are shaped for the Schwung host alone.

## AI assistance disclaimer

This module was developed with AI assistance. Architecture and release decisions are reviewed by a
human maintainer. Please validate functionality and licence compatibility before relying on it.

## Licence

**GPL-3.0-or-later.** Copyright (C) 2026 Torben Gräber.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. [LICENSE](LICENSE) is the licence's full text.

Releases up to and including v1.2.1 were published under MIT, and those copies
stay MIT; everything from v1.3.0 on is GPL-3.0-or-later.

### What it carries that is not its own

Very little, and all of it MIT, which the GPL can carry as long as its notice
travels with it — the full text of each is in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

| | what | licence |
| --- | --- | --- |
| `src/vendor/host/plugin_api_v1.h` | a copy of Schwung 1.7.3's ABI header, so the C tests drive the real ABI | MIT, (c) 2025-2026 Charles Vestal |
| `libm` | the only external crate; `dsp/drums` is `no_std`, so `sinf`/`expf`/`powf` come from here | MIT |

The JavaScript has **no dependencies at all**, runtime or development: the
tests are `node --test` from the standard library and the module ships as ES
modules the host's QuickJS loads directly. There is nothing to attribute there,
and so nothing that can go out of date.

## Sounds and credits

The kit and the metronome are recordings, and their makers are credited here as their licences
ask:

- **Kit:** [Naked Drums](https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums) by
  **Wilkinson Audio**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
  the SFZ edition by kinwie. **Modified:** seventeen pieces of its "CR" mix, folded to mono and
  rebalanced so every voice is clear on the Move, four of ten round robins, tails shortened with
  a fade, the smallest tom pitched up for the high tom and the kick down for Kick 2.
- **Hand percussion and metronome:** clap, tambourine, cowbell, shaker and claves from the
  [Versilian Community Sample Library](https://github.com/sgossner/VCSL) by Versilian Studios,
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Neither author endorses this module. The licence texts ship in the tarball under
`samples/LICENSES/`, and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) has the details. The
packs live in `samples/`, stored with Git LFS, so a clone needs `git lfs pull` before
`scripts/build.sh`; `scripts/build-samples.sh` re-cuts the kit from its manifest.
