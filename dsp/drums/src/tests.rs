// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * Unit tests for the engine, run under `cargo test --no-default-features`
 * (the `rt` feature off, so std supplies the panic handler and allocator).
 *
 * These assert the things the C harness cannot see from outside the ABI: that
 * a drum actually decays, that a flam sounds twice, and that the click cannot
 * be stolen.
 *
 * The crate denies `unwrap` because a panic on the SPI callback takes Move's
 * firmware down with it. That reasoning does not reach test code, which is
 * not shipped and whose whole job is to fail loudly, so it is allowed here
 * rather than worked around with ceremony that would obscure the assertions.
 */
#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::assertions_on_constants)]

use super::*;
use core::f32::consts::TAU;
use voice::{Click, Recipe, Voice, RECIPES, SINE_SIZE};

fn sine_table() -> alloc::boxed::Box<[f32; SINE_SIZE]> {
    let mut t = alloc::boxed::Box::new([0.0f32; SINE_SIZE]);
    for (i, s) in t.iter_mut().enumerate() {
        *s = libm::sinf(TAU * i as f32 / SINE_SIZE as f32);
    }
    t
}

/// Peak absolute sample over `n` ticks.
fn peak(v: &mut Voice, sine: &[f32; SINE_SIZE], n: usize) -> f32 {
    let mut p = 0.0f32;
    for _ in 0..n {
        let s = v.tick(sine).abs();
        if s > p {
            p = s;
        }
    }
    p
}

#[test]
fn every_drum_makes_a_sound_and_then_stops() {
    let sine = sine_table();
    for drum in 0..NUM_DRUMS {
        let mut v = Voice::default();
        v.strike(drum, 127, 1, 0x1234_5678);
        assert!(peak(&mut v, &sine, 256) > 0.01, "drum {drum} is silent");
        /* Five seconds is longer than the longest recipe by a wide margin. */
        for _ in 0..(voice::SAMPLE_RATE as usize * 5) {
            v.tick(&sine);
        }
        assert!(!v.active, "drum {drum} never retires — a stuck voice");
    }
}

#[test]
fn an_unknown_drum_is_ignored_rather_than_indexed() {
    let sine = sine_table();
    let mut v = Voice::default();
    v.strike(NUM_DRUMS + 5, 127, 1, 1);
    assert!(!v.active);
    assert_eq!(v.tick(&sine), 0.0);
}

#[test]
fn velocity_is_audible_across_its_whole_range() {
    /* Dynamics are SCORED, so a ghost note at 30 and an accent at 110 had
     * better not sound the same. */
    let sine = sine_table();
    let mut quiet = Voice::default();
    let mut loud = Voice::default();
    quiet.strike(5, 30, 1, 99);
    loud.strike(5, 110, 2, 99);
    let q = peak(&mut quiet, &sine, 2048);
    let l = peak(&mut loud, &sine, 2048);
    assert!(l > q * 2.0, "ghost {q} vs accent {l} — not far enough apart");
}

#[test]
fn zero_velocity_never_starts_a_voice() {
    let mut d = Drums::create(None, None).unwrap();
    d.set_param(b"n", Some(b"7:0"));
    let mut buf = [0i16; 256];
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 0);
}

#[test]
fn the_kick_sweeps_downward() {
    /* The falling pitch is what the ear reads as a struck membrane. If the
     * sweep ever inverted, the kick would become a rising beep and nobody
     * would be able to say why it sounded wrong. */
    let kick: Recipe = RECIPES[7];
    assert!(kick.tone_end_hz < kick.tone_hz);
    assert!(kick.tone_end_hz > 20.0, "below hearing is not a kick");
}

#[test]
fn the_open_hat_rings_longer_than_the_closed_one() {
    assert!(RECIPES[2].noise_ms > RECIPES[1].noise_ms);
    /* And they are the same source — that is all an open hat is. */
    assert_eq!(RECIPES[1].tone_hz, RECIPES[2].tone_hz);
}

#[test]
fn the_crash_is_the_longest_thing_in_the_kit() {
    /* Which is why voices are stolen oldest-first and why there are sixteen. */
    let crash = RECIPES[0].noise_ms;
    for (i, r) in RECIPES.iter().enumerate() {
        if i == 0 {
            continue;
        }
        assert!(crash >= r.noise_ms, "drum {i} outlasts the crash");
    }
}

