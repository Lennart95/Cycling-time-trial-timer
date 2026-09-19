import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCountdown } from './useCountdown'
import { countdownPlan } from '../lib/sound'
import { useStore } from '../store'
import type { Participant } from '../types'

// The engine (useCountdown.ts) is a just-in-time scheduler: rather than
// committing every beep to the audio clock up front, it waits until each tone
// in countdownPlan() is within LOOKAHEAD_MS (300ms) of due before handing it
// to scheduleToneAtEpoch. These tests drive a fake wall clock across a whole
// countdown and check every beep is actually committed in that narrow window
// relative to when it's due — i.e. that the sound stays in sync with the
// countdown rather than firing early, late, or out of order.

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
const cancelCountdown = sound.cancelCountdown as Mock
const playGoNow = sound.playGoNow as Mock

const TICK_MS = 50
const LOOKAHEAD_MS = 300

function makeRider(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'r1',
    bib: '1',
    name: 'Rider One',
    category: '',
    startOrder: 1,
    startTime: null,
    finishTime: null,
    status: 'scheduled',
    ...overrides,
  }
}

describe('useCountdown (JIT scheduler)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    scheduleToneAtEpoch.mockClear()
    cancelCountdown.mockClear()
    playGoNow.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('commits every tone within LOOKAHEAD_MS of its due instant, in the order the countdown actually plays', () => {
    const now = 1_700_000_000_000
    vi.setSystemTime(now)

    const countdownSec = 10
    const target = now + countdownSec * 1000 // rider 1 starts exactly countdownSec from "now"

    useStore.setState({
      config: { ...useStore.getState().config, countdownSec, startIntervalSec: 60 },
      participants: [makeRider()],
      sequenceStartedAt: now,
      pauseOffsetMs: 0,
      running: true,
      paused: false,
      pausedAt: null,
      manualCountdown: null,
    })

    const { unmount } = renderHook(() => useCountdown())

    const plan = countdownPlan(target, countdownSec)
    expect(plan).toHaveLength(7) // 10s marker + 5·4·3·2·1 + GO

    // Advance the fake clock one scheduler tick (50ms) at a time across the
    // whole countdown, recording the wall-clock instant of every commit.
    const callTimes: number[] = []
    scheduleToneAtEpoch.mockImplementation(() => callTimes.push(Date.now()))

    const totalTicks = Math.ceil((countdownSec * 1000 + 500) / TICK_MS)
    for (let i = 0; i < totalTicks; i++) {
      act(() => {
        vi.advanceTimersByTime(TICK_MS)
      })
    }

    expect(scheduleToneAtEpoch).toHaveBeenCalledTimes(plan.length)

    // Each commit must land within one scheduler tick of the lookahead
    // window around its due instant — never early beyond LOOKAHEAD_MS, never
    // more than a tick late — and the commits must come out in the same
    // order the countdown plays them.
    plan.forEach((tone, i) => {
      const calledAt = callTimes[i]
      expect(calledAt).toBeLessThanOrEqual(tone.epochMs + TICK_MS)
      expect(calledAt).toBeGreaterThan(tone.epochMs - LOOKAHEAD_MS - TICK_MS)
      expect(scheduleToneAtEpoch).toHaveBeenNthCalledWith(
        i + 1,
        tone.epochMs,
        tone.freq,
        tone.durMs,
        tone.gain,
      )
    })

    // The GO tone is committed to the audio clock ahead of time (within the
    // lookahead window, like every other tone), but the instant it's told to
    // become audible at is the target itself, exactly.
    const goCall = scheduleToneAtEpoch.mock.calls[plan.length - 1]
    expect(goCall[0]).toBe(target)

    unmount()
  })

  it('re-arms and reschedules when the target start time moves (e.g. postponed)', () => {
    const now = 1_700_000_000_000
    vi.setSystemTime(now)
    const countdownSec = 10

    useStore.setState({
      config: { ...useStore.getState().config, countdownSec, startIntervalSec: 60 },
      participants: [makeRider()],
      sequenceStartedAt: now,
      pauseOffsetMs: 0,
      running: true,
      paused: false,
      pausedAt: null,
      manualCountdown: null,
    })

    const { unmount } = renderHook(() => useCountdown())

    // Let the 10s-marker tone commit (due at now+0, within lookahead already).
    act(() => {
      vi.advanceTimersByTime(TICK_MS)
    })
    expect(scheduleToneAtEpoch).toHaveBeenCalledTimes(1)

    // Postpone by 5s — the engine should drop the stale plan and cancel it.
    act(() => {
      useStore.setState({ pauseOffsetMs: 5000 })
      vi.advanceTimersByTime(TICK_MS)
    })
    expect(cancelCountdown).toHaveBeenCalled()

    const newTarget = now + countdownSec * 1000 + 5000
    scheduleToneAtEpoch.mockClear()
    const totalTicks = Math.ceil((countdownSec * 1000 + 5000 + 500) / TICK_MS)
    for (let i = 0; i < totalTicks; i++) {
      act(() => {
        vi.advanceTimersByTime(TICK_MS)
      })
    }

    const plan = countdownPlan(newTarget, countdownSec)
    expect(scheduleToneAtEpoch).toHaveBeenCalledTimes(plan.length)
    const lastCall = scheduleToneAtEpoch.mock.calls[scheduleToneAtEpoch.mock.calls.length - 1]
    expect(lastCall[0]).toBe(newTarget) // GO still lands on the new target, not the old one

    unmount()
  })

  it('cancels pending tones and sounds an immediate GO when the rider is released early', () => {
    const now = 1_700_000_000_000
    vi.setSystemTime(now)
    const countdownSec = 10

    useStore.setState({
      config: { ...useStore.getState().config, countdownSec, startIntervalSec: 60 },
      participants: [makeRider()],
      sequenceStartedAt: now,
      pauseOffsetMs: 0,
      running: true,
      paused: false,
      pausedAt: null,
      manualCountdown: null,
    })

    const { unmount } = renderHook(() => useCountdown())

    // Arm, then jump partway through the countdown without letting GO fire.
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // "Start next now": the rider's startTime lands well before the armed
    // target — the engine must notice on its next tick and fire GO itself.
    act(() => {
      useStore.setState({
        participants: [makeRider({ startTime: Date.now(), status: 'started' })],
      })
      vi.advanceTimersByTime(TICK_MS)
    })

    expect(cancelCountdown).toHaveBeenCalled()
    expect(playGoNow).toHaveBeenCalledTimes(1)

    unmount()
  })
})
