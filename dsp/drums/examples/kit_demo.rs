// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * Render the kit to a WAV, so it can be heard before it goes near hardware.
 *
 *   cd dsp && cargo run --example kit_demo --no-default-features -- /tmp/kit.wav
 *
 * `--no-default-features` is required: with `rt` on, the crate is no_std and
 * supplies its own allocator and panic handler, which an ordinary binary
 * cannot link against.
 *
 * This exists because the synthesis constants are the one part of the module
 * no test can judge. A test can prove a drum decays and is finite; only an ear
 * can say whether it sounds like a snare.
 */
use drums::Drums;
use schwung_plugin::SchwungPlugin;

const SR: u32 = 44100;
const BLOCK: usize = 128;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| "kit.wav".into());
    let bpm: f32 = std::env::args()
        .nth(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(96.0);

    let mut d = Drums::create(None, None).expect("engine");
    let mut pcm: Vec<i16> = Vec::new();

    /* One grid for the whole demo: eighth notes. */
    let frames_per_eighth = (30.0 / bpm * SR as f32) as usize;
    let mut script: Vec<(usize, &str, String)> = Vec::new();

    /* Each drum alone, a beat apart, in staff order. */
    let mut step = 0usize;
    for i in 0..9 {
        script.push((step, "n", format!("{i}:110")));
        step += 2;
    }
    step += 2;

    /* Two bars of a backbeat with ghost notes, against the click. */
    let groove = [
        "7:110,1:90", "1:55", "5:115,1:90", "1:55",
        "7:100,1:90", "7:85,1:55", "5:115,1:90", "1:55,5:30",
    ];
    for bar in 0..2 {
        for (i, hits) in groove.iter().enumerate() {
            let at = step + bar * 8 + i;
            if i % 2 == 0 {
                script.push((at, "c", if i == 0 { "1".into() } else { "0".into() }));
            }
            script.push((at, "n", (*hits).into()));
        }
    }
    let total = step + 16 + 4;

    for s in 0..total {
        for (at, key, val) in &script {
            if *at == s {
                d.set_param(key.as_bytes(), Some(val.as_bytes()));
            }
        }
        let mut done = 0;
        while done < frames_per_eighth {
            let n = BLOCK.min(frames_per_eighth - done);
            let mut buf = vec![0i16; n * 2];
            d.render(&mut buf);
            pcm.extend_from_slice(&buf);
            done += n;
        }
    }

    write_wav(&path, &pcm);
    println!(
        "{path}: {:.1}s, {} frames, peak {}",
        pcm.len() as f32 / 2.0 / SR as f32,
        pcm.len() / 2,
        pcm.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0)
    );
}

fn write_wav(path: &str, pcm: &[i16]) {
    let data_len = (pcm.len() * 2) as u32;
    let mut out: Vec<u8> = Vec::with_capacity(44 + pcm.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());          /* PCM   */
    out.extend_from_slice(&2u16.to_le_bytes());          /* stereo */
    out.extend_from_slice(&SR.to_le_bytes());
    out.extend_from_slice(&(SR * 4).to_le_bytes());      /* byte rate */
    out.extend_from_slice(&4u16.to_le_bytes());          /* block align */
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        out.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(path, out).expect("write wav");
}
