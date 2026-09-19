import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCountdown } from '../hooks/useCountdown'
import { useRaceClock } from '../hooks/useRaceClock'
import { countdownPlan } from '../lib/sound'
import { computeResults, scheduledStartEpoch, useStore } from '../store'
import type { Participant } from '../types'

// End-to-end timing check for a full field: 100 riders started by the real
// starter engine (useRaceClock) with the real countdown scheduler
// (useCountdown) armed alongside it — exactly how App.tsx runs them together
// — then each rider finished at a known elapsed time. Verifies three things
// stay in sync across the whole race, not just for one rider:
//   1. every rider's official start lands on their exact scheduled epoch
//      (not "whenever the 100ms poll noticed" — useRaceClock fires at the
//      scheduled instant, so poll jitter can't leak into official times)
//   2. every countdown beep for every rider's start is committed at the
//      right offset from that rider's own start, in order, gapless
//   3. finish timing (elapsed, ranking, gap-to-leader) is computed exactly
//      from the recorded start/finish epochs, for all 100 riders

vi.mock('../lib/sound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sound')>()
  return {
    ...actual,
    scheduleToneAtEpoch: vi.fn(),
    cancelCountdown: vi.fn(),
    playGoNow: vi.fn(),
  }
})

const sound = await import('../lib/sound')
const scheduleToneAtEpoch = sound.scheduleToneAtEpoch as Mock

const RIDER_COUNT = 100
const COUNTDOWN_SEC = 5
const INTERVAL_SEC = 8 // > COUNTDOWN_SEC, so consecutive riders' countdowns never overlap
const FIXED_NOW = 1_700_000_000_000

function makeField(count: number): Participant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `rider-${i + 1}`,
    bib: String(i + 1),
    name: `Rider ${i + 1}`,
    category: '',
    startOrder: i + 1,
    startTime: null,
    finishTime: null,
    status: 'scheduled' as const,
  }))
}

// Deterministic but non-monotonic-in-startOrder spread, so the results
// ranking test can't pass by accident just because start order == finish
// order.
function elapsedMsFor(startOrder: number): number {
  return 20 * 60_000 + ((startOrder * 928_371) % 180_000)
}

describe('100-rider race: countdown + starts + finishes stay in sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
    scheduleToneAtEpoch.mockClear()

    useStore.setState({
      config: {
        ...useStore.getState().config,
        countdownSec: COUNTDOWN_SEC,
        startIntervalSec: INTERVAL_SEC,
        plannedStartTime: '',
      },
      participants: makeField(RIDER_COUNT),
      finishes: [],
      sequenceStartedAt: null,
      pauseOffsetMs: 0,
      running: false,
      paused: false,
      pausedAt: null,
      manualCountdown: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('starts every rider on their exact scheduled epoch, beeps every countdown in sync, and finishes with correct elapsed/ranking', () => {
    act(() => {
      useStore.getState().startSequence()
    })
    expect(useStore.getState().sequenceStartedAt).toBe(FIXED_NOW)

    const expectedStart = (startOrder: number) =>
      FIXED_NOW + COUNTDOWN_SEC * 1000 + (startOrder - 1) * INTERVAL_SEC * 1000

    // Sanity check against the store's own formula before running anything.
    for (let order = 1; order <= RIDER_COUNT; order++) {
      expect(scheduledStartEpoch(useStore.getState(), order)).toBe(expectedStart(order))
    }

    // Mount off the round-number grid (37ms after the sequence anchor) so the
    // starter engine's 100ms poll can never coincide exactly with a scheduled
    // epoch by construction. That's what makes the exact-epoch assertions
    // below meaningful: if the engine ever used "now" (poll time) instead of
    // the rider's actual scheduled instant, this offset would surface it as
    // an up-to-100ms mismatch instead of accidentally lining up.
    act(() => {
      vi.advanceTimersByTime(37)
    })

    const { unmount } = renderHook(() => {
      useCountdown()
      useRaceClock()
    })

    const totalMs = expectedStart(RIDER_COUNT) - Date.now() + 2000
    act(() => {
      vi.advanceTimersByTime(totalMs)
    })

    // --- 1. every start landed exactly on its scheduled epoch -------------
    const finalParticipants = useStore.getState().participants
    expect(finalParticipants).toHaveLength(RIDER_COUNT)
    for (const p of finalParticipants) {
      expect(p.status).toBe('started')
      expect(p.startTime).toBe(expectedStart(p.startOrder))
    }
    // Consecutive riders are spaced by exactly INTERVAL_SEC — no drift
    // accumulated over the field.
    const sorted = [...finalParticipants].sort((a, b) => a.startOrder - b.startOrder)
    for (let i = 1; i < sorted.length; i++) {
      expect((sorted[i].startTime as number) - (sorted[i - 1].startTime as number)).toBe(
        INTERVAL_SEC * 1000,
      )
    }

    // --- 2. every countdown beep, for every rider, in sync ----------------
    const expectedTones = sorted.flatMap((p) => countdownPlan(p.startTime as number, COUNTDOWN_SEC))
    expect(scheduleToneAtEpoch).toHaveBeenCalledTimes(expectedTones.length)
    expectedTones.forEach((tone, i) => {
      expect(scheduleToneAtEpoch).toHaveBeenNthCalledWith(
        i + 1,
        tone.epochMs,
        tone.freq,
        tone.durMs,
        tone.gain,
      )
    })
    // In particular: one GO tone per rider, each landing exactly on that
    // rider's own start — no rider's release tone drifts onto a neighbor's.
    const goEpochs = scheduleToneAtEpoch.mock.calls
      .filter(([, freq]) => freq === 1000)
      .map(([epochMs]) => epochMs)
    expect(goEpochs).toEqual(sorted.map((p) => p.startTime))

    // --- 3. finish timing: elapsed, ranking, gap ---------------------------
    act(() => {
      for (const p of finalParticipants) {
        const finishTime = (p.startTime as number) + elapsedMsFor(p.startOrder)
        vi.setSystemTime(finishTime)
        useStore.getState().finishRiderNow(p.id)
      }
    })

    const results = computeResults(useStore.getState())
    expect(results).toHaveLength(RIDER_COUNT)

    // Every result's elapsed is exactly finish - start, matching what we set.
    for (const r of results) {
      expect(r.elapsed).toBe(elapsedMsFor(r.p.startOrder))
      expect(r.elapsed).toBe((r.p.finishTime as number) - (r.p.startTime as number))
    }

    // Ranked strictly by elapsed, ascending, 1-based, contiguous.
    for (let i = 0; i < results.length; i++) {
      expect(results[i].rank).toBe(i + 1)
      if (i > 0) expect(results[i].elapsed).toBeGreaterThanOrEqual(results[i - 1].elapsed)
    }

    // Gap is relative to the winner, zero for the winner.
    const best = results[0].elapsed
    expect(results[0].gap).toBe(0)
    for (const r of results) expect(r.gap).toBe(r.elapsed - best)

    unmount()
  })
})
