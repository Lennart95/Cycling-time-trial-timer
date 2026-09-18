// Start countdown, fully synthesized with the Web Audio API — modelled on the
// UCI velodrome start signal:
//
//   • a single marker beep at 10 s to go
//   • a beep on each of the final 5 s (5 · 4 · 3 · 2 · 1), one per second
//   • a short, higher (octave-up) tone at zero — the gate release; the rider
//     goes on the LEADING edge of this tone
//
// Every beep is two oscillators (a fundamental plus a sub-octave layer) through
// one gain envelope — lower and fuller than a single thin sine, still a clean
// synthesized tone (no noise to denoise). Tones are committed to the audio
// clock only moments before they're due (see scheduleToneAtEpoch) rather than
// the whole sequence at once, so a stall in the audio hardware's own clock
// can't silently turn into an accumulating delay — see useCountdown.ts, which
// drives this with a short-lookahead scheduler.

let ctx: AudioContext | null = null

function audio(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor()
  }
  return ctx
}

/** Call from a user gesture (the Start button) to satisfy autoplay policies. */
export function unlockAudio(): void {
  const a = audio()
  if (a.state === 'suspended') void a.resume()
}

/**
 * Estimated delay between an AudioContext instant and the sound actually
 * reaching the speaker (driver/output buffering). `currentTime` scheduling is
 * exact on the audio graph, but without this the release tone would start
 * processing on time and still arrive at the rider's ears late.
 */
function outputLatencySec(a: AudioContext): number {
  const v = a.outputLatency ?? a.baseLatency ?? 0
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0
}

interface Voice {
  oscs: OscillatorNode[]
  amp: GainNode
}
let scheduled: Voice[] = []

function scheduleTone(at: number, freq: number, durMs: number, gain: number): void {
  const a = audio()
  const amp = a.createGain()
  amp.connect(a.destination)

  const dur = durMs / 1000
  const t = Math.max(at, a.currentTime)
  amp.gain.setValueAtTime(0.0001, t)
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  amp.gain.setValueAtTime(gain, t + dur - 0.03)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  // Fundamental (triangle, for a fuller body than a bare sine) plus a
  // sub-octave sine layered underneath — gives the beep more low-end presence.
  const oscs: OscillatorNode[] = []
  const layer = (f: number, type: OscillatorType, level: number) => {
    const osc = a.createOscillator()
    const level_ = a.createGain()
    level_.gain.value = level
    osc.type = type
    osc.frequency.value = f
    osc.connect(level_)
    level_.connect(amp)
    osc.start(t)
    osc.stop(t + dur + 0.02)
    oscs.push(osc)
  }
  layer(freq, 'triangle', 1)
  layer(freq / 2, 'sine', 0.6)

  const v: Voice = { oscs, amp }
  scheduled.push(v)
  oscs[0].onended = () => {
    try {
      amp.disconnect()
    } catch {
      /* ignore */
    }
    scheduled = scheduled.filter((x) => x !== v)
  }
}

// No official public spec exists for the pre-start 5·4·3·2·1 sequence (it's
// proprietary to whichever timing system is on site). These two frequencies
// are a real reference point though: a UCI-approved track timing vendor
// (AVK Group's TRACKER) documents its countdown beeper as 500 Hz / 1000 Hz —
// exactly an octave apart — which is what's used here.
const PIP_FREQ = 500 // the per-second beeps (10 s marker and 5·4·3·2·1)
const PIP_MS = 380
const PIP_GAIN = 0.3

// The 10 s marker is the same tone, held twice as long, so it reads as
// distinct from the closer, shorter 5·4·3·2·1 pips.
const MARKER_MS = PIP_MS * 2

const GO_FREQ = 1000 // release tone at zero — an octave above the pips
const GO_MS = 1100
const GO_GAIN = 0.34

/** Seconds-to-go at which a beep sounds, on top of the final 1..5 pips. */
const MARKER_SECONDS = [10]
const FINAL_PIPS = 5

export interface ToneEvent {
  /** Wall-clock instant (epoch ms) this tone should become audible at. */
  epochMs: number
  freq: number
  durMs: number
  gain: number
}

/**
 * The full set of tones for a countdown ending at `targetEpochMs`, in wall-clock
 * time — pure data, no audio calls. `countdownSec` clamps which beeps are used
 * (the 10 s marker is dropped if the configured countdown is shorter).
 */
export function countdownPlan(targetEpochMs: number, countdownSec: number): ToneEvent[] {
  const pips = new Set<number>()
  for (let k = 1; k <= FINAL_PIPS && k <= countdownSec + 0.05; k++) pips.add(k)
  const markers = new Set<number>()
  for (const m of MARKER_SECONDS) if (m <= countdownSec + 0.05 && !pips.has(m)) markers.add(m)

  const plan: ToneEvent[] = [
    ...[...pips].map((k) => ({
      epochMs: targetEpochMs - k * 1000,
      freq: PIP_FREQ,
      durMs: PIP_MS,
      gain: PIP_GAIN,
    })),
    ...[...markers].map((k) => ({
      epochMs: targetEpochMs - k * 1000,
      freq: PIP_FREQ,
      durMs: MARKER_MS,
      gain: PIP_GAIN,
    })),
  ]
  plan.push({ epochMs: targetEpochMs, freq: GO_FREQ, durMs: GO_MS, gain: GO_GAIN })
  return plan.sort((a, b) => a.epochMs - b.epochMs)
}

/**
 * Schedule one tone to become audible at wall-clock `epochMs`. Converts to the
 * audio clock fresh, right now — call this with a short lead time (well under
 * a second) rather than committing tones far in advance: `AudioContext.currentTime`
 * runs on the audio hardware's own clock, which can stall or drift relative to
 * the system clock (device hiccups, load spikes). A tone committed 10+ seconds
 * ahead has that whole window for such a stall to turn into an audible delay;
 * one committed moments before doesn't.
 */
export function scheduleToneAtEpoch(epochMs: number, freq: number, durMs: number, gain: number): void {
  const a = audio()
  if (a.state === 'suspended') void a.resume()
  const at = a.currentTime + (epochMs - Date.now()) / 1000 - outputLatencySec(a)
  scheduleTone(at, freq, durMs, gain)
}

/** Immediate release tone — used when a rider is sent early. */
export function playGoNow(): void {
  const a = audio()
  if (a.state === 'suspended') void a.resume()
  // scheduleTone() clamps to `currentTime` itself, so an aggressive negative
  // offset here just means "as soon as physically possible".
  scheduleTone(a.currentTime + 0.01 - outputLatencySec(a), GO_FREQ, GO_MS, GO_GAIN)
}

/** Stop and drop every not-yet-finished scheduled tone. */
export function cancelCountdown(): void {
  for (const v of scheduled) {
    try {
      v.amp.gain.cancelScheduledValues(0)
      for (const osc of v.oscs) osc.stop()
    } catch {
      /* already stopped */
    }
    try {
      v.amp.disconnect()
    } catch {
      /* ignore */
    }
  }
  scheduled = []
}
