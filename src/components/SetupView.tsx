import { useRef, useState, type FormEvent } from 'react'
import { plannedStartEpochFor, useStore } from '../store'
import { detectDelimiter, openTextFile, parseCSV } from '../lib/csv'
import { fmtClock, fmtTimeOfDay } from '../lib/time'

const DELIMITER_NAMES: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' }

export function SetupView() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const participants = useStore((s) => s.participants)
  const running = useStore((s) => s.running)

  const addParticipant = useStore((s) => s.addParticipant)
  const updateParticipant = useStore((s) => s.updateParticipant)
  const removeParticipant = useStore((s) => s.removeParticipant)
  const moveParticipant = useStore((s) => s.moveParticipant)
  const shuffleOrder = useStore((s) => s.shuffleOrder)
  const sortOrderByBib = useStore((s) => s.sortOrderByBib)
  const importParticipants = useStore((s) => s.importParticipants)

  const [bib, setBib] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const bibRef = useRef<HTMLInputElement>(null)

  const ordered = [...participants].sort((a, b) => a.startOrder - b.startOrder)
  const notStartedCount = ordered.filter((p) => p.startTime == null).length

  const submitAdd = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() && !bib.trim()) return
    addParticipant({ bib, name, category })
    setBib('')
    setName('')
    // keep category — often the same for a block of riders
    bibRef.current?.focus()
  }

  const doImport = async () => {
    setImportMsg(null)
    const text = await openTextFile(['csv'])
    if (text == null) return
    const delimiter = detectDelimiter(text)
    const rows = parseCSV(text, delimiter)
    if (rows.length === 0) {
      setImportMsg('No rows found in file.')
      return
    }
    // detect a header row
    const header = rows[0].map((c) => c.trim().toLowerCase())
    const hasHeader = header.some((h) =>
      ['bib', 'name', 'rider', 'category', 'cat', 'club', 'team'].includes(h),
    )
    const col = {
      bib: header.indexOf('bib'),
      name: header.findIndex((h) => h === 'name' || h === 'rider'),
      category: header.findIndex((h) => h === 'category' || h === 'cat'),
      club: header.findIndex((h) => h === 'club' || h === 'team'),
    }
    const body = hasHeader ? rows.slice(1) : rows
    const list = body
      .map((r) => ({
        bib: (hasHeader && col.bib >= 0 ? r[col.bib] : r[0]) ?? '',
        name: (hasHeader && col.name >= 0 ? r[col.name] : r[1]) ?? '',
        category:
          (hasHeader && col.category >= 0 ? r[col.category] : r[2]) ||
          (hasHeader && col.club >= 0 ? r[col.club] : '') ||
          '',
      }))
      .filter((r) => (r.bib + r.name).trim() !== '')
    if (list.length === 0) {
      setImportMsg(
        `Could not read any riders (using "${DELIMITER_NAMES[delimiter] ?? delimiter}"-separated parsing). Expected columns: bib, name, category.`,
      )
      return
    }
    const mode = participants.length > 0 && window.confirm(
      `Import ${list.length} riders.\n\nOK = replace the current ${participants.length} riders.\nCancel = append them to the list.`,
    )
      ? 'replace'
      : participants.length === 0
        ? 'replace'
        : 'append'
    importParticipants(list, mode)
    setImportMsg(
      `Imported ${list.length} riders (${mode}), read as ${DELIMITER_NAMES[delimiter] ?? delimiter}-separated.`,
    )
  }

  return (
    <div className="view setup-view">
      <section className="panel">
        <h2>Race settings</h2>
        <div className="form-grid">
          <label>
            Race name
            <input
              value={config.raceName}
              onChange={(e) => setConfig({ raceName: e.target.value })}
              placeholder="e.g. Club TT — Round 3"
            />
          </label>
          <label>
            Initial start time
            <input
              type="time"
              value={config.plannedStartTime}
              onChange={(e) => setConfig({ plannedStartTime: e.target.value })}
            />
          </label>
          <label>
            Start interval (seconds)
            <input
              type="number"
              min={5}
              max={600}
              value={config.startIntervalSec}
              onChange={(e) =>
                setConfig({ startIntervalSec: Math.max(1, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label>
            Countdown (seconds)
            <input
              type="number"
              min={3}
              max={60}
              value={config.countdownSec}
              onChange={(e) =>
                setConfig({ countdownSec: Math.max(1, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label>
            Course distance (km)
            <input
              type="number"
              min={0}
              step={0.1}
              value={config.courseDistanceKm || ''}
              placeholder="optional"
              onChange={(e) =>
                setConfig({ courseDistanceKm: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
        </div>
        {config.courseDistanceKm > 0 && (
          <p className="hint">
            Average speed will be shown in Results for {config.courseDistanceKm} km.
          </p>
        )}
        {config.plannedStartTime ? (
          <p className="hint">
            Rider 1 is scheduled for {config.plannedStartTime}; later riders follow at the start
            interval. Pressing Start race times the countdown to hit that clock time (or starts
            immediately if it has already passed).
          </p>
        ) : (
          <p className="hint">
            No initial start time set — Start race begins the countdown immediately when pressed.
          </p>
        )}
        {running && (
          <p className="hint warn">
            The race is running. Changing the interval or countdown re-times riders who have not
            started yet.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Add rider</h2>
        <form className="add-form" onSubmit={submitAdd}>
          <input
            ref={bibRef}
            className="w-bib"
            value={bib}
            onChange={(e) => setBib(e.target.value)}
            placeholder="Bib"
          />
          <input
            className="w-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <input
            className="w-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category (optional)"
          />
          <button type="submit" className="btn primary">
            Add
          </button>
        </form>
        <div className="row-actions">
          <button className="btn" onClick={doImport}>
            Import CSV…
          </button>
          <button
            className="btn"
            onClick={shuffleOrder}
            disabled={notStartedCount < 2}
            title="Randomise the start order of riders who haven't started yet"
          >
            Shuffle order
          </button>
          <button
            className="btn"
            onClick={sortOrderByBib}
            disabled={notStartedCount < 2}
            title="Order the not-yet-started riders by bib number"
          >
            Sort by bib
          </button>
        </div>
        {importMsg && <p className="hint">{importMsg}</p>}
        <p className="hint">
          CSV columns: <code>bib, name, category</code> (a <code>club</code>/<code>team</code>{' '}
          column is used as a fallback for category). Header row and the field separator (
          <code>,</code>, <code>;</code>, or tab) are both detected automatically.
        </p>
        {notStartedCount < ordered.length && (
          <p className="hint">
            Riders who have already started keep their start order and can't be removed —
            reordering and shuffling only ever touch riders still waiting to start.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>
          Start list <span className="count">{ordered.length}</span>
        </h2>
        {ordered.length === 0 ? (
          <p className="empty">No riders yet. Add them above or import a CSV.</p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th className="c-ord">#</th>
                <th className="c-bib">Bib</th>
                <th>Name</th>
                <th className="c-cat">Category</th>
                <th className="c-time">Start time</th>
                <th className="c-status">Status</th>
                <th className="c-move">Order</th>
                <th className="c-del"></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((p, i) => {
                const plannedAt = plannedStartEpochFor(config, p.startOrder)
                return (
                <tr key={p.id} className={`st-${p.status}`}>
                  <td className="c-ord">{p.startOrder}</td>
                  <td className="c-bib">
                    <input
                      value={p.bib}
                      onChange={(e) => updateParticipant(p.id, { bib: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={p.name}
                      onChange={(e) => updateParticipant(p.id, { name: e.target.value })}
                    />
                  </td>
                  <td className="c-cat">
                    <input
                      value={p.category}
                      onChange={(e) => updateParticipant(p.id, { category: e.target.value })}
                    />
                  </td>
                  <td className="c-time mono">
                    {plannedAt != null
                      ? fmtTimeOfDay(plannedAt)
                      : '+' + fmtClock((p.startOrder - 1) * config.startIntervalSec * 1000)}
                  </td>
                  <td className="c-status">
                    <span className={`tag tag-${p.status}`}>{p.status}</span>
                  </td>
                  <td className="c-move">
                    <button
                      className="btn icon"
                      disabled={i === 0 || p.startTime != null || ordered[i - 1].startTime != null}
                      onClick={() => moveParticipant(p.id, -1)}
                      title={p.startTime != null ? 'Already started — order is locked' : 'Move up'}
                    >
                      ▲
                    </button>
                    <button
                      className="btn icon"
                      disabled={
                        i === ordered.length - 1 ||
                        p.startTime != null ||
                        ordered[i + 1].startTime != null
                      }
                      onClick={() => moveParticipant(p.id, 1)}
                      title={p.startTime != null ? 'Already started — order is locked' : 'Move down'}
                    >
                      ▼
                    </button>
                  </td>
                  <td className="c-del">
                    <button
                      className="btn icon danger"
                      disabled={p.startTime != null}
                      onClick={() => {
                        if (window.confirm(`Remove ${p.name || p.bib}?`)) removeParticipant(p.id)
                      }}
                      title={p.startTime != null ? "Can't remove a rider who has started" : 'Remove rider'}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
