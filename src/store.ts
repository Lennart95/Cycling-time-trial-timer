import { create } from 'zustand'
import type {
  Course,
  FinishCapture,
  ManualCountdown,
  Participant,
  ParticipantStatus,
  PersistedState,
  RaceConfig,
} from './types'
import { uid } from './lib/id'
import { parseTimeOfDay } from './lib/time'

const STORAGE_KEY = 'cycling-tt-timer/v1'
const PERSIST_VERSION = 1

/** Fixed lead time for a standalone "Countdown next now" on a reset rider. */
export const MANUAL_RESTART_COUNTDOWN_SEC = 20

const DEFAULT_CONFIG: RaceConfig = {
  raceName: 'Time Trial',
  startIntervalSec: 60,
  countdownSec: 10,
  courseDistanceKm: 0,
  expectedAvgSpeedKmh: 0,
  plannedStartTime: '',
}

// ---------------------------------------------------------------------------
// Pure helpers (also used by the views for derived data)
// ---------------------------------------------------------------------------

export function byStartOrder(a: Participant, b: Participant): number {
  return a.startOrder - b.startOrder
}

/**
 * Official start epoch for a rider given the sequence anchor. Slots are keyed by
 * startOrder so a DNS rider simply leaves an empty slot; nobody shifts up.
 */
export function scheduledStartEpoch(
  s: Pick<StoreState, 'sequenceStartedAt' | 'pauseOffsetMs' | 'config'>,
  startOrder: number,
): number | null {
  if (s.sequenceStartedAt == null) return null
  return (
    s.sequenceStartedAt +
    s.pauseOffsetMs +
    s.config.countdownSec * 1000 +
    (startOrder - 1) * s.config.startIntervalSec * 1000
  )
}

/**
 * Planned clock time for a rider given `config.plannedStartTime` (rider 1's
 * start) and the interval — independent of whether the race has been started
 * yet. Used for the Setup start-list preview. Returns null when unset.
 */
export function plannedStartEpochFor(
  config: RaceConfig,
  startOrder: number,
  ref = Date.now(),
): number | null {
  if (!config.plannedStartTime) return null
  const first = parseTimeOfDay(config.plannedStartTime, ref)
  if (first == null) return null
  return first + (startOrder - 1) * config.startIntervalSec * 1000
}

/**
 * The next rider still waiting to start. Prefers a rider who doesn't need a
 * manual restart (see Participant.needsManualStart); if every remaining
 * scheduled rider does, falls back to the earliest so Start next now still
 * has someone to target — the caller should treat that case specially rather
 * than auto-run a countdown for them (see RaceView).
 */
export function nextScheduled(s: StoreState): Participant | null {
  const scheduled = [...s.participants].sort(byStartOrder).filter((p) => p.status === 'scheduled')
  if (scheduled.length === 0) return null
  return scheduled.find((p) => !p.needsManualStart) ?? scheduled[0]
}

/** Riders currently on course, longest-riding first. */
export function onCourse(s: StoreState): Participant[] {
  return s.participants
    .filter((p) => p.status === 'started' && p.startTime != null && p.finishTime == null)
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
}

export interface ResultRow {
  p: Participant
  elapsed: number
  rank: number
  gap: number
}

/** Finished riders ranked by elapsed time, with gap to the leader. */
export function computeResults(s: Pick<StoreState, 'participants'>): ResultRow[] {
  const rows = s.participants
    .filter((p) => p.status === 'finished' && p.startTime != null && p.finishTime != null)
    .map((p) => ({ p, elapsed: (p.finishTime as number) - (p.startTime as number) }))
    .sort((a, b) => a.elapsed - b.elapsed)
  const best = rows.length ? rows[0].elapsed : 0
  return rows.map((r, i) => ({ ...r, rank: i + 1, gap: r.elapsed - best }))
}

