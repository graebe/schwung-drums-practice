/*
 * One drum voice: a swept tone and a filtered noise burst under independent
 * envelopes.
 *
 * Nearly every acoustic drum sound is those two things in some proportion. A
 * kick is almost all tone with a fast downward sweep; a hi-hat is almost all
 * noise with a short decay and a high-pass; a snare is both at once, which is
 * exactly what a snare is. Building one voice that can be all of them — and
 * giving each drum a RECIPE rather than its own code path — keeps the whole
 * kit inside a couple of hundred lines and well under the size ceiling, and
 * means a drum can be retuned without touching the audio path.
 *
 * Everything here runs on the SPI callback: no allocation, no branching on
 * anything unbounded, no reachable panic.
 */
use core::f32::consts::TAU;
use libm::expf;

pub const SAMPLE_RATE: f32 = 44100.0;
pub const SINE_BITS: u32 = 11;
pub const SINE_SIZE: usize = 1 << SINE_BITS;

/*
 * A drum, as constants.
 *
 *   tone_hz        where the tone starts
 *   tone_end_hz    where it sweeps to. Equal to tone_hz means no sweep.
 *   sweep_ms       how long the sweep takes. This is what makes a kick a kick
 *                  rather than a low beep: the ear reads the falling pitch as
 *                  a struck membrane losing tension.
 *   tone_ms        tone decay
 *   tone_level     tone in the mix
 *   ratio2         a second partial as a multiple of the first. Drums are
 *                  inharmonic — a snare's two heads and a tom's body are not
 *                  an octave apart — so this is deliberately not 2.0.
 *   level2         that partial's level
 *   noise_ms       noise decay
 *   noise_level    noise in the mix
 *   hp             high-pass corner, Hz. 0 leaves the noise wideband.
 *   lp             low-pass corner, Hz. 0 leaves it open. Both together make
 *                  the band-passed ring of a cymbal.
 */
#[derive(Clone, Copy)]
pub struct Recipe {
    pub tone_hz: f32,
    pub tone_end_hz: f32,
    pub sweep_ms: f32,
    pub tone_ms: f32,
    pub tone_level: f32,
    pub ratio2: f32,
    pub level2: f32,
    pub noise_ms: f32,
    pub noise_level: f32,
    pub hp: f32,
    pub lp: f32,
}

/*
 * The kit, in the same order as src/kit.mjs — the index IS the channel the UI
 * sends. One ordering shared by the screen, the pads and the engine, so a
 * voice cannot mean one thing in the chart and another in the speaker.
 */