fn active_voices(d: &Drums) -> usize {
    d.voices.iter().filter(|v| v.active).count()
}

#[test]
fn a_flam_sounds_twice_on_one_drum() {
    /*
     * The trap this guards. A piano retriggers the same pitch's voice so
     * repeated notes do not stack; doing that here would silence the first
     * half of every flam, double and drag — which is most of the rudiment
     * list — and the player would be told they missed a stroke they played.
     */
    let mut d = Drums::create(None, None).unwrap();
    d.set_param(b"n", Some(b"5:100"));
    let mut buf = [0i16; 64];
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 1);
    d.set_param(b"n", Some(b"5:100"));
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 2, "the grace note was swallowed");
}

#[test]
fn one_write_carries_a_whole_stack() {
    /* The parameter channel is a single-slot mailbox: a kick and a snare sent
     * as two calls would have the second overwrite the first. */
    let mut d = Drums::create(None, None).unwrap();
    d.set_param(b"n", Some(b"7:110,5:90,1:60"));
    let mut buf = [0i16; 64];
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 3);
}

#[test]
fn a_malformed_entry_loses_only_itself() {
    let mut d = Drums::create(None, None).unwrap();
    d.set_param(b"n", Some(b"7:110,rubbish,5:90"));
    let mut buf = [0i16; 64];
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 2);
}

#[test]
fn an_out_of_range_drum_is_dropped_at_the_door() {
    let mut d = Drums::create(None, None).unwrap();
    d.set_param(b"n", Some(b"99:110"));
    let mut buf = [0i16; 64];
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 0);
}

#[test]
fn the_click_cannot_be_stolen_by_a_busy_bar() {
    /*
     * The reason the click has its own slots. Fill every kit voice, then ask
     * for a click: it must still sound, because it is the thing the player is
     * being measured against and a bar dense enough to exhaust the pool is
     * exactly when the beat matters most.
     */
    let mut d = Drums::create(None, None).unwrap();
    let mut buf = [0i16; 64];
    for _ in 0..(MAX_VOICES + 8) {
        d.set_param(b"n", Some(b"0:120"));
        d.render(&mut buf);
    }
    assert_eq!(active_voices(&d), MAX_VOICES, "the pool is full");
    d.set_param(b"c", Some(b"1"));
    d.render(&mut buf);
    assert!(d.clicks.iter().any(|c| c.active), "the click was starved");
}

#[test]
fn the_downbeat_is_pitched_above_the_other_beats() {
    /* Knowing where bar one is without counting is most of what a metronome
     * is for. */
    assert!(voice::CLICK_DOWN_HZ > voice::CLICK_BEAT_HZ);
    let sine = sine_table();
    let mut beat = Click::default();
    let mut down = Click::default();
    beat.strike(false, 0.5);
    down.strike(true, 0.5);
    let zc = |c: &mut Click| {
        let mut prev = 0.0f32;
        let mut n = 0;
        for _ in 0..1024 {
            let s = c.tick(&sine);
            if (s > 0.0) != (prev > 0.0) {
                n += 1;
            }
            prev = s;
        }
        n
    };
    assert!(zc(&mut down) > zc(&mut beat), "the downbeat is not higher");
}

#[test]
fn a_click_with_no_value_still_clicks() {
    /* A metronome that sometimes skips is worse than one that is sometimes
     * the wrong pitch. */
    let mut d = Drums::create(None, None).unwrap();
    let mut buf = [0i16; 64];
    d.set_param(b"c", None);
    d.render(&mut buf);
    assert!(d.clicks.iter().any(|c| c.active));
}

#[test]
fn panic_cuts_the_kit_and_the_click_together() {
    let mut d = Drums::create(None, None).unwrap();
    let mut buf = [0i16; 64];
    d.set_param(b"n", Some(b"0:120,5:120"));
    d.set_param(b"c", Some(b"1"));
    d.render(&mut buf);
    assert!(active_voices(&d) > 0);
    d.set_param(b"panic", None);
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 0);
    assert!(!d.clicks.iter().any(|c| c.active));
}

