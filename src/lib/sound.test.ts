import { describe, expect, it } from 'vitest'
import { countdownPlan } from './sound'

// countdownPlan is the pure schedule that everything else (the JIT scheduler in
// useCountdown, the actual Web Audio calls in scheduleToneAtEpoch) is driven
// from. If the offsets here are wrong, no amount of correct real-time
// scheduling downstream can make the beeps sound "in sync" with the countdown.

describe('countdownPlan', () => {
  it('times every tone as an exact whole-second offset from the target, ending with GO on the target itself', () => {
    const target = 1_000_000_000_000
    const plan = countdownPlan(target, 10)
    const offsetsSec = plan.map((t) => (target - t.epochMs) / 1000)
    expect(offsetsSec).toEqual([10, 5, 4, 3, 2, 1, 0])
  })

  it('returns tones sorted in the order they should actually play (earliest first)', () => {
    const target = 1_000_000_000_000
    const plan = countdownPlan(target, 10)
    const epochs = plan.map((t) => t.epochMs)
    expect(epochs).toEqual([...epochs].sort((a, b) => a - b))
  })

  it('the GO tone lands exactly on the target epoch, not a beep-duration early or late', () => {
    const target = 1_234_567_890
    const plan = countdownPlan(target, 10)
    const go = plan[plan.length - 1]
    expect(go.epochMs).toBe(target)
    expect(go.freq).toBe(1000)
  })

  it('drops the 10s marker when the configured countdown is shorter than 10s', () => {
    const target = 1_000_000_000_000
    const plan = countdownPlan(target, 5)
    const offsetsSec = plan.map((t) => (target - t.epochMs) / 1000)
    expect(offsetsSec).toEqual([5, 4, 3, 2, 1, 0])
  })

  it('clamps the per-second pips to a countdown shorter than 5s', () => {
    const target = 1_000_000_000_000
    const plan = countdownPlan(target, 3)
    const offsetsSec = plan.map((t) => (target - t.epochMs) / 1000)
    expect(offsetsSec).toEqual([3, 2, 1, 0])
  })

  it('never double-books the 10s mark when countdownSec is exactly 10 (marker and pip would coincide)', () => {
    // MARKER_SECONDS = [10] and FINAL_PIPS = 5 don't overlap today, but this
    // guards the dedup logic (`!pips.has(m)`) that exists specifically to
    // keep a future change from firing two tones at once.
    const target = 1_000_000_000_000
    const plan = countdownPlan(target, 10)
    const tenSecondTones = plan.filter((t) => target - t.epochMs === 10_000)
    expect(tenSecondTones).toHaveLength(1)
  })

  it('holds the 10s marker for exactly twice the duration of a per-second pip, at the same pitch', () => {
    const target = 1_000_000_000_000
    const plan = countdownPlan(target, 10)
    const marker = plan.find((t) => target - t.epochMs === 10_000)!
    const pip = plan.find((t) => target - t.epochMs === 5_000)!
    expect(marker.freq).toBe(pip.freq)
    expect(marker.durMs).toBe(pip.durMs * 2)
  })

  it('sounds the GO tone an octave above the pips, as the audible release marker', () => {
    const target = 1_000_000_000_000
    const plan = countdownPlan(target, 10)
    const pip = plan.find((t) => target - t.epochMs === 5_000)!
    const go = plan[plan.length - 1]
    expect(go.freq).toBe(pip.freq * 2)
  })

  it('is stable across arbitrary target epochs — offsets never depend on the target value itself', () => {
    const planA = countdownPlan(1_700_000_000_123, 10)
    const planB = countdownPlan(1_700_000_555_777, 10)
    const offsetsA = planA.map((t, i) => 1_700_000_000_123 - t.epochMs)
    const offsetsB = planB.map((t, i) => 1_700_000_555_777 - t.epochMs)
    expect(offsetsB).toEqual(offsetsA)
  })
})