pub const NUM_DRUMS: usize = 9;
pub const RECIPES: [Recipe; NUM_DRUMS] = [
    /* 0 CR crash — wideband, long, barely filtered. The longest thing in the
     * kit, and the reason voices are stolen oldest-first. */
    Recipe { tone_hz: 420.0, tone_end_hz: 420.0, sweep_ms: 1.0, tone_ms: 900.0,
             tone_level: 0.06, ratio2: 1.53, level2: 0.05,
             noise_ms: 1800.0, noise_level: 0.55, hp: 1800.0, lp: 0.0 },
    /* 1 HH closed — the shortest. A hat that rings is a hat that smears the
     * eighths it is there to mark.
     *
     * The corner sits at 4.5kHz, not 7k. Two cascaded one-pole high-passes at
     * 7k threw away so much of the noise that the hat measured 23dB below the
     * kick and was inaudible on Move's speaker — a hi-hat you cannot hear is
     * a drill you cannot do. */
    Recipe { tone_hz: 800.0, tone_end_hz: 800.0, sweep_ms: 1.0, tone_ms: 20.0,
             tone_level: 0.10, ratio2: 1.41, level2: 0.07,
             noise_ms: 52.0, noise_level: 2.1, hp: 4500.0, lp: 0.0 },
    /* 2 HO open — the same source, a longer decay. That is all an open hat is. */
    Recipe { tone_hz: 800.0, tone_end_hz: 800.0, sweep_ms: 1.0, tone_ms: 40.0,
             tone_level: 0.09, ratio2: 1.41, level2: 0.06,
             noise_ms: 330.0, noise_level: 1.25, hp: 4200.0, lp: 0.0 },
    /* 3 RD ride — band-passed so it pings rather than hisses, with a couple of
     * inharmonic partials for the bell. */
    Recipe { tone_hz: 540.0, tone_end_hz: 540.0, sweep_ms: 1.0, tone_ms: 700.0,
             tone_level: 0.22, ratio2: 2.37, level2: 0.15,
             noise_ms: 1100.0, noise_level: 0.45, hp: 3000.0, lp: 9000.0 },
    /* 4 HT high tom */
    Recipe { tone_hz: 260.0, tone_end_hz: 190.0, sweep_ms: 45.0, tone_ms: 320.0,
             tone_level: 0.85, ratio2: 1.58, level2: 0.12,
             noise_ms: 22.0, noise_level: 0.10, hp: 1200.0, lp: 0.0 },
    /* 5 SN snare — two heads and a wire bed: tone for the drum, a longer
     * noise tail for the snares themselves. */
    Recipe { tone_hz: 195.0, tone_end_hz: 175.0, sweep_ms: 22.0, tone_ms: 130.0,
             tone_level: 0.45, ratio2: 1.68, level2: 0.30,
             noise_ms: 180.0, noise_level: 0.60, hp: 1500.0, lp: 9500.0 },
    /* 6 LT low tom */
    Recipe { tone_hz: 155.0, tone_end_hz: 108.0, sweep_ms: 60.0, tone_ms: 460.0,
             tone_level: 0.90, ratio2: 1.55, level2: 0.12,
             noise_ms: 26.0, noise_level: 0.09, hp: 900.0, lp: 0.0 },
    /*
     * 7 KK kick — the sweep does the work; the short noise burst is the
     * beater, without which it is a sine and not a drum.
     *
     * It settles at 62Hz rather than 47. Move's speaker cannot reproduce the
     * low forties at all, so the kick measured as the LOUDEST thing in the
     * kit and could not be heard: all its energy was below the driver. 62Hz
     * with a louder beater keeps the weight on headphones and gives the
     * speaker something in its range to work with.
     */
    Recipe { tone_hz: 150.0, tone_end_hz: 62.0, sweep_ms: 38.0, tone_ms: 400.0,
             tone_level: 1.0, ratio2: 1.0, level2: 0.0,
             noise_ms: 11.0, noise_level: 0.45, hp: 1800.0, lp: 0.0 },
    /* 8 HF hat pedal — a closed hat, shorter and quieter; it is a foot. */
    Recipe { tone_hz: 700.0, tone_end_hz: 700.0, sweep_ms: 1.0, tone_ms: 15.0,
             tone_level: 0.06, ratio2: 1.41, level2: 0.04,
             noise_ms: 32.0, noise_level: 1.3, hp: 4000.0, lp: 0.0 },
];

/*
 * Per-sample decay multiplier, where `ms` is the time to fall 60dB.
 *
 * Not an e-folding time constant. A recipe's numbers have to mean what a
 * drummer would mean by them — "the crash rings for about two seconds" — and
 * one time constant only gets you to a third of the way down, so reading them
 * that way made the crash ring for twenty seconds and never free its voice.
 * 60dB is the standard definition of a decay time and is inaudible in a mix.
 *
 * Clamped below 1 so a recipe can never produce a voice that never ends and a
 * stuck note nothing can clear.
 */
fn coef(ms: f32) -> f32 {
    let t = if ms < 0.5 { 0.5 } else { ms };
    /* ln(0.001) = -6.907755 */
    let c = expf(-6.907_755 / (t * 0.001 * SAMPLE_RATE));
    if c > 0.999_99 {
        0.999_99
    } else {
        c
    }
}

