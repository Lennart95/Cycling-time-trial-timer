import { useEffect, useRef } from 'react'
import { nextScheduled, scheduledStartEpoch, useStore } from '../store'
import { cancelCountdown, playGoNow, scheduleCountdown } from '../lib/sound'

// Module singleton guard so React StrictMode's double-mount (dev) can't run
// two countdown engines at once.
let engineMounted = false

const ARM_WINDOW_SEC = 13 // start scheduling tones this long before a rider's start
// (must exceed the earliest countdown beep — the 10 s marker — with lead to spare)

/**
 * Drives the start countdown sound. When the target rider comes within the arm
 * window it schedules the pips + release tone on the audio clock (sample-accurate
 * to the target instant). Re-arms when the target changes, or when its instant
 * is moved (e.g. "Countdown next now"); cancels pending pips on pause / stop,
 * and when a rider is released early it drops the leftover pips and sounds the
 * release immediately.
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
            // released early (e.g. "Start next now") — drop pips, sound GO now
            cancelCountdown()
            playGoNow()
          }
          // released on schedule: the pre-scheduled GO fires on its own
          st.current.armedFor = null
          st.current.armedSched = null
        }
      }

      const unarm = () => {
        if (st.current.armedFor != null) {
          cancelCountdown()
          st.current.armedFor = null
          st.current.armedSched = null
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

      const secsLeft = (targetSched - Date.now()) / 1000
      if (st.current.armedFor == null && secsLeft > 0.1 && secsLeft <= ARM_WINDOW_SEC + 0.05) {
        st.current.armedFor = targetId
        st.current.armedSched = targetSched
        scheduleCountdown(targetSched - Date.now(), s.config.countdownSec)
      }
    }, 50)

    return () => {
      clearInterval(iv)
      cancelCountdown()
      engineMounted = false
    }
  }, [])
}