/**
 * Assumed average speed (km/h) for projecting on-course riders' position along
 * the course. Prefers the real average of finishers-so-far once there is one
 * (more accurate); falls back to the manually-entered
 * `config.expectedAvgSpeedKmh` so positions can show from the start of the
 * race. Returns null if neither is available, or the course distance isn't
 * known — callers should just not plot positions then, rather than invent a
 * number.
 */
export function estimatedPaceKmh(s: Pick<StoreState, 'participants' | 'config'>): number | null {
  if (!(s.config.courseDistanceKm > 0)) return null
  const results = computeResults(s)
  if (results.length > 0) {
    const avgElapsedMs = results.reduce((sum, r) => sum + r.elapsed, 0) / results.length
    if (avgElapsedMs > 0) return s.config.courseDistanceKm / (avgElapsedMs / 3_600_000)
  }
  if (s.config.expectedAvgSpeedKmh > 0) return s.config.expectedAvgSpeedKmh
  return null
}

/**
 * Re-derive each participant's finishTime/status from the finish captures.
 * Skips DNS/DNF riders and any rider whose finish was entered by hand.
 */
function reconcile(participants: Participant[], finishes: FinishCapture[]): Participant[] {
  return participants.map((p) => {
    if (p.status === 'dns' || p.status === 'dnf' || p.manualFinish) return p
    const mine = finishes.filter((f) => f.assignedTo === p.id)
    if (mine.length > 0) {
      const t = Math.min(...mine.map((f) => f.time))
      return {
        ...p,
        finishTime: t,
        status: p.startTime != null ? 'finished' : p.status,
      }
    }
    if (p.finishTime != null || p.status === 'finished') {
      return {
        ...p,
        finishTime: null,
        status: p.startTime != null ? 'started' : 'scheduled',
      }
    }
    return p
  })
}

function renumber(participants: Participant[]): Participant[] {
  return [...participants]
    .sort(byStartOrder)
    .map((p, i) => (p.startOrder === i + 1 ? p : { ...p, startOrder: i + 1 }))
}

/**
 * Assigns startOrder 1..n across `participants`, keeping every already-started
 * rider exactly where they are and filling the remaining slot numbers, in
 * order, from `orderedRest` (the not-yet-started riders in the order they
 * should now appear).
 */