#[test]
fn the_panic_messages_are_honoured_on_every_channel() {
    for ch in 0..16u8 {
        let mut d = Drums::create(None, None).unwrap();
        let mut buf = [0i16; 64];
        d.set_param(b"n", Some(b"0:120"));
        d.render(&mut buf);
        d.on_midi(&[0xB0 | ch, 120, 0], 0);
        d.render(&mut buf);
        assert_eq!(active_voices(&d), 0, "CC120 ignored on channel {ch}");
    }
    /* System Reset, which carries no channel at all. */
    let mut d = Drums::create(None, None).unwrap();
    let mut buf = [0i16; 64];
    d.set_param(b"n", Some(b"0:120"));
    d.render(&mut buf);
    d.on_midi(&[0xFF], 0);
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 0);
}

#[test]
fn all_notes_off_lets_a_crash_ring_rather_than_clicking() {
    let mut d = Drums::create(None, None).unwrap();
    let mut buf = [0i16; 64];
    d.set_param(b"n", Some(b"0:120"));
    d.render(&mut buf);
    d.on_midi(&[0xB0, 123, 0], 0);
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 1, "a one-shot has nothing to release");
}

#[test]
fn a_midi_note_on_starts_nothing() {
    /* Hits arrive by parameter. Starting a voice from MIDI as well would
     * sound every stroke twice. */
    let mut d = Drums::create(None, None).unwrap();
    let mut buf = [0i16; 64];
    d.on_midi(&[0x90, 60, 100], 0);
    d.render(&mut buf);
    assert_eq!(active_voices(&d), 0);
}

#[test]
fn render_adds_into_the_buffer_and_never_assigns() {
    /* An overtake generator is mixed into the host's deferred buffer.
     * Assigning would silence whatever else is in it. */
    let mut d = Drums::create(None, None).unwrap();
    let mut buf = [1234i16; 64];
    d.render(&mut buf);
    assert!(buf.iter().all(|&s| s == 1234), "silence must leave the buffer alone");

    d.set_param(b"n", Some(b"7:120"));
    let mut buf2 = [1000i16; 512];
    d.render(&mut buf2);
    assert!(buf2.iter().any(|&s| s != 1000), "the kick never reached the buffer");
}

#[test]
fn gain_and_click_volume_refuse_nonsense() {
    let mut d = Drums::create(None, None).unwrap();
    let before = d.gain;
    d.set_param(b"gain", Some(b"nonsense"));
    assert_eq!(d.gain, before);
    d.set_param(b"gain", Some(b"5"));
    assert_eq!(d.gain, before, "out of range is refused, not clamped silently");
    d.set_param(b"gain", Some(b"0.5"));
    assert_eq!(d.gain, 0.5);
    d.set_param(b"cvol", Some(b"0.75"));
    assert_eq!(d.click_gain, 0.75);
}

#[test]
fn get_param_answers_what_the_ui_asks() {
    let mut d = Drums::create(None, None).unwrap();
    let mut out = [0u8; 16];
    let n = d.get_param(b"ping", &mut out);
    assert_eq!(&out[..n], b"1");
    let n = d.get_param(b"drums", &mut out);
    assert_eq!(&out[..n], b"9");
    let mut buf = [0i16; 64];
    d.set_param(b"n", Some(b"0:120,5:120"));
    d.render(&mut buf);
    let n = d.get_param(b"voices", &mut out);
    assert_eq!(&out[..n], b"2");
    assert_eq!(d.get_param(b"unknown", &mut out), 0);
}

#[test]
fn a_full_ring_drops_events_rather_than_blocking() {
    /* Blocking here would block the SPI callback. */
    let mut d = Drums::create(None, None).unwrap();
    for _ in 0..(ring::RING * 2) {
        d.set_param(b"n", Some(b"5:100"));
    }
    let mut buf = [0i16; 64];
    d.render(&mut buf);
    assert!(active_voices(&d) <= MAX_VOICES);
}

#[test]
fn nothing_in_the_kit_can_produce_a_non_finite_sample() {
    let sine = sine_table();
    for drum in 0..NUM_DRUMS {
        let mut v = Voice::default();
        v.strike(drum, 127, 1, 0xDEAD_BEEF);
        for _ in 0..8192 {
            let s = v.tick(&sine);
            assert!(s.is_finite(), "drum {drum} produced {s}");
            assert!(s.abs() < 8.0, "drum {drum} produced {s} — filter is unstable");
        }
    }
}

