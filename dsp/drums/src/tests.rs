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
