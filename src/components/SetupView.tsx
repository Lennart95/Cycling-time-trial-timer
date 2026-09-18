import { useRef, useState, type FormEvent } from 'react'
import { plannedStartEpochFor, useStore } from '../store'
import { detectDelimiter, openTextFile, parseCSV } from '../lib/csv'
import { parseGpx } from '../lib/gpx'
import { fmtClock, fmtTimeOfDay } from '../lib/time'

const DELIMITER_NAMES: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' }

export function SetupView() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const participants = useStore((s) => s.participants)
  const running = useStore((s) => s.running)
  const course = useStore((s) => s.course)
  const setCourse = useStore((s) => s.setCourse)

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
  const [courseMsg, setCourseMsg] = useState<string | null>(null)
  const bibRef = useRef<HTMLInputElement>(null)

  interface ImportRow {
    bib: string
    name: string
    category: string
  }
  const [pendingImport, setPendingImport] = useState<{ rows: ImportRow[]; delimiter: string } | null>(
    null,
  )

  const ordered = [...participants].sort((a, b) => a.startOrder - b.startOrder)
  const notStartedCount = ordered.filter((p) => p.startTime == null).length

  const existingBibs = new Set(
    participants.map((p) => p.bib.trim().toLowerCase()).filter((b) => b !== ''),
  )
  const pendingDupes = pendingImport
    ? pendingImport.rows.filter(
        (r) => r.bib.trim() !== '' && existingBibs.has(r.bib.trim().toLowerCase()),
      )
    : []

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
    if (participants.length === 0) {
      // Nothing to preserve or collide with — just load them.
      importParticipants(list, 'replace')
      setImportMsg(
        `Imported ${list.length} riders, read as ${DELIMITER_NAMES[delimiter] ?? delimiter}-separated.`,
      )
      return
    }
    setPendingImport({ rows: list, delimiter })
  }

  const delimiterLabel = (d: string) => DELIMITER_NAMES[d] ?? d

  const confirmReplace = () => {
    if (!pendingImport) return
    importParticipants(pendingImport.rows, 'replace')
    setImportMsg(
      `Imported ${pendingImport.rows.length} riders (replaced the previous list), read as ${delimiterLabel(pendingImport.delimiter)}-separated.`,
    )
    setPendingImport(null)
  }

  const confirmAppendSkipDupes = () => {
    if (!pendingImport) return
    const dupeBibs = new Set(pendingDupes.map((r) => r.bib.trim().toLowerCase()))
    const toAdd = pendingImport.rows.filter((r) => !dupeBibs.has(r.bib.trim().toLowerCase()))
    importParticipants(toAdd, 'append')
    setImportMsg(
      `Appended ${toAdd.length} riders${
        pendingDupes.length > 0 ? ` (skipped ${pendingDupes.length} duplicate bib${pendingDupes.length === 1 ? '' : 's'})` : ''
      }, read as ${delimiterLabel(pendingImport.delimiter)}-separated.`,
    )
    setPendingImport(null)
  }

  const confirmAppendAll = () => {
    if (!pendingImport) return
    importParticipants(pendingImport.rows, 'append')
    setImportMsg(
      `Appended all ${pendingImport.rows.length} riders${
        pendingDupes.length > 0 ? ` (including ${pendingDupes.length} duplicate bib${pendingDupes.length === 1 ? '' : 's'})` : ''
      }, read as ${delimiterLabel(pendingImport.delimiter)}-separated.`,
    )
    setPendingImport(null)
  }

  const cancelImport = () => {
    setPendingImport(null)
    setImportMsg('Import canceled — nothing changed.')
  }

  const doImportGpx = async () => {
    setCourseMsg(null)
    const text = await openTextFile(['gpx'])
    if (text == null) return
    try {
      const parsed = parseGpx(text)
      setCourse(parsed)
      setCourseMsg(
        `Loaded ${parsed.name || 'course'} — ${parsed.distanceKm.toFixed(2)} km, ${parsed.points.length} points. Course distance updated to match.`,
      )
    } catch (err) {
      setCourseMsg(err instanceof Error ? err.message : 'Could not read that GPX file.')
    }
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
          <button className="btn" onClick={doImport} disabled={pendingImport != null}>
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
        {pendingImport && (
          <div className="import-review">
            <p className="hint">
              Read <strong>{pendingImport.rows.length}</strong> rider
              {pendingImport.rows.length === 1 ? '' : 's'} from the file
              {pendingDupes.length > 0 ? (
                <>
                  {' '}
                  — <strong>{pendingDupes.length}</strong> match{pendingDupes.length === 1 ? 'es' : ''}{' '}
                  a bib already in your {participants.length}-rider list.
                </>
              ) : (
                <> — no bib collisions with your current {participants.length}-rider list.</>
              )}
            </p>
            <div className="row-actions">
              <button
                className="btn danger"
                onClick={() => {
                  if (
                    window.confirm(
                      `Replace the current ${participants.length} riders with these ${pendingImport.rows.length}? This can't be undone.`,
                    )
                  )
                    confirmReplace()
                }}
              >
                Replace all riders
              </button>
              <button
                className="btn primary"
                onClick={confirmAppendSkipDupes}
                title={
                  pendingDupes.length > 0
                    ? `Adds the new riders, skipping ${pendingDupes.length} whose bib already exists`
                    : 'Adds the new riders to the current list'
                }
              >
                Append{pendingDupes.length > 0 ? ' (skip duplicates)' : ''}
              </button>
              {pendingDupes.length > 0 && (
                <button
                  className="btn"
                  onClick={confirmAppendAll}
                  title="Adds every row from the file, even the ones that repeat an existing bib"
                >
                  Append including duplicates
                </button>
              )}
              <button className="btn" onClick={cancelImport}>
                Cancel
              </button>
            </div>
          </div>
        )}
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

      <section className="panel">
        <h2>Course</h2>
        {course ? (
          <>
            <p className="hint">
              <strong>{course.name || 'Course'}</strong> — {course.distanceKm.toFixed(2)} km,{' '}
              {course.points.length} points.
            </p>
            <div className="row-actions">
              <button className="btn" onClick={doImportGpx}>
                Replace GPX…
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (window.confirm('Remove the course? The map on the Race tab will disappear.'))
                    setCourse(null)
                }}
              >
                Remove course
              </button>
            </div>
            <label className="course-pace-field">
              Expected average speed (km/h)
              <input
                type="number"
                min={0}
                step={0.5}
                value={config.expectedAvgSpeedKmh || ''}
                placeholder="optional"
                onChange={(e) =>
                  setConfig({ expectedAvgSpeedKmh: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
            <p className="hint">
              Used to show estimated rider positions on the course map before anyone has finished.
              Once a rider finishes, their real pace takes over automatically.
            </p>
          </>
        ) : (
          <>
            <p className="hint">
              Import a GPX route to show the course shape on the Race tab, with estimated rider
              positions along it once someone has finished.
            </p>
            <button className="btn" onClick={doImportGpx}>
              Import GPX…
            </button>
          </>
        )}
        {courseMsg && <p className="hint">{courseMsg}</p>}
      </section>
    </div>
  )
}