/* One-pole coefficient for a corner frequency. 0 disables the filter. */
fn pole(hz: f32) -> f32 {
    if hz <= 0.0 {
        return 0.0;
    }
    let x = expf(-TAU * hz / SAMPLE_RATE);
    x.clamp(0.0, 0.999_99)
}

#[derive(Clone, Copy, Default)]
pub struct Voice {
    pub active: bool,
    pub drum: u8,
    /// For oldest-voice stealing.
    pub age: u32,

    phase: f32,
    inc: f32,
    phase2: f32,
    inc2: f32,
    /// Current tone frequency, sliding towards `freq_end`.
    freq: f32,
    freq_end: f32,
    freq_coef: f32,
    ratio2: f32,

    tone_amp: f32,
    tone_coef: f32,
    level2: f32,

    noise_amp: f32,
    noise_coef: f32,

    /*
     * Two INDEPENDENT one-pole high-pass stages. Each needs its own pair of
     * history terms; sharing one pair is not a cascade but a loop feeding its
     * own output back as its own input, which diverges to infinity in a few
     * hundred samples. The tests catch it as a non-finite sample.
     */
    hp_a: f32,
    hp1_x: f32,
    hp1_y: f32,
    hp2_x: f32,
    hp2_y: f32,
    lp_a: f32,
    lp_y: f32,

    rng: u32,
}

impl Voice {
    /// Strike. `vel` is 0..127 and is applied as an amplitude, so a ghost note
    /// really is quieter — the module scores dynamics, so they had better be
    /// audible.
    pub fn strike(&mut self, drum: usize, vel: u8, age: u32, seed: u32) {
        let r = match RECIPES.get(drum) {
            Some(r) => *r,
            None => return,
        };
        /* Velocity curve: squared, because loudness is perceptual and a
         * linear map makes everything below 80 sound the same. */
        let v = (vel as f32) / 127.0;
        let gain = v * v;

        self.active = true;
        self.drum = drum as u8;
        self.age = age;

        self.phase = 0.0;
        self.phase2 = 0.0;
        self.freq = r.tone_hz;
        self.freq_end = r.tone_end_hz;
        self.freq_coef = coef(r.sweep_ms);
        self.ratio2 = r.ratio2;
        self.inc = r.tone_hz * SINE_SIZE as f32 / SAMPLE_RATE;
        self.inc2 = self.inc * r.ratio2;

        self.tone_amp = r.tone_level * gain;
        self.tone_coef = coef(r.tone_ms);
        self.level2 = r.level2 * gain;

        self.noise_amp = r.noise_level * gain;
        self.noise_coef = coef(r.noise_ms);

        self.hp_a = pole(r.hp);
        self.hp1_x = 0.0;
        self.hp1_y = 0.0;
        self.hp2_x = 0.0;
        self.hp2_y = 0.0;
        self.lp_a = pole(r.lp);
        self.lp_y = 0.0;

        /* Never zero: a zero-seeded xorshift stays at zero forever, which is a
         * hi-hat that makes no sound. */
        self.rng = seed | 1;
    }

    pub fn cut(&mut self) {
        self.active = false;
        self.tone_amp = 0.0;
        self.noise_amp = 0.0;
    }

    fn noise(&mut self) -> f32 {
        /* xorshift32 — cheap, and white enough that no cymbal has ever told. */
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;
        (self.rng as f32 / 2_147_483_648.0) - 1.0
    }

