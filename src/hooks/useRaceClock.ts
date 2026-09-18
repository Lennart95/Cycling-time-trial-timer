import { useEffect } from 'react'
import { byStartOrder, scheduledStartEpoch, useStore } from '../store'

/**
 * The starter engine. Runs one interval for the whole app: every 100 ms it
 * checks the wall clock against each waiting rider's scheduled start and fires
 * any that are due. Riders start at their *scheduled* instant (not "now"), so
 * loop jitter never affects official times, and a brief app freeze is recovered
 * by firing the overdue starts on the next tick — no matter how overdue, so a
 * genuinely long freeze still catches up correctly.
 *
 * A rider flagged `needsManualStart` (see Participant — reset back to
 * 'scheduled' after having a start time) is skipped by the main loop below.
 * This uses the exact same flag as nextScheduled()/RaceView, so the engine
 * never disagrees with what the "Next to start" card and countdown audio are
 * showing. Getting such a rider going again is a deliberate action: either
 * Start next now, or arming a standalone `manualCountdown` for them (see
 * ManualCountdown) — handled separately here since it targets one specific
 * rider independent of the shared sequence schedule.
 */
export function useRaceClock(): void {
  useEffect(() => {
    const iv = setInterval(() => {
      const s = useStore.getState()
      if (!s.running || s.paused) return

      const now = Date.now()

      if (s.manualCountdown) {
        const { participantId, dueAt } = s.manualCountdown
        const target = s.participants.find((p) => p.id === participantId)
        if (!target || target.status !== 'scheduled') {
          s.cancelManualCountdown()
        } else if (now >= dueAt) {
          s.fireStartMany([[participantId, dueAt]])
        }
      }

      if (s.sequenceStartedAt == null) return
      const due: Array<[string, number]> = []
      for (const p of [...s.participants].sort(byStartOrder)) {
        if (p.status !== 'scheduled') continue
        if (p.needsManualStart) continue
        const sched = scheduledStartEpoch(s, p.startOrder)
        if (sched == null) break
        if (now >= sched) due.push([p.id, sched])
        else break // this and everyone after starts later still
      }
      if (due.length > 0) s.fireStartMany(due)
    }, 100)

    return () => clearInterval(iv)
  }, [])
}
