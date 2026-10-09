// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * drums — the built-in kit and click for Drums Practice, as a Schwung v2 DSP
 * plugin.
 *
 * The module carries its own sounds so that nothing has to be set up before a
 * note can be heard: no Move track, no drum rack loaded on it, no MIDI
 * channel to match. The pitched module reached the same conclusion the hard
 * way and migrated everyone onto its internal engine; this one starts there.
 *
 * EVERYTHING HERE RUNS ON THE SPI CALLBACK. No allocation after `create`, no
 * locks, no I/O, and — see the denies below — no reachable Rust panic: a
 * fault on that thread takes MoveOriginal down with it. All of the `unsafe`
 * lives in schwung-plugin, so there is none in this crate at all.
 */
#![cfg_attr(feature = "rt", no_std)]
#![deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

extern crate alloc;

mod parse;
mod ring;
mod voice;

use alloc::boxed::Box;
use core::f32::consts::TAU;
use libm::sinf;
use ring::{Event, Ring};
use schwung_plugin::{schwung_plugin, SchwungPlugin};
use voice::{Click, Voice, NUM_DRUMS, SINE_SIZE};

/// Answered by get_param("ping"), so the UI can tell the engine loaded.
const ENGINE_VERSION: &[u8] = b"1";

/*
 * Sixteen is generous for a kit whose longest voice is a crash. It matters
 * at the one moment that would otherwise fail: a crash and a ride both still
 * ringing under a bar of sixteenth-note hats.
 */
const MAX_VOICES: usize = 16;

/*
 * The click has its own slots and is NOT part of that pool.
 *
 * Voice stealing takes the oldest, and during a busy bar the oldest thing is
 * usually the click — so a shared pool would drop the beat exactly when the
 * playing got hard enough to need it. Two slots, so a downbeat can land while
 * the previous beat is still ringing.
 */
const CLICK_SLOTS: usize = 2;

pub struct Drums {
    sine: [f32; SINE_SIZE],
    voices: [Voice; MAX_VOICES],
    clicks: [Click; CLICK_SLOTS],
    counter: u32,
    rng: u32,
    gain: f32,
    click_gain: f32,
    ring: Ring,
}

impl Drums {
    /*
     * Pick a slot: a free one, else the oldest.
     *
     * Unlike a piano this does NOT retrigger the same drum's existing voice.
     * Two strokes on one drum a few milliseconds apart is a flam or a
     * double — the two most common things in the whole rudiment list — and
     * cutting the first to start the second would silence the very detail the
     * player is being asked to produce.
     */
    fn pick(&mut self) -> Option<&mut Voice> {
        if let Some(i) = self.voices.iter().position(|v| !v.active) {
            return self.voices.get_mut(i);
        }
        let oldest = self
            .voices
            .iter()
            .enumerate()
            .min_by_key(|(_, v)| v.age)
            .map(|(i, _)| i)?;
        self.voices.get_mut(oldest)
    }

    fn pick_click(&mut self) -> Option<&mut Click> {
        if let Some(i) = self.clicks.iter().position(|c| !c.active) {
            return self.clicks.get_mut(i);
        }
        self.clicks.get_mut(0)
    }

    fn next_seed(&mut self) -> u32 {
        /* Each voice gets its own noise seed, so two hats struck on the same
         * frame are not bit-identical and do not sum into one loud hat. */
        self.rng = self.rng.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        self.rng | 1
    }

    fn apply(&mut self, e: Event) {
        match e {
            Event::Strike { drum, vel } => {
                if vel == 0 || drum as usize >= NUM_DRUMS {
                    return;
                }
                self.counter = self.counter.wrapping_add(1);
                let age = self.counter;
                let seed = self.next_seed();
                if let Some(v) = self.pick() {
                    v.strike(drum as usize, vel, age, seed);
                }
            }
            Event::Click { downbeat } => {
                let level = self.click_gain;
                if let Some(c) = self.pick_click() {
                    c.strike(downbeat, level);
                }
            }
            Event::Panic => {
                for v in self.voices.iter_mut() {
                    v.cut();
                }
                for c in self.clicks.iter_mut() {
                    c.cut();
                }
            }
            Event::ReleaseAll => {
                /* A kit of one-shots has nothing to release: every voice is
                 * already on its way out. Letting them finish is the whole
                 * difference from Panic — cutting a ringing crash clicks. */
            }
            Event::None => {}
        }
    }