function reassignNotStarted(participants: Participant[], orderedRest: Participant[]): Participant[] {
  const takenSlots = new Set(
    participants.filter((p) => p.startTime != null).map((p) => p.startOrder),
  )
  const freeSlots: number[] = []
  for (let n = 1; n <= participants.length; n++) if (!takenSlots.has(n)) freeSlots.push(n)
  const slotById = new Map(orderedRest.map((p, i) => [p.id, freeSlots[i]]))
  return participants.map((p) =>
    p.startTime != null ? p : { ...p, startOrder: slotById.get(p.id) ?? p.startOrder },
  )
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function emptyPersisted(): PersistedState {
  return {
    version: PERSIST_VERSION,
    config: { ...DEFAULT_CONFIG },
    participants: [],
    finishes: [],
    sequenceStartedAt: null,
    pauseOffsetMs: 0,
    running: false,
    paused: false,
    pausedAt: null,
    manualCountdown: null,
    course: null,
  }
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyPersisted()
    const parsed = JSON.parse(raw) as PersistedState
    if (parsed.version !== PERSIST_VERSION) return emptyPersisted()
    return { ...emptyPersisted(), ...parsed, config: { ...DEFAULT_CONFIG, ...parsed.config } }
  } catch {
    return emptyPersisted()
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface StoreState extends Omit<PersistedState, 'version'> {
  // config
  setConfig: (patch: Partial<RaceConfig>) => void

  // participants / start list
  addParticipant: (data: { bib: string; name: string; category?: string }) => void
  updateParticipant: (id: string, patch: Partial<Pick<Participant, 'bib' | 'name' | 'category'>>) => void
  removeParticipant: (id: string) => void
  moveParticipant: (id: string, dir: -1 | 1) => void
  shuffleOrder: () => void
  sortOrderByBib: () => void
  importParticipants: (list: Array<{ bib: string; name: string; category?: string }>, mode: 'replace' | 'append') => void

  // race control
  startSequence: () => void
  pauseSequence: () => void
  resumeSequence: () => void
  stopSequence: () => void
  resetTiming: () => void
  newRace: () => void

  // starter engine
  fireStartMany: (pairs: Array<[id: string, atEpoch: number]>) => void
  startNextNow: () => void
  restartNextCountdown: () => void
  startManualCountdown: (participantId: string) => void
  cancelManualCountdown: () => void
  postponeNext: (deltaSec: number) => void
  markNextDns: () => void

  // finishes
  captureFinish: () => void
  finishRiderNow: (participantId: string) => string
  assignFinish: (finishId: string, participantId: string) => void
  unassignFinish: (finishId: string) => void
  deleteFinish: (finishId: string) => void
  nudgeFinish: (finishId: string, deltaMs: number) => void
  setFinishTime: (finishId: string, epoch: number) => void

  // manual overrides
  setParticipantStatus: (id: string, status: ParticipantStatus) => void
  setParticipantStart: (id: string, epoch: number | null) => void
  setParticipantFinish: (id: string, epoch: number | null) => void

  // course (GPX)
  setCourse: (course: Course | null) => void

  // import a whole race file
  loadRace: (data: PersistedState) => void
}

export const useStore = create<StoreState>((set, get) => ({
  ...(() => {
    const p = loadPersisted()
    const { version, ...rest } = p
    void version
    return rest
  })(),

  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),

  addParticipant: ({ bib, name, category }) =>
    set((s) => ({
      participants: renumber([
        ...s.participants,
        {
          id: uid(),
          bib: bib.trim(),
          name: name.trim(),
          category: (category ?? '').trim(),
          startOrder: s.participants.length + 1,
          startTime: null,
          finishTime: null,
          status: 'scheduled',
        },
      ]),
    })),

  updateParticipant: (id, patch) =>
    set((s) => ({
      participants: s.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  removeParticipant: (id) =>
    set((s) => {
      const target = s.participants.find((p) => p.id === id)
      if (target?.startTime != null) return {} // a rider who has started can't be removed
      const finishes = s.finishes.filter((f) => f.assignedTo !== id)
      return {
        finishes,
        participants: renumber(s.participants.filter((p) => p.id !== id)),
      }
    }),

  moveParticipant: (id, dir) =>
    set((s) => {
      const list = [...s.participants].sort(byStartOrder)
      const idx = list.findIndex((p) => p.id === id)
      const swap = idx + dir
      if (idx < 0 || swap < 0 || swap >= list.length) return {}
      const a = list[idx]
      const b = list[swap]
      // Swapping would change a started rider's start order, so refuse if
      // either side of the swap has already started.
      if (a.startTime != null || b.startTime != null) return {}
      return {
        participants: s.participants.map((p) => {
          if (p.id === a.id) return { ...p, startOrder: b.startOrder }
          if (p.id === b.id) return { ...p, startOrder: a.startOrder }
          return p
        }),
      }
    }),

  shuffleOrder: () =>
    set((s) => {
      const rest = s.participants.filter((p) => p.startTime == null)
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[rest[i], rest[j]] = [rest[j], rest[i]]
      }
      return { participants: reassignNotStarted(s.participants, rest) }
    }),

  sortOrderByBib: () =>
    set((s) => {
      const rest = [...s.participants.filter((p) => p.startTime == null)].sort((a, b) => {
        const na = Number(a.bib)
        const nb = Number(b.bib)
        if (!isNaN(na) && !isNaN(nb)) return na - nb
        return a.bib.localeCompare(b.bib)
      })
      return { participants: reassignNotStarted(s.participants, rest) }
    }),

  importParticipants: (rows, mode) =>
    set((s) => {
      const base = mode === 'replace' ? [] : [...s.participants]
      const added: Participant[] = rows.map((r, i) => ({
        id: uid(),
        bib: (r.bib ?? '').trim(),
        name: (r.name ?? '').trim(),
        category: (r.category ?? '').trim(),
        startOrder: base.length + i + 1,
        startTime: null,
        finishTime: null,
        status: 'scheduled',
      }))
      const participants = renumber([...base, ...added])
      if (mode === 'replace') {
        return {
          participants,
          finishes: [],
          sequenceStartedAt: null,
          pauseOffsetMs: 0,
          running: false,
          paused: false,
          pausedAt: null,
          manualCountdown: null,
        }
      }
      return { participants }
    }),

  startSequence: () =>
    set((s) => {
      const now = Date.now()
      // Target rider 1's start on the configured clock time, unless it has
      // already passed today — then fall back to an immediate countdown.
      const rider1At = plannedStartEpochFor(s.config, 1, now)
      const sequenceStartedAt =
        rider1At != null && rider1At > now ? rider1At - s.config.countdownSec * 1000 : now
      return {
        sequenceStartedAt,
        pauseOffsetMs: 0,
        running: true,
        paused: false,
        pausedAt: null,
        manualCountdown: null,
      }
    }),

  pauseSequence: () =>
    set((s) =>
      s.running && !s.paused
        ? { paused: true, pausedAt: Date.now(), manualCountdown: null }
        : {},
    ),

  resumeSequence: () =>
    set((s) => {
      if (!s.paused || s.pausedAt == null) return {}
      return {
        paused: false,
        pausedAt: null,
        pauseOffsetMs: s.pauseOffsetMs + (Date.now() - s.pausedAt),
      }
    }),

  stopSequence: () =>
    set(() => ({ running: false, paused: false, pausedAt: null, manualCountdown: null })),

  resetTiming: () =>
    set((s) => ({
      participants: s.participants.map((p) => ({
        ...p,
        startTime: null,
        finishTime: null,
        status: 'scheduled',
        manualFinish: false,
        needsManualStart: false,
      })),
      finishes: [],
      sequenceStartedAt: null,
      pauseOffsetMs: 0,
      running: false,
      paused: false,
      pausedAt: null,
      manualCountdown: null,
    })),

  newRace: () =>
    set((s) => ({
      // keep config, drop everyone and all timing
      config: s.config,
      participants: [],
      finishes: [],
      sequenceStartedAt: null,
      pauseOffsetMs: 0,
      running: false,
      paused: false,
      pausedAt: null,
      manualCountdown: null,
    })),

  fireStartMany: (pairs) =>
    set((s) => {
      if (pairs.length === 0) return {}
      const map = new Map(pairs)
      const manualCountdown =
        s.manualCountdown && map.has(s.manualCountdown.participantId) ? null : s.manualCountdown
      return {
        manualCountdown,
        participants: s.participants.map((p) =>
          map.has(p.id) && p.status === 'scheduled'
            ? { ...p, startTime: map.get(p.id) as number, status: 'started', needsManualStart: false }
            : p,
        ),
      }
    }),

  startNextNow: () =>
    set((s) => {
      const next = nextScheduled(s)
      if (!next) return {}
      const manualCountdown =
        s.manualCountdown?.participantId === next.id ? null : s.manualCountdown
      return {
        manualCountdown,
        participants: s.participants.map((p) =>
          p.id === next.id
            ? { ...p, startTime: Date.now(), status: 'started', needsManualStart: false }
            : p,
        ),
      }
    }),

  restartNextCountdown: () =>
    set((s) => {
      if (s.sequenceStartedAt == null) return {}
      const next = nextScheduled(s)
      // This re-anchors pauseOffsetMs for the whole schedule off `next`'s
      // position, so it must be the genuine frontier rider — not one flagged
      // needsManualStart, whose stale slot would wrongly drag every later
      // rider's time along with it. Use startManualCountdown for those instead.
      if (!next || next.needsManualStart) return {}
      // Re-anchor the schedule so the next rider's countdown begins right now
      // (full countdownSec ahead), keeping every later rider's spacing after it.
      const pauseOffsetMs =
        Date.now() +
        s.config.countdownSec * 1000 -
        s.sequenceStartedAt -
        (next.startOrder - 1) * s.config.startIntervalSec * 1000
      return { pauseOffsetMs, paused: false, pausedAt: null }
    }),

  // A standalone countdown for one rider (typically flagged needsManualStart),
  // independent of the shared sequence schedule — see ManualCountdown.
  startManualCountdown: (participantId) =>
    set((s) => {
      if (!s.running || s.paused) return {}
      const p = s.participants.find((pp) => pp.id === participantId)
      if (!p || p.status !== 'scheduled') return {}
      return {
        manualCountdown: {
          participantId,
          dueAt: Date.now() + MANUAL_RESTART_COUNTDOWN_SEC * 1000,
        },
      }
    }),

  cancelManualCountdown: () => set(() => ({ manualCountdown: null })),

  postponeNext: (deltaSec) =>
    set((s) => {
      if (s.sequenceStartedAt == null) return {}
      const next = nextScheduled(s)
      if (!next || next.needsManualStart) return {}
      // Pushes the next start (and every later, still-scheduled rider with it)
      // back by deltaSec, keeping the interval spacing between them intact.
      return { pauseOffsetMs: s.pauseOffsetMs + deltaSec * 1000 }
    }),

  markNextDns: () =>
    set((s) => {
      const next = nextScheduled(s)
      if (!next) return {}
      return {
        participants: s.participants.map((p) =>
          p.id === next.id ? { ...p, status: 'dns', startTime: null, finishTime: null } : p,
        ),
      }
    }),

  captureFinish: () =>
    set((s) => ({
      finishes: [...s.finishes, { id: uid(), time: Date.now(), assignedTo: null }],
    })),

  // One-click finish from the On Course list: capture + assign in a single
  // step, for when there's no ambiguity about who just crossed the line. The
  // FINISH button's own capture-then-assign flow is untouched. Returns the new
  // capture's id so the caller can offer an undo.
  finishRiderNow: (participantId) => {
    const id = uid()
    set((s) => {
      const finishes = [...s.finishes, { id, time: Date.now(), assignedTo: participantId }]
      return { finishes, participants: reconcile(s.participants, finishes) }
    })
    return id
  },

  assignFinish: (finishId, participantId) =>
    set((s) => {
      const finishes = s.finishes.map((f) => {
        if (f.id === finishId) return { ...f, assignedTo: participantId }
        // a rider can own only one capture
        if (f.assignedTo === participantId) return { ...f, assignedTo: null }
        return f
      })
      return { finishes, participants: reconcile(s.participants, finishes) }
    }),

  unassignFinish: (finishId) =>
    set((s) => {
      const finishes = s.finishes.map((f) => (f.id === finishId ? { ...f, assignedTo: null } : f))
      return { finishes, participants: reconcile(s.participants, finishes) }
    }),

  deleteFinish: (finishId) =>
    set((s) => {
      const finishes = s.finishes.filter((f) => f.id !== finishId)
      return { finishes, participants: reconcile(s.participants, finishes) }
    }),

  nudgeFinish: (finishId, deltaMs) =>
    set((s) => {
      const finishes = s.finishes.map((f) =>
        f.id === finishId ? { ...f, time: f.time + deltaMs } : f,
      )
      return { finishes, participants: reconcile(s.participants, finishes) }
    }),

  setFinishTime: (finishId, epoch) =>
    set((s) => {
      const finishes = s.finishes.map((f) => (f.id === finishId ? { ...f, time: epoch } : f))
      return { finishes, participants: reconcile(s.participants, finishes) }
    }),

  setParticipantStatus: (id, status) =>
    set((s) => {
      let finishes = s.finishes
      // Detach any finish capture pointing at this rider whenever their start
      // is being cleared too (dns/dnf/scheduled) — otherwise reconcile() puts
      // the stale finishTime straight back the moment anything else changes.
      if (status === 'dns' || status === 'dnf' || status === 'scheduled') {
        finishes = s.finishes.map((f) => (f.assignedTo === id ? { ...f, assignedTo: null } : f))
      }
      const participants = s.participants.map((p) => {
        if (p.id !== id) return p
        if (status === 'dns') return { ...p, status, startTime: null, finishTime: null, manualFinish: false }
        if (status === 'dnf') return { ...p, status, finishTime: null, manualFinish: false }
        if (status === 'scheduled')
          return {
            ...p,
            status,
            startTime: null,
            finishTime: null,
            manualFinish: false,
            // Explicit reset (from any status, including DNS) — don't let the
            // starter engine auto-sweep them up off a schedule slot that may
            // already be due; getting them going is now a deliberate action
            // (Start next now / Countdown next now).
            needsManualStart: true,
          }
        return { ...p, status }
      })
      return { finishes, participants: reconcile(participants, finishes) }
    }),

  setParticipantStart: (id, epoch) =>
    set((s) => {
      let finishes = s.finishes
      if (epoch == null) {
        finishes = s.finishes.map((f) => (f.assignedTo === id ? { ...f, assignedTo: null } : f))
      }
      const participants = s.participants.map((p): Participant => {
        if (p.id !== id) return p
        if (epoch == null)
          return {
            ...p,
            startTime: null,
            finishTime: null,
            status: 'scheduled',
            manualFinish: false,
            needsManualStart: true,
          }
        const status: ParticipantStatus = p.finishTime != null ? 'finished' : 'started'
        return { ...p, startTime: epoch, status, needsManualStart: false }
      })
      return { finishes, participants: reconcile(participants, finishes) }
    }),

  setParticipantFinish: (id, epoch) =>
    set((s) => {
      let finishes = s.finishes
      if (epoch != null) {
        // hand-entered finish wins; detach any capture from this rider
        finishes = s.finishes.map((f) => (f.assignedTo === id ? { ...f, assignedTo: null } : f))
      }
      const participants = s.participants.map((p): Participant => {
        if (p.id !== id) return p
        if (epoch == null)
          return {
            ...p,
            finishTime: null,
            manualFinish: false,
            status: p.startTime != null ? 'started' : 'scheduled',
          }
        return {
          ...p,
          finishTime: epoch,
          manualFinish: true,
          status: p.startTime != null ? 'finished' : p.status,
        }
      })
      return { finishes, participants: reconcile(participants, finishes) }
    }),

  setCourse: (course) =>
    set((s) => ({
      course,
      // The GPX is the authoritative distance once you have one — keeps average
      // speed in Results consistent with what's actually drawn on the map.
      config: course
        ? { ...s.config, courseDistanceKm: Math.round(course.distanceKm * 100) / 100 }
        : s.config,
    })),

  loadRace: (data) =>
    set(() => {
      const base = emptyPersisted()
      const merged = { ...base, ...data, version: PERSIST_VERSION, config: { ...DEFAULT_CONFIG, ...data.config } }
      const { version, ...rest } = merged
      void version
      return { ...rest, participants: renumber(rest.participants) }
    }),
}))

// --- write-through persistence (throttled) ----------------------------------

let persistTimer: ReturnType<typeof setTimeout> | null = null
useStore.subscribe(() => {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, exportRaceJSON())
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, 250)
})

export function exportRaceJSON(): string {
  const s = useStore.getState()
  const snapshot: PersistedState = {
    version: PERSIST_VERSION,
    config: s.config,
    participants: s.participants,
    finishes: s.finishes,
    sequenceStartedAt: s.sequenceStartedAt,
    pauseOffsetMs: s.pauseOffsetMs,
    running: s.running,
    paused: s.paused,
    pausedAt: s.pausedAt,
    manualCountdown: s.manualCountdown,
    course: s.course,
  }
  return JSON.stringify(snapshot, null, 2)
}