#[test]
fn the_soft_clip_has_no_step_at_full_scale() {
    /* Either side of the knee lands in the same place, and the curve never
     * turns back on itself on the way there. */
    let below = soft_clip(0.9999);
    let above = soft_clip(1.0001);
    assert!((above - below).abs() < 1e-3, "{below} then {above}: a step at the knee");
    assert!((soft_clip(5.0) - soft_clip(1.0)).abs() < 1e-6, "flat past the knee");
    assert!((soft_clip(-5.0) + soft_clip(5.0)).abs() < 1e-6, "symmetric");
    let mut prev = soft_clip(-2.0);
    let mut x = -2.0f32;
    while x <= 2.0 {
        let y = soft_clip(x);
        assert!(y >= prev - 1e-6, "not monotonic at {x}");
        prev = y;
        x += 0.01;
    }
    /* Quiet material passes almost untouched. */
    assert!((soft_clip(0.1) - 0.1).abs() < 0.001);
}


/* ---- the recorded kit -------------------------------------------------- */

/// The module as installed: this repository's root holds samples/.
fn installed() -> Drums {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    Drums::create(Some(root.as_bytes()), None).unwrap()
}

fn answer(d: &mut Drums, key: &[u8]) -> alloc::vec::Vec<u8> {
    let mut out = [0u8; 32];
    let n = d.get_param(key, &mut out);
    out[..n].to_vec()
}

/// RMS and peak of `blocks` host blocks, each zeroed first as the host does.
fn listen(d: &mut Drums, blocks: usize) -> (f64, i32) {
    let (mut sum, mut n, mut peak) = (0.0f64, 0usize, 0i32);
    for _ in 0..blocks {
        let mut buf = [0i16; 256];
        d.render(&mut buf);
        for s in buf {
            sum += (s as f64) * (s as f64);
            peak = peak.max((s as i32).abs());
            n += 1;
        }
    }
    ((sum / n as f64).sqrt(), peak)
}

/// RMS over eight strokes of `list`, a quarter of a second apart.
fn bar(d: &mut Drums, list: &[u8]) -> f64 {
    let mut sum = 0.0;
    for _ in 0..8 {
        d.set_param(b"n", Some(list));
        let (r, _) = listen(d, 86);
        sum += r * r;
    }
    (sum / 8.0).sqrt()
}

#[test]
fn an_installed_module_plays_the_recordings() {
    let mut d = installed();
    assert_eq!(answer(&mut d, b"source"), b"sampled");
    assert_eq!(answer(&mut d, b"click"), b"sampled");
    d.set_param(b"n", Some(b"7:100,5:100"));
    assert!(listen(&mut d, 4).0 > 0.0);
    assert_eq!(answer(&mut d, b"voices"), b"2", "two recorded voices");
    assert!(d.voices.iter().all(|v| !v.active), "and no synthesized one");
}

#[test]
fn without_packs_it_is_the_synth_and_says_so() {
    let mut d = Drums::create(Some(b"/nonexistent"), None).unwrap();
    assert_eq!(answer(&mut d, b"source"), b"synth");
    assert_eq!(answer(&mut d, b"click"), b"synth");
    d.set_param(b"n", Some(b"7:100,c:1"));
    listen(&mut d, 1);
    assert!(d.voices.iter().any(|v| v.active));
    assert!(d.clicks.iter().any(|c| c.active), "c:1 in the list is the synthesized click");
}

#[test]
fn the_recorded_kit_is_as_loud_as_the_synth() {
    let groove = b"7:100,5:100,1:100";
    let a = bar(&mut Drums::create(None, None).unwrap(), groove);
    let b = bar(&mut installed(), groove);
    let db = 20.0 * (b / a).log10();
    assert!(db.abs() < 1.5, "a bar of kick, snare and hat is {db:+.1} dB against the synth's");
}