    /// `"drum:vel,drum:vel,..."`, in one write.
    ///
    /// The overtake parameter channel is a SINGLE-SLOT MAILBOX: one call per
    /// drum would have a kick-and-snare overwrite itself and only the second
    /// would sound. So the UI batches a frame's hits into one string, and a
    /// malformed entry mid-list loses only itself.
    fn set_hits(&mut self, list: &[u8]) {
        for entry in parse::hits(list) {
            if let Some((drum, vel)) = parse::hit(entry) {
                self.ring.push(Event::Strike { drum, vel });
            }
        }
    }
}

impl SchwungPlugin for Drums {
    fn create(_module_dir: Option<&[u8]>, _json_defaults: Option<&[u8]>) -> Option<Self> {
        /*
         * Zeroed on the heap and filled in place, rather than built as a
         * temporary. The plugin trait returns `Self` by value, so `Some(*d)`
         * below does copy it out once more and the binding boxes it again —
         * at load, once, not on the SPI callback. Avoiding that copy would
         * mean changing the shared trait, which the pitched module uses too.
         */
        let mut d: Box<Drums> = unsafe {
            let layout = alloc::alloc::Layout::new::<Drums>();
            let raw = alloc::alloc::alloc_zeroed(layout).cast::<Drums>();
            if raw.is_null() {
                return None;
            }
            raw.write(Drums {
                sine: [0.0; SINE_SIZE],
                voices: [Voice::default(); MAX_VOICES],
                clicks: [Click::default(); CLICK_SLOTS],
                counter: 0,
                rng: 0x9E37_79B9,
                /*
                 * Loud enough to practise against, with headroom left over.
                 * An overtake generator is MIXED INTO Move's audio rather
                 * than replacing it, so it must not swamp whatever else is
                 * playing — but a trainer you have to strain to hear is a
                 * trainer you play badly to. A full bar peaks near half
                 * scale; `gain` moves it if a particular kit needs it.
                 */
                gain: 0.45,
                click_gain: 0.28,
                ring: Ring::new(),
            });
            Box::from_raw(raw)
        };

        for (i, s) in d.sine.iter_mut().enumerate() {
            *s = sinf(TAU * i as f32 / SINE_SIZE as f32);
        }
        Some(*d)
    }

    /*
     * The panic messages, and deliberately nothing else.
     *
     * Hits arrive through set_param("n", ...) because the parameter channel is
     * a single-slot mailbox and one write has to carry a whole stack. Striking
     * a drum from a MIDI note-on as well would sound every hit twice. What
     * MIDI is for here is the thing the parameter channel cannot express:
     * somebody ELSE asking for silence.
     *
     *   CC 120  All Sound Off   cut now
     *   CC 123  All Notes Off   let it ring
     *   0xFF    System Reset    cut now
     *
     * Never channel-scoped. This instrument occupies no channel, so honouring
     * one and ignoring another would make the silence conditional on a number
     * nobody set — and a panic that works on 1 of 16 channels is worse than
     * none, because it looks like it should have worked.
     */
    fn on_midi(&mut self, msg: &[u8], _source: i32) {
        match msg {
            [0xFF, ..] => self.ring.push(Event::Panic),
            [status, cc, _, ..] if status & 0xF0 == 0xB0 => match cc {
                120 => self.ring.push(Event::Panic),
                123 => self.ring.push(Event::ReleaseAll),
                _ => {}
            },
            _ => {}
        }
    }

