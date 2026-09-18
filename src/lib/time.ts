function pad(n: number, len = 2): string {
  return String(Math.floor(n)).padStart(len, '0')
}

/** mm:ss (or h:mm:ss past an hour). Used for countdowns / "next start in". */
export function fmtClock(ms: number): string {
  const neg = ms < 0
  let s = Math.abs(ms) / 1000
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  return (neg ? '-' : '') + body
}

/** mm:ss.d — elapsed race time, tenths precision (h:mm:ss.d past an hour). */
export function fmtElapsed(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—'
  const neg = ms < 0
  let s = Math.abs(ms) / 1000
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const whole = Math.floor(s)
  const tenth = Math.floor((s - whole) * 10)
  const body =
    h > 0
      ? `${h}:${pad(m)}:${pad(whole)}.${tenth}`
      : `${pad(m)}:${pad(whole)}.${tenth}`
  return (neg ? '-' : '') + body
}

/** HH:MM:SS wall clock for a given epoch. */
export function fmtTimeOfDay(epoch: number | null | undefined): string {
  if (epoch == null) return '—'
  const d = new Date(epoch)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Average speed in km/h over `distanceKm` for an elapsed time in ms. */
export function avgSpeedKmh(distanceKm: number, elapsedMs: number): number | null {
  if (!(distanceKm > 0) || !(elapsedMs > 0)) return null
  return distanceKm / (elapsedMs / 3_600_000)
}

/** "42.3 km/h", or "—" when the distance/elapsed isn't known. */
export function fmtSpeedKmh(distanceKm: number, elapsedMs: number | null | undefined): string {
  if (elapsedMs == null) return '—'
  const speed = avgSpeedKmh(distanceKm, elapsedMs)
  return speed == null ? '—' : `${speed.toFixed(1)} km/h`
}

/** HH:MM:SS.mmm wall clock, for editing / CSV. */
export function fmtTimeOfDayMs(epoch: number | null | undefined): string {
  if (epoch == null) return ''
  const d = new Date(epoch)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/**
 * Parse "HH:MM", "HH:MM:SS" or "HH:MM:SS.mmm" as a time-of-day on the same
 * calendar day as `ref` (defaults to now). Returns null on a malformed string.
 */
export function parseTimeOfDay(text: string, ref = Date.now()): number | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/)
  if (!m) return null
  const [, hh, mm, ss, frac] = m
  const base = new Date(ref)
  base.setHours(Number(hh), Number(mm), ss ? Number(ss) : 0, frac ? Number(frac.padEnd(3, '0')) : 0)
  return base.getTime()
}