#[test]
fn the_recorded_kit_keeps_the_balance() {
    /* Every voice against the snare, recorded and synthesized: the record's
     * mix sits hats and cymbals far back; the manifest's trims bring each
     * within reach of the balance tuned by ear on the device. */
    let level = |d: &mut Drums, drum: usize| bar(d, alloc::format!("{drum}:100").as_bytes());
    let (mut syn, mut rec) = (Drums::create(None, None).unwrap(), installed());
    let (s_sn, r_sn) = (level(&mut syn, 5), level(&mut rec, 5));
    for drum in [0usize, 1, 2, 3, 4, 6, 7, 8] {
        let s = level(&mut syn, drum) / s_sn;
        let r = level(&mut rec, drum) / r_sn;
        let db = 20.0 * (r / s).log10();
        assert!(db.abs() < 9.0, "drum {drum} sits {db:+.1} dB off the synthesized kit's balance");
    }
}

#[test]
fn a_stack_at_full_velocity_stays_under_the_knee() {
    let mut d = installed();
    d.set_param(b"n", Some(b"7:127,5:127,0:127"));
    let (_, peak) = listen(&mut d, 100);
    assert!(peak < (26000.0 * 2.0 / 3.0) as i32, "peak {peak}: the soft clip would flatten it");
}

#[test]
fn a_recorded_flam_sounds_twice() {
    let mut d = installed();
    d.set_param(b"n", Some(b"5:60"));
    listen(&mut d, 2);
    d.set_param(b"n", Some(b"5:110"));
    listen(&mut d, 1);
    assert_eq!(answer(&mut d, b"voices"), b"2", "the grace note rings on under the stroke");
}

#[test]
fn a_closed_hat_chokes_the_open_one() {
    let mut d = installed();
    d.set_param(b"n", Some(b"2:110"));
    listen(&mut d, 20);
    d.set_param(b"n", Some(b"1:90"));
    /* Naked Drums' own choke fade: -60 dB over 200 ms, gone at -80. */
    listen(&mut d, 100);
    assert_eq!(answer(&mut d, b"voices"), b"1", "the open hat is gone, the closed one rings");
}

#[test]
fn the_click_is_the_claves_in_the_same_write_as_the_hits() {
    let mut d = installed();
    d.set_param(b"n", Some(b"7:100,c:1"));
    listen(&mut d, 2);
    assert_eq!(answer(&mut d, b"voices"), b"1", "the click is not a kit voice");
    let claves = d.claves.as_ref().unwrap();
    assert_eq!(claves.voices.active_voices(), 1);
    assert!(d.clicks.iter().all(|c| !c.active), "and not the synthesized click");
    let mut down = installed();
    let mut beat = installed();
    down.set_param(b"n", Some(b"c:1"));
    beat.set_param(b"n", Some(b"c:0"));
    let (a, b) = (listen(&mut down, 20).0, listen(&mut beat, 20).0);
    assert!(a > b * 1.2, "the downbeat stands out: {a} against {b}");
    d.set_param(b"c", Some(b"0"));
    listen(&mut d, 1);
    assert_eq!(d.claves.as_ref().unwrap().voices.active_voices(), 2, "the old c parameter still clicks");
}

#[test]
fn a_panic_entry_cuts_in_order() {
    let mut d = installed();
    d.set_param(b"n", Some(b"0:127,7:127,c:1"));
    listen(&mut d, 4);
    d.set_param(b"n", Some(b"x,5:100"));
    listen(&mut d, 1);
    assert_eq!(answer(&mut d, b"voices"), b"1", "everything cut, then the snare");
    assert_eq!(d.claves.as_ref().unwrap().voices.active_voices(), 0, "the click too");
    d.set_param(b"n", Some(b"x"));
    assert_eq!(listen(&mut d, 1), (0.0, 0), "a lone x is silence from the next block");

    let mut s = Drums::create(None, None).unwrap();
    s.set_param(b"n", Some(b"0:127,c:1"));
    listen(&mut s, 2);
    s.set_param(b"n", Some(b" x ,5:100"));
    listen(&mut s, 1);
    assert_eq!(s.voices.iter().filter(|v| v.active).count(), 1, "the synth kit takes x the same way");
    assert!(s.clicks.iter().all(|c| !c.active));
}

#[test]
fn cues_are_exact() {
    use parse::{cue, Cue};
    assert_eq!(cue(b"c:1"), Some(Cue::Click(true)));
    assert_eq!(cue(b"c:0"), Some(Cue::Click(false)));
    assert_eq!(cue(b" x"), Some(Cue::Panic));
    assert_eq!(cue(b"c:2"), None);
    assert_eq!(cue(b"xx"), None);
    assert_eq!(cue(b"5:100"), None);
}
