/*
 * The event queue: parameter/MIDI thread in, audio thread out.
 *
 * Carried over from the pitched module apart from the event vocabulary.
 *
 * Single producer, single consumer, lock free, fixed capacity. A direct
 * translation of the C — same algorithm, same memory orders — because the
 * orderings are the part that is easy to "improve" into a bug, and the C is
 * correct and has been running.
 */
use core::sync::atomic::{AtomicU32, Ordering};

pub const RING: usize = 256; /* power of two */
const MASK: u32 = (RING - 1) as u32;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Event {
    #[default]
    None,
    /// Strike a drum. There is no note-off: a drum is a one-shot and its
    /// envelope decides when it stops. Carrying a release the player can
    /// never use would be a state machine kept alive for nothing.
    Strike {
        drum: u8,
        vel: u8,
    },
    /// The metronome. Reserved slots, never stolen by the kit.
    Click {
        downbeat: bool,
    },
    /// Cut everything dead — CC 120 All Sound Off, and System Reset.
    Panic,
    /// Let everything ring out — CC 123 All Notes Off. The polite one, and
    /// the one a host broadcasts on the way out. For a kit of one-shots the
    /// difference is a crash cymbal: cutting it dead clicks, letting it ring
    /// costs nothing, so the distinction is worth keeping.
    ReleaseAll,
}

pub struct Ring {
    buf: [Event; RING],
    w: AtomicU32,
    r: AtomicU32,
}

impl Ring {
    pub const fn new() -> Self {
        Self {
            buf: [Event::None; RING],
            w: AtomicU32::new(0),
            r: AtomicU32::new(0),
        }
    }

    /// Push, dropping the event if the ring is full. Dropping is deliberate:
    /// blocking here would block the SPI callback.
    pub fn push(&mut self, e: Event) {
        let w = self.w.load(Ordering::Relaxed);
        let r = self.r.load(Ordering::Acquire);
        if (w.wrapping_add(1) & MASK) == (r & MASK) {
            return;
        }
        if let Some(slot) = self.buf.get_mut((w & MASK) as usize) {
            *slot = e;
        }
        self.w.store(w.wrapping_add(1), Ordering::Release);
    }

    pub fn pop(&mut self) -> Option<Event> {
        let r = self.r.load(Ordering::Relaxed);
        let w = self.w.load(Ordering::Acquire);
        if (r & MASK) == (w & MASK) {
            return None;
        }
        let e = self.buf.get((r & MASK) as usize).copied();
        self.r.store(r.wrapping_add(1), Ordering::Release);
        e
    }
}