    fn set_param(&mut self, key: &[u8], val: Option<&[u8]>) {
        match key {
            b"n" => {
                if let Some(v) = val {
                    self.set_hits(v);
                }
            }
            /* "1" is the downbeat. Anything else is an ordinary beat, so a
             * truncated or odd value still clicks rather than falling silent
             * — a metronome that sometimes skips is worse than one that is
             * sometimes the wrong pitch. */
            b"c" => {
                let downbeat = matches!(val, Some(b"1"));
                self.ring.push(Event::Click { downbeat });
            }
            b"panic" => self.ring.push(Event::Panic),
            b"gain" => {
                if let Some(g) = val.and_then(parse::float) {
                    if (0.0..=1.0).contains(&g) {
                        self.gain = g;
                    }
                }
            }
            b"cvol" => {
                if let Some(g) = val.and_then(parse::float) {
                    if (0.0..=1.0).contains(&g) {
                        self.click_gain = g;
                    }
                }
            }
            _ => {}
        }
    }

    fn get_param(&mut self, key: &[u8], out: &mut [u8]) -> usize {
        match key {
            b"ping" => write_bytes(out, ENGINE_VERSION),
            b"voices" => {
                let n = self.voices.iter().filter(|v| v.active).count();
                write_u32(out, n as u32)
            }
            b"drums" => write_u32(out, NUM_DRUMS as u32),
            _ => 0,
        }
    }

    fn render(&mut self, out: &mut [i16]) {
        while let Some(e) = self.ring.pop() {
            self.apply(e);
        }

        /* Split the borrow: the voices need the sine table while being ticked. */
        let (sine, voices, clicks) = (&self.sine, &mut self.voices, &mut self.clicks);
        let gain = self.gain;

        for frame in out.chunks_exact_mut(2) {
            let mut mix = 0.0f32;
            for v in voices.iter_mut() {
                if !v.active {
                    continue;
                }
                mix += v.tick(sine);
            }
            mix *= gain;

            /*
             * The click is summed AFTER the kit's gain and is not subject to
             * it. It is the reference, not part of the performance: a busy bar
             * must not duck the thing being played against.
             */
            for c in clicks.iter_mut() {
                if !c.active {
                    continue;
                }
                mix += c.tick(sine);
            }

            let s = (soft_clip(mix) * 26000.0) as i32;
            let s = s.clamp(-32768, 32767);

            /* The host zeroes this buffer before the call; ADD so we stay
             * correct even if that ever changes — and because an overtake
             * generator is mixed into the deferred buffer, so assigning would
             * silence whatever else is in it. */
            for sample in frame.iter_mut() {
                /* Saturate rather than wrap: a sum past full scale wrapped
                 * round to the other rail, which is a loud click. */
                *sample = (*sample as i32 + s).clamp(-32768, 32767) as i16;
            }
        }
    }
}

/// Soft knee rather than a hard clip: a stacked kick, snare and crash should
/// compress, not buzz. The input is clamped FIRST and then shaped, so the
/// curve meets its ceiling smoothly at ±2/3. It used to shape inside ±1 and
/// clamp outside it, which put a step from 2/3 straight up to 1.0 at the
/// knee — exactly the click a soft clipper exists to prevent.
pub(crate) fn soft_clip(x: f32) -> f32 {
    let x = x.clamp(-1.0, 1.0);
    x - (x * x * x) / 3.0
}

/// Copy `src` into `dst`, truncating. Returns bytes written.
fn write_bytes(dst: &mut [u8], src: &[u8]) -> usize {
    let n = core::cmp::min(dst.len(), src.len());
    let (Some(d), Some(s)) = (dst.get_mut(..n), src.get(..n)) else {
        return 0;
    };
    d.copy_from_slice(s);
    n
}

/// Decimal, no allocation. Returns bytes written.
fn write_u32(dst: &mut [u8], mut v: u32) -> usize {
    let mut tmp = [0u8; 10];
    let mut i = tmp.len();
    loop {
        i -= 1;
        let Some(slot) = tmp.get_mut(i) else { return 0 };
        *slot = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    let Some(s) = tmp.get(i..) else { return 0 };
    write_bytes(dst, s)
}

schwung_plugin!(Drums);

#[cfg(test)]
mod tests;
