import { useEffect, useMemo, useState } from 'react'
import {
  MANUAL_RESTART_COUNTDOWN_SEC,
  byStartOrder,
  nextScheduled,
  onCourse,
  plannedStartEpochFor,
  scheduledStartEpoch,
  useStore,
} from '../store'
import { useNow } from '../hooks/useNow'
import { useCountdown } from '../hooks/useCountdown'
import { unlockAudio } from '../lib/sound'
import { fmtClock, fmtElapsed, fmtTimeOfDay, fmtTimeOfDayMs } from '../lib/time'

export function RaceView() {
  useCountdown()
  const now = useNow(80)

  const config = useStore((s) => s.config)
  const participants = useStore((s) => s.participants)
  const finishes = useStore((s) => s.finishes)
  const running = useStore((s) => s.running)
  const paused = useStore((s) => s.paused)
  const sequenceStartedAt = useStore((s) => s.sequenceStartedAt)

  const startSequence = useStore((s) => s.startSequence)
  const pauseSequence = useStore((s) => s.pauseSequence)
  const resumeSequence = useStore((s) => s.resumeSequence)
  const stopSequence = useStore((s) => s.stopSequence)
  const startNextNow = useStore((s) => s.startNextNow)
  const restartNextCountdown = useStore((s) => s.restartNextCountdown)
  const startManualCountdown = useStore((s) => s.startManualCountdown)
  const cancelManualCountdown = useStore((s) => s.cancelManualCountdown)
  const manualCountdown = useStore((s) => s.manualCountdown)
  const postponeNext = useStore((s) => s.postponeNext)
  const markNextDns = useStore((s) => s.markNextDns)

  const captureFinish = useStore((s) => s.captureFinish)
  const finishRiderNow = useStore((s) => s.finishRiderNow)
  const assignFinish = useStore((s) => s.assignFinish)
  const unassignFinish = useStore((s) => s.unassignFinish)
  const deleteFinish = useStore((s) => s.deleteFinish)
  const nudgeFinish = useStore((s) => s.nudgeFinish)

  const state = useStore()
  const next = nextScheduled(state)
  const nextNeedsManualStart = next?.needsManualStart === true
  const manualForNext = next && manualCountdown?.participantId === next.id ? manualCountdown : null
  const nextSched = manualForNext
    ? manualForNext.dueAt
    : next && !nextNeedsManualStart
      ? scheduledStartEpoch(state, next.startOrder)
      : null
  const riders = onCourse(state)

  const scheduledCount = participants.filter((p) => p.status === 'scheduled').length
  // Nobody left who could still cross the line — everyone is finished, DNS, or DNF.
  const allDone =
    participants.length > 0 &&
    participants.every((p) => p.status === 'finished' || p.status === 'dns' || p.status === 'dnf')
  const pending = useMemo(() => finishes.filter((f) => f.assignedTo == null), [finishes])
  const assigned = useMemo(() => finishes.filter((f) => f.assignedTo != null), [finishes])

  const [selectedFinishId, setSelectedFinishId] = useState<string | null>(null)
  const [lastQuickFinish, setLastQuickFinish] = useState<{
    id: string
    bib: string
    name: string
  } | null>(null)

  // auto-dismiss the quick-finish undo banner
  useEffect(() => {
    if (!lastQuickFinish) return
    const t = setTimeout(() => setLastQuickFinish(null), 8000)
    return () => clearTimeout(t)
  }, [lastQuickFinish])
  // keep a sensible selection: newest pending capture
  useEffect(() => {
    if (pending.length === 0) {
      setSelectedFinishId(null)
    } else if (!pending.some((f) => f.id === selectedFinishId)) {
      setSelectedFinishId(pending[pending.length - 1].id)
    }
  }, [pending, selectedFinishId])

  // keyboard shortcuts (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return
      if (e.repeat) return
      const k = e.key.toLowerCase()
      if (k === 'f' || k === ' ') {
        e.preventDefault()
        if (!allDone) captureFinish()
      } else if (k === 'n') {
        e.preventDefault()
        if (running && !paused) startNextNow()
      } else if (k === 'c') {
        e.preventDefault()
        if (running && !paused) {
          if (!next) {
            // no-op
          } else if (next.needsManualStart) {
            if (manualForNext) cancelManualCountdown()
            else startManualCountdown(next.id)
          } else {
            restartNextCountdown()
          }
        }
      } else if (k === 'p') {
        e.preventDefault()
        if (running) (paused ? resumeSequence : pauseSequence)()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    captureFinish,
    allDone,
    startNextNow,
    restartNextCountdown,
    startManualCountdown,
    cancelManualCountdown,
    next,
    manualForNext,
    pauseSequence,
    resumeSequence,
    running,
    paused,
  ])

  const handleStart = () => {
    unlockAudio()
    startSequence()
  }

  const assignSelectedTo = (participantId: string) => {
    if (!selectedFinishId) return
    assignFinish(selectedFinishId, participantId)
  }

  // seconds to the next start; drives the big countdown
  const secsToNext = nextSched != null ? (nextSched - now) / 1000 : null
  const inCountdown = secsToNext != null && secsToNext <= config.countdownSec && secsToNext > -1

  return (
    <div className="view race-view">
      {/* ---- Control column ---------------------------------------------- */}
      <section className="panel control-col">
        <h2>Starter</h2>

        {!running ? (
          <div className="starter-idle">
            <button
              className="btn primary xl"
              onClick={handleStart}
              disabled={scheduledCount === 0}
            >
              Start race
            </button>
            <ul className="facts">
              <li>
                <span>{scheduledCount}</span> riders ready
              </li>
              <li>
                <span>{config.startIntervalSec}s</span> between starts
              </li>
              <li>
                <span>{config.countdownSec}s</span> countdown
              </li>
            </ul>
            {scheduledCount === 0 && (
              <p className="hint warn">Add riders on the Setup tab first.</p>
            )}
            {config.plannedStartTime &&
              (() => {
                const rider1At = plannedStartEpochFor(config, 1, now)
                const passed = rider1At != null && rider1At <= now
                return (
                  <p className={passed ? 'hint warn' : 'hint'}>
                    {passed
                      ? `Scheduled start ${config.plannedStartTime} has passed — Start race will begin immediately.`
                      : `Rider 1 is scheduled for ${config.plannedStartTime}; Start race will time the countdown to hit it.`}
                  </p>
                )
              })()}
          </div>
        ) : allDone ? (
          <div className="starter-live">
            <div className="next-card done">
              <div className="next-done">🏁 Race complete</div>
              <p className="hint">Every rider has finished, DNS, or DNF.</p>
            </div>
            <button className="btn primary xl" onClick={stopSequence}>
              Finish race
            </button>
            {sequenceStartedAt != null && (
              <p className="hint">Sequence armed at {fmtTimeOfDay(sequenceStartedAt)}.</p>
            )}
          </div>
        ) : (
          <div className="starter-live">
            <div className={`next-card ${inCountdown ? 'hot' : ''}`}>
              {next ? (
                <>
                  <div className="next-label">Next to start</div>
                  <div className="next-rider">
                    <span className="bib">{next.bib}</span>
                    <span className="name">{next.name}</span>
                  </div>
                  {nextSched == null ? (
                    <>
                      <div className="next-count straggler">⟲</div>
                      <div className="next-at">
                        reset earlier — won't auto-start; use Start next now or Countdown next now
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="next-count">
                        {secsToNext != null && secsToNext > 0
                          ? inCountdown
                            ? Math.ceil(secsToNext)
                            : fmtClock(secsToNext * 1000)
                          : 'GO'}
                      </div>
                      <div className="next-at">scheduled {fmtTimeOfDay(nextSched)}</div>
                    </>
                  )}
                </>
              ) : (
                <div className="next-done">All riders started</div>
              )}
            </div>

            <div className="control-buttons">
              {paused ? (
                <button className="btn primary" onClick={resumeSequence}>
                  Resume <kbd>P</kbd>
                </button>
              ) : (
                <button className="btn" onClick={pauseSequence}>
                  Pause <kbd>P</kbd>
                </button>
              )}
              <button
                className="btn"
                onClick={startNextNow}
                disabled={!next || paused}
                title="Release the next rider immediately"
              >
                Start next now <kbd>N</kbd>
              </button>
              {nextNeedsManualStart ? (
                manualForNext ? (
                  <button className="btn" onClick={cancelManualCountdown} disabled={paused}>
                    Cancel countdown
                  </button>
                ) : (
                  <button
                    className="btn"
                    onClick={() => next && startManualCountdown(next.id)}
                    disabled={!next || paused}
                    title="Run a standalone countdown for this reset rider, independent of the schedule"
                  >
                    Countdown next now ({MANUAL_RESTART_COUNTDOWN_SEC}s) <kbd>C</kbd>
                  </button>
                )
              ) : (
                <button
                  className="btn"
                  onClick={restartNextCountdown}
                  disabled={!next || paused}
                  title="Re-run the full countdown for the next rider, starting now"
                >
                  Countdown next now <kbd>C</kbd>
                </button>
              )}
              <button
                className="btn"
                onClick={() => postponeNext(10)}
                disabled={!next || nextNeedsManualStart}
                title={
                  nextNeedsManualStart
                    ? 'Not available for a reset rider'
                    : "Push the next rider's start (and everyone after them) back by 10 seconds"
                }
              >
                Postpone start +10s
              </button>
              <button
                className="btn"
                onClick={markNextDns}
                disabled={!next}
                title="Mark the next rider as Did Not Start and skip the slot"
              >
                Next = DNS
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (window.confirm('Stop the starter? Riders already on course keep their times.'))
                    stopSequence()
                }}
              >
                Stop starter
              </button>
            </div>
            {sequenceStartedAt != null && (
              <p className="hint">Sequence armed at {fmtTimeOfDay(sequenceStartedAt)}.</p>
            )}
          </div>
        )}
      </section>

      {/* ---- On course -------------------------------------------------- */}
      <section className="panel oncourse-col">
        <h2>
          On course <span className="count">{riders.length}</span>
        </h2>
        {lastQuickFinish && (
          <div className="quick-undo">
            <span>
              Finished <strong>{lastQuickFinish.bib} {lastQuickFinish.name}</strong> — wrong rider?
            </span>
            <button
              className="btn small"
              onClick={() => {
                unassignFinish(lastQuickFinish.id)
                setSelectedFinishId(lastQuickFinish.id)
                setLastQuickFinish(null)
              }}
            >
              Undo
            </button>
          </div>
        )}
        {riders.length === 0 ? (
          <p className="empty">Nobody on course.</p>
        ) : (
          <ul className="oncourse-list">
            {riders.map((p) => {
              const elapsed = p.startTime != null ? now - p.startTime : 0
              return (
                <li key={p.id} className="oncourse-row">
                  <button
                    className="oncourse-hit"
                    onClick={() => assignSelectedTo(p.id)}
                    disabled={!selectedFinishId}
                    title={
                      selectedFinishId
                        ? 'Assign the selected finish time to this rider'
                        : 'Press FINISH first to capture a time'
                    }
                  >
                    <span className="oc-bib">{p.bib}</span>
                    <span className="oc-name">{p.name}</span>
                    <span className="oc-start">started {fmtTimeOfDay(p.startTime)}</span>
                  </button>
                  <span className="oc-elapsed mono">{fmtElapsed(elapsed)}</span>
                  <button
                    className="btn oncourse-flag"
                    onClick={() => {
                      const id = finishRiderNow(p.id)
                      setLastQuickFinish({ id, bib: p.bib, name: p.name })
                    }}
                    title="Quick finish: capture and assign to this rider right now"
                  >
                    🏁
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="hint">
          Tip: press <kbd>FINISH</kbd>, then click the rider who crossed the line — or tap 🏁 next
          to a rider for a one-click finish when there's no ambiguity.
        </p>
      </section>

      {/* ---- Finish --------------------------------------------------- */}
      <section className="panel finish-col">
        <h2>Finish</h2>
        <button
          className="btn finish-btn"
          onClick={() => captureFinish()}
          disabled={allDone}
          title={allDone ? 'Everyone has finished, DNS, or DNF — nothing left to capture' : undefined}
        >
          FINISH
          <small>captures a time · shortcut F or Space</small>
        </button>

        <h3>
          Unassigned <span className="count">{pending.length}</span>
        </h3>
        {pending.length === 0 ? (
          <p className="empty small">No captured times waiting.</p>
        ) : (
          <ul className="capture-list">
            {pending
              .slice()
              .reverse()
              .map((f, i, arr) => {
                const prev = arr[i + 1]
                const delta = prev ? f.time - prev.time : null
                return (
                  <li
                    key={f.id}
                    className={f.id === selectedFinishId ? 'capture selected' : 'capture'}
                    onClick={() => setSelectedFinishId(f.id)}
                  >
                    <div className="cap-top">
                      <span className="cap-time mono">{fmtTimeOfDayMs(f.time)}</span>
                      {delta != null && (
                        <span className="cap-delta">Δ {(delta / 1000).toFixed(1)}s</span>
                      )}
                      <button
                        className="btn icon danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteFinish(f.id)
                        }}
                        title="Discard this capture"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="cap-actions">
                      <select
                        value=""
                        onChange={(e) => e.target.value && assignFinish(f.id, e.target.value)}
                      >
                        <option value="">Assign to…</option>
                        {[...riders].sort(byStartOrder).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.bib} {p.name} — {fmtElapsed(f.time - (p.startTime ?? f.time))}
                          </option>
                        ))}
                      </select>
                      {riders[0] && (
                        <button
                          className="btn small"
                          onClick={() => assignFinish(f.id, riders[0].id)}
                          title={`Assign to ${riders[0].name} (longest on course)`}
                        >
                          → {riders[0].bib}
                        </button>
                      )}
                    </div>
                    <div className="cap-nudge">
                      <span>nudge</span>
                      <button className="btn icon" onClick={() => nudgeFinish(f.id, -1000)}>
                        −1s
                      </button>
                      <button className="btn icon" onClick={() => nudgeFinish(f.id, -100)}>
                        −0.1
                      </button>
                      <button className="btn icon" onClick={() => nudgeFinish(f.id, 100)}>
                        +0.1
                      </button>
                      <button className="btn icon" onClick={() => nudgeFinish(f.id, 1000)}>
                        +1s
                      </button>
                    </div>
                  </li>
                )
              })}
          </ul>
        )}

        {assigned.length > 0 && (
          <>
            <h3>
              Assigned <span className="count">{assigned.length}</span>
            </h3>
            <ul className="capture-list assigned">
              {assigned
                .slice()
                .reverse()
                .map((f) => {
                  const p = participants.find((x) => x.id === f.assignedTo)
                  const elapsed = p && p.startTime != null ? f.time - p.startTime : null
                  return (
                    <li key={f.id} className="capture done">
                      <span className="cap-rider">
                        {p ? `${p.bib} ${p.name}` : 'unknown'}
                      </span>
                      <span className="cap-elapsed mono">{fmtElapsed(elapsed)}</span>
                      <button className="btn small" onClick={() => unassignFinish(f.id)}>
                        undo
                      </button>
                    </li>
                  )
                })}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