    pub fn tick(&mut self, sine: &[f32; SINE_SIZE]) -> f32 {
        if !self.active {
            return 0.0;
        }

        /* ---- the swept tone ---- */
        let mut out = 0.0;
        if self.tone_amp > 0.000_01 {
            let a = sine.get((self.phase as usize) & (SINE_SIZE - 1)).copied().unwrap_or(0.0);
            out += a * self.tone_amp;
            if self.level2 > 0.000_01 {
                let b = sine.get((self.phase2 as usize) & (SINE_SIZE - 1)).copied().unwrap_or(0.0);
                out += b * self.level2;
            }

            self.phase += self.inc;
            if self.phase >= SINE_SIZE as f32 {
                self.phase -= SINE_SIZE as f32;
            }
            self.phase2 += self.inc2;
            if self.phase2 >= SINE_SIZE as f32 {
                self.phase2 -= SINE_SIZE as f32;
            }

            /* The pitch envelope slides towards the target rather than ramping
             * to it: a struck head loses tension fastest at the start, which
             * is what an exponential approach does and a linear one does not. */
            self.freq = self.freq_end + (self.freq - self.freq_end) * self.freq_coef;
            self.inc = self.freq * SINE_SIZE as f32 / SAMPLE_RATE;
            self.inc2 = self.inc * self.ratio2;

            self.tone_amp *= self.tone_coef;
            self.level2 *= self.tone_coef;
        }

        /* ---- the filtered noise burst ---- */
        if self.noise_amp > 0.000_01 {
            let mut n = self.noise();
            if self.hp_a > 0.0 {
                /* One-pole high-pass, cascaded: one pole at 6dB/octave is too
                 * gentle to keep a hi-hat out of the kick's way. */
                let y1 = self.hp_a * (self.hp1_y + n - self.hp1_x);
                self.hp1_x = n;
                self.hp1_y = y1;
                let y2 = self.hp_a * (self.hp2_y + y1 - self.hp2_x);
                self.hp2_x = y1;
                self.hp2_y = y2;
                n = y2;
            }
            if self.lp_a > 0.0 {
                self.lp_y = self.lp_y * self.lp_a + n * (1.0 - self.lp_a);
                n = self.lp_y;
            }
            out += n * self.noise_amp;
            self.noise_amp *= self.noise_coef;
        }

        /* Retire once both envelopes are inaudible, so a voice frees itself
         * and the stealer rarely has to. */
        if self.tone_amp <= 0.000_01 && self.noise_amp <= 0.000_01 {
            self.active = false;
        }
        out
    }
}

/*
 * The metronome, which is not one of the drums.
 *
 * It has its own type and its own reserved slots because it is the thing you
 * are being MEASURED against. A click that gets stolen by the sixteenth note
 * of a busy bar — which is exactly when voices run out — would be a trainer
 * that loses the beat precisely when the player needs it most. Two slots, a
 * pool of their own, never allocated to anything else.
 */
#[derive(Clone, Copy, Default)]
pub struct Click {
    pub active: bool,
    phase: f32,
    inc: f32,
    amp: f32,
    coef: f32,
}

pub const CLICK_BEAT_HZ: f32 = 1000.0;
pub const CLICK_DOWN_HZ: f32 = 1600.0;
const CLICK_MS: f32 = 22.0;

impl Click {
    /// `downbeat` pitches it up. Knowing where bar one is without counting is
    /// most of what a metronome is for.
    pub fn strike(&mut self, downbeat: bool, level: f32) {
        let hz = if downbeat { CLICK_DOWN_HZ } else { CLICK_BEAT_HZ };
        self.active = true;
        self.phase = 0.0;
        self.inc = hz * SINE_SIZE as f32 / SAMPLE_RATE;
        self.amp = level;
        self.coef = coef(CLICK_MS);
    }

    pub fn cut(&mut self) {
        self.active = false;
        self.amp = 0.0;
    }

    pub fn tick(&mut self, sine: &[f32; SINE_SIZE]) -> f32 {
        if !self.active {
            return 0.0;
        }
        let s = sine.get((self.phase as usize) & (SINE_SIZE - 1)).copied().unwrap_or(0.0);
        let out = s * self.amp;
        self.phase += self.inc;
        if self.phase >= SINE_SIZE as f32 {
            self.phase -= SINE_SIZE as f32;
        }
        self.amp *= self.coef;
        if self.amp <= 0.000_01 {
            self.active = false;
        }
        out
    }
}
