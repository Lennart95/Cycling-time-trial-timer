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
// synthesized tone (no noise to denoise). Every tone is scheduled ahead of time
// on the audio clock, so it lands exactly on the rider's release.

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

const GO_FREQ = 1000 // release tone at zero — an octave above the pips
const GO_MS = 1100
const GO_GAIN = 0.34

/** Seconds-to-go at which a beep sounds, on top of the final 1..5 pips. */
const MARKER_SECONDS = [10]
const FINAL_PIPS = 5

/**
 * Schedule the countdown so the release lands `msUntilStart` from now.
 * `countdownSec` clamps which beeps are used (a 10 s marker is skipped if the
 * configured countdown is shorter than that).
 */
export function scheduleCountdown(msUntilStart: number, countdownSec: number): void {
  cancelCountdown()
  const a = audio()
  if (a.state === 'suspended') void a.resume()

  // Shift the whole schedule earlier by the output latency, so what's audible
  // lands on the target instant instead of what's merely queued to the graph.
  const startAt = a.currentTime + msUntilStart / 1000 - outputLatencySec(a)

  const seconds = new Set<number>()
  for (let k = 1; k <= FINAL_PIPS && k <= countdownSec + 0.05; k++) seconds.add(k)
  for (const m of MARKER_SECONDS) if (m <= countdownSec + 0.05) seconds.add(m)

  for (const k of seconds) {
    const at = startAt - k
    if (at > a.currentTime + 0.02) scheduleTone(at, PIP_FREQ, PIP_MS, PIP_GAIN)
  }
  if (startAt > a.currentTime + 0.02) scheduleTone(startAt, GO_FREQ, GO_MS, GO_GAIN)
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
