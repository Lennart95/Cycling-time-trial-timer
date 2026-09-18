export type ParticipantStatus =
  | 'scheduled' // in the start list, not yet started
  | 'started' // on course
  | 'finished' // has a finish time
  | 'dns' // did not start
  | 'dnf' // did not finish

export interface Participant {
  id: string
  bib: string
  name: string
  category: string
  /** 1-based position in the start sequence. Kept contiguous (1..n). */
  startOrder: number
  /** Epoch ms of the official start. null until started. */
  startTime: number | null
  /** Epoch ms of the finish. null until a finish is assigned. */
  finishTime: number | null
  status: ParticipantStatus
  /** True when finishTime was set by hand rather than from a finish capture. */
  manualFinish?: boolean
  /**
   * True when this rider was cleared back to 'scheduled' after having a start
   * time (Results → reset, or clearing their start in the time editor). Set
   * directly on the rider being reset — never derived from other riders —
   * so it can't be affected by resetting someone else. Stops the starter
   * engine from auto-firing them off their old, stale slot; cleared the
   * moment they're deliberately started again (Start next now, or a manual
   * start-time edit).
   */
  needsManualStart?: boolean
}

export interface RaceConfig {
  raceName: string
  /** Seconds between consecutive rider starts. */
  startIntervalSec: number
  /** Length of the audible/visible countdown before each start. */
  countdownSec: number
  /** Course distance in kilometres. 0/unset hides average speed in results. */
  courseDistanceKm: number
  /**
   * Manually-entered expected average speed (km/h), used to estimate on-course
   * riders' position on the course map before anyone has finished. 0/unset =
   * no estimate until a real finisher time is available. Once a rider
   * finishes, the actual average speed takes over as the more accurate figure.
   */
  expectedAvgSpeedKmh: number
  /**
   * Scheduled clock time ("HH:MM") for rider 1's start. Empty = unset: Start
   * race begins the countdown immediately instead of targeting a clock time.
   */
  plannedStartTime: string
}

/** A finish-line timestamp captured by the FINISH button, assigned to a rider later. */
export interface FinishCapture {
  id: string
  time: number // epoch ms
  assignedTo: string | null // participant id
}

/**
 * A standalone countdown armed for one specific rider (typically one flagged
 * needsManualStart), independent of the main sequence schedule. Lets a reset
 * rider get a real countdown-then-release without perturbing everyone else's
 * scheduled times the way re-anchoring the shared sequence would.
 */
export interface ManualCountdown {
  participantId: string
  dueAt: number // epoch ms
}

export interface CoursePoint {
  lat: number
  lon: number
  ele?: number
}

/** A parsed GPX route. `cumKm[i]` is the distance from the start to `points[i]`. */
export interface Course {
  name: string
  points: CoursePoint[]
  cumKm: number[]
  distanceKm: number
}

export interface PersistedState {
  version: number
  config: RaceConfig
  participants: Participant[]
  finishes: FinishCapture[]
  sequenceStartedAt: number | null
  pauseOffsetMs: number
  running: boolean
  paused: boolean
  pausedAt: number | null
  manualCountdown: ManualCountdown | null
  course: Course | null
}
