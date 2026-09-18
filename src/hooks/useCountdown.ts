import { useEffect, useRef } from 'react'
import { nextScheduled, scheduledStartEpoch, useStore } from '../store'
import { cancelCountdown, countdownPlan, playGoNow, scheduleToneAtEpoch } from '../lib/sound'

// Module singleton guard so React StrictMode's double-mount (dev) can't run
// two countdown engines at once.
let engineMounted = false

// How far ahead of a tone's due instant we'll commit it to the audio clock.
// Short on purpose: AudioContext.currentTime runs on the audio hardware's own
// clock, which can stall relative to the system clock under load — a tone
// committed 10+ seconds ahead has that whole window for a stall to turn into
// an audible delay, and over a long session those add up (that was the bug:
// beeps drifting later and later). Committing only moments before each tone
// is due means any single hiccup can add at most LOOKAHEAD_MS of lateness,
// and the next tick's fresh clock reading corrects for the next tone.
const LOOKAHEAD_MS = 300

/**
 * Drives the start countdown sound with a short-lookahead, just-in-time
 * scheduler (see LOOKAHEAD_MS). Re-arms when the target changes, or when its
 * instant is moved (e.g. "Countdown next now"); cancels pending tones on
 * pause / stop, and when a rider is released early it drops the leftover
 * tones and sounds the release immediately.
 *
 * The target is either a standalone `manualCountdown` (see ManualCountdown —
 * takes priority, since it's a deliberate one-rider action) or the shared
 * sequence's next rider, skipping anyone flagged `needsManualStart` so a
 * countdown never plays for someone the engine won't actually start.
 */
export function useCountdown(): void {
  const st = useRef({
    armedFor: null as string | null,
    armedSched: null as number | null,
    firedEpochs: new Set<number>(),
    startedIds: new Set<string>(),
    primed: false,
  })

  useEffect(() => {
    if (engineMounted) return
    engineMounted = true

    const iv = setInterval(() => {
      const s = useStore.getState()
      const startedIds = new Set(
        s.participants.filter((p) => p.startTime != null).map((p) => p.id),
      )

      // detect a rider that just left
      if (!st.current.primed) {
        st.current.startedIds = startedIds
        st.current.primed = true
      } else {
        let freshId: string | null = null
        for (const id of startedIds) {
          if (!st.current.startedIds.has(id)) {
            freshId = id
            break
          }
        }
        st.current.startedIds = startedIds
        if (freshId != null && freshId === st.current.armedFor) {
          const armed = s.participants.find((p) => p.id === freshId)
          const expected = st.current.armedSched
          if (armed?.startTime != null && expected != null && armed.startTime < expected - 250) {
            // released early (e.g. "Start next now") — drop pending tones, sound GO now
            cancelCountdown()
            playGoNow()
          }
          // released on schedule: the already-committed GO fires on its own
          st.current.armedFor = null
          st.current.armedSched = null
          st.current.firedEpochs = new Set()
        }
      }

      const unarm = () => {
        if (st.current.armedFor != null) {
          cancelCountdown()
          st.current.armedFor = null
          st.current.armedSched = null
          st.current.firedEpochs = new Set()
        }
      }

      if (!s.running || s.paused) {
        unarm()
        return
      }

      let targetId: string | null = null
      let targetSched: number | null = null
      if (s.manualCountdown) {
        const p = s.participants.find((pp) => pp.id === s.manualCountdown?.participantId)
        if (p && p.status === 'scheduled') {
          targetId = p.id
          targetSched = s.manualCountdown.dueAt
        }
      }
      if (targetId == null) {
        const next = nextScheduled(s)
        // A rider flagged needsManualStart never auto-fires, so never sound a
        // countdown for one either — would otherwise reach "GO" with nobody
        // actually starting.
        if (next && !next.needsManualStart) {
          targetId = next.id
          targetSched = scheduledStartEpoch(s, next.startOrder)
        }
      }

      if (targetId == null || targetSched == null) {
        unarm()
        return
      }

      if (st.current.armedFor != null) {
        const rescheduled =
          st.current.armedSched != null && Math.abs(targetSched - st.current.armedSched) > 50
        if (st.current.armedFor !== targetId || rescheduled) unarm()
      }

      if (st.current.armedFor == null) {
        st.current.armedFor = targetId
        st.current.armedSched = targetSched
        st.current.firedEpochs = new Set()
      }

      // Just-in-time: commit each tone only once it's within LOOKAHEAD_MS of
      // due, converting to the audio clock fresh at that moment.
      const now = Date.now()
      for (const tone of countdownPlan(targetSched, s.config.countdownSec)) {
        if (st.current.firedEpochs.has(tone.epochMs)) continue
        const delta = tone.epochMs - now
        if (delta > LOOKAHEAD_MS) continue // not due yet — check again next tick
        st.current.firedEpochs.add(tone.epochMs) // handle exactly once, due or overdue
        if (delta >= -500) scheduleToneAtEpoch(tone.epochMs, tone.freq, tone.durMs, tone.gain)
        // else: badly overdue (the app was frozen) — skip rather than firing a burst of stale beeps
      }
    }, 50)

    return () => {
      clearInterval(iv)
      cancelCountdown()
      engineMounted = false
    }
  }, [])
}
