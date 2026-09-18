import { useState } from 'react'
import { byStartOrder, computeResults, exportRaceJSON, useStore } from '../store'
import type { PersistedState } from '../types'
import { openTextFile, saveTextFile, toCSV } from '../lib/csv'
import {
  avgSpeedKmh,
  fmtElapsed,
  fmtSpeedKmh,
  fmtTimeOfDay,
  fmtTimeOfDayMs,
  parseTimeOfDay,
} from '../lib/time'

export function ResultsView() {
  const config = useStore((s) => s.config)
  const participants = useStore((s) => s.participants)
  const resetTiming = useStore((s) => s.resetTiming)
  const newRace = useStore((s) => s.newRace)
  const loadRace = useStore((s) => s.loadRace)
  const setParticipantStatus = useStore((s) => s.setParticipantStatus)
  const setParticipantStart = useStore((s) => s.setParticipantStart)
  const setParticipantFinish = useStore((s) => s.setParticipantFinish)

  const [showEdit, setShowEdit] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const results = computeResults({ participants })
  const others = [...participants]
    .filter((p) => !results.some((r) => r.p.id === p.id))
    .sort(byStartOrder)
  const showSpeed = config.courseDistanceKm > 0

  const slug = (config.raceName || 'time-trial').replace(/[^\w-]+/g, '_').toLowerCase()

  const exportResults = () => {
    const header = ['rank', 'bib', 'name', 'category', 'start_time', 'finish_time', 'elapsed', 'elapsed_ms', 'gap', 'status']
    if (showSpeed) header.push('avg_speed_kmh')
    const rows: Array<Array<string | number>> = [header]
    for (const r of results) {
      const row: Array<string | number> = [
        r.rank,
        r.p.bib,
        r.p.name,
        r.p.category,
        fmtTimeOfDayMs(r.p.startTime),
        fmtTimeOfDayMs(r.p.finishTime),
        fmtElapsed(r.elapsed),
        Math.round(r.elapsed),
        r.rank === 1 ? '' : '+' + fmtElapsed(r.gap),
        'finished',
      ]
      if (showSpeed) {
        const speed = avgSpeedKmh(config.courseDistanceKm, r.elapsed)
        row.push(speed == null ? '' : speed.toFixed(2))
      }
      rows.push(row)
    }
    for (const p of others) {
      const row: Array<string | number> = [
        '',
        p.bib,
        p.name,
        p.category,
        fmtTimeOfDayMs(p.startTime),
        fmtTimeOfDayMs(p.finishTime),
        '',
        '',
        '',
        p.status,
      ]
      if (showSpeed) row.push('')
      rows.push(row)
    }
    void saveTextFile(`${slug}_results.csv`, toCSV(rows))
  }

  const exportStartList = () => {
    const rows: Array<Array<string | number>> = [['start_order', 'bib', 'name', 'category', 'status']]
    for (const p of [...participants].sort(byStartOrder)) {
      rows.push([p.startOrder, p.bib, p.name, p.category, p.status])
    }
    void saveTextFile(`${slug}_startlist.csv`, toCSV(rows))
  }

  const exportJSON = () => {
    void saveTextFile(`${slug}_race.json`, exportRaceJSON())
  }

  const importJSON = async () => {
    setMsg(null)
    const text = await openTextFile(['json'])
    if (text == null) return
    try {
      const data = JSON.parse(text) as PersistedState
      if (!Array.isArray(data.participants)) throw new Error('missing participants')
      loadRace(data)
      setMsg('Race loaded.')
    } catch (err) {
      setMsg('Could not read that file as a race JSON.')
    }
  }

  return (
    <div className="view results-view">
      <section className="panel">
        <div className="results-head">
          <h2>Results</h2>
          <div className="row-actions">
            <button className="btn" onClick={exportResults} disabled={participants.length === 0}>
              Export results CSV
            </button>
            <button className="btn" onClick={exportStartList} disabled={participants.length === 0}>
              Export start list CSV
            </button>
            <button className="btn" onClick={exportJSON} disabled={participants.length === 0}>
              Export race JSON
            </button>
            <button className="btn" onClick={importJSON}>
              Import race JSON…
            </button>
          </div>
        </div>
        {msg && <p className="hint">{msg}</p>}

        {results.length === 0 ? (
          <p className="empty">No finishers yet.</p>
        ) : (
          <table className="grid results-grid">
            <thead>
              <tr>
                <th className="c-ord">Rank</th>
                <th className="c-bib">Bib</th>
                <th>Name</th>
                <th className="c-cat">Category</th>
                <th className="c-time">Start</th>
                <th className="c-time">Finish</th>
                <th className="c-time">Elapsed</th>
                <th className="c-time">Gap</th>
                {showSpeed && <th className="c-time">Avg speed</th>}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.p.id} className={r.rank === 1 ? 'leader' : undefined}>
                  <td className="c-ord">{r.rank}</td>
                  <td className="c-bib">{r.p.bib}</td>
                  <td>{r.p.name}</td>
                  <td className="c-cat">{r.p.category}</td>
                  <td className="c-time mono">{fmtTimeOfDay(r.p.startTime)}</td>
                  <td className="c-time mono">{fmtTimeOfDay(r.p.finishTime)}</td>
                  <td className="c-time mono strong">{fmtElapsed(r.elapsed)}</td>
                  <td className="c-time mono">{r.rank === 1 ? '—' : '+' + fmtElapsed(r.gap)}</td>
                  {showSpeed && (
                    <td className="c-time mono">{fmtSpeedKmh(config.courseDistanceKm, r.elapsed)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {others.length > 0 && (
          <>
            <h3>Not classified</h3>
            <table className="grid">
              <thead>
                <tr>
                  <th className="c-ord">#</th>
                  <th className="c-bib">Bib</th>
                  <th>Name</th>
                  <th className="c-status">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {others.map((p) => (
                  <tr key={p.id} className={`st-${p.status}`}>
                    <td className="c-ord">{p.startOrder}</td>
                    <td className="c-bib">{p.bib}</td>
                    <td>{p.name}</td>
                    <td className="c-status">
                      <span className={`tag tag-${p.status}`}>{p.status}</span>
                    </td>
                    <td className="c-actions">
                      {p.startTime != null && (
                        <button
                          className="btn small"
                          onClick={() => setParticipantStatus(p.id, 'dnf')}
                        >
                          DNF
                        </button>
                      )}
                      {p.status === 'scheduled' && (
                        <button
                          className="btn small"
                          onClick={() => setParticipantStatus(p.id, 'dns')}
                        >
                          DNS
                        </button>
                      )}
                      <button
                        className="btn small"
                        onClick={() => setParticipantStatus(p.id, 'scheduled')}
                      >
                        reset
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="panel">
        <button className="btn link" onClick={() => setShowEdit((v) => !v)}>
          {showEdit ? '▾' : '▸'} Adjust times &amp; race data
        </button>
        {showEdit && (
          <div className="edit-times">
            <p className="hint">
              Enter wall-clock times as <code>HH:MM:SS</code> or <code>HH:MM:SS.mmm</code>. Leave a
              field and press Enter to apply. Clear a field to remove that time.
            </p>
            <table className="grid">
              <thead>
                <tr>
                  <th className="c-bib">Bib</th>
                  <th>Name</th>
                  <th className="c-time">Start</th>
                  <th className="c-time">Finish</th>
                  <th className="c-status">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...participants].sort(byStartOrder).map((p) => (
                  <TimeEditRow
                    key={p.id}
                    bib={p.bib}
                    name={p.name}
                    status={p.status}
                    start={p.startTime}
                    finish={p.finishTime}
                    onStart={(v) => setParticipantStart(p.id, v)}
                    onFinish={(v) => setParticipantFinish(p.id, v)}
                  />
                ))}
              </tbody>
            </table>

            <div className="danger-zone">
              <button
                className="btn danger"
                onClick={() => {
                  if (window.confirm('Clear all start/finish times and finish captures? Riders stay in the list.'))
                    resetTiming()
                }}
              >
                Reset all timing
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (window.confirm('Start a new race? This removes every rider and all times.'))
                    newRace()
                }}
              >
                New race (clear everyone)
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function TimeEditRow(props: {
  bib: string
  name: string
  status: string
  start: number | null
  finish: number | null
  onStart: (epoch: number | null) => void
  onFinish: (epoch: number | null) => void
}) {
  const [start, setStart] = useState(props.start != null ? fmtTimeOfDayMs(props.start) : '')
  const [finish, setFinish] = useState(props.finish != null ? fmtTimeOfDayMs(props.finish) : '')

  const commit = (raw: string, apply: (epoch: number | null) => void) => {
    const t = raw.trim()
    if (t === '') return apply(null)
    const epoch = parseTimeOfDay(t)
    if (epoch != null) apply(epoch)
  }

  return (
    <tr>
      <td className="c-bib">{props.bib}</td>
      <td>{props.name}</td>
      <td className="c-time">
        <input
          className="mono"
          value={start}
          placeholder="—"
          onChange={(e) => setStart(e.target.value)}
          onBlur={() => commit(start, props.onStart)}
          onKeyDown={(e) => e.key === 'Enter' && commit(start, props.onStart)}
        />
      </td>
      <td className="c-time">
        <input
          className="mono"
          value={finish}
          placeholder="—"
          onChange={(e) => setFinish(e.target.value)}
          onBlur={() => commit(finish, props.onFinish)}
          onKeyDown={(e) => e.key === 'Enter' && commit(finish, props.onFinish)}
        />
      </td>
      <td className="c-status">
        <span className={`tag tag-${props.status}`}>{props.status}</span>
      </td>
    </tr>
  )
}
