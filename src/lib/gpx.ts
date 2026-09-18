import type { Course, CoursePoint } from '../types'

const MAX_POINTS = 500 // keep storage/render light; way more than a route needs visually

function haversineKm(a: CoursePoint, b: CoursePoint): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}

function decimate(points: CoursePoint[], maxPoints: number): CoursePoint[] {
  if (points.length <= maxPoints) return points
  const stride = (points.length - 1) / (maxPoints - 1)
  const out: CoursePoint[] = []
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.round(i * stride)])
  return out
}

/** Parse a GPX file's text into a Course. Throws with a user-facing message on failure. */
export function parseGpx(xmlText: string): Course {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('That file is not valid GPX/XML.')
  }

  let nodes = doc.querySelectorAll('trkpt')
  if (nodes.length === 0) nodes = doc.querySelectorAll('rtept')

  const raw: CoursePoint[] = []
  nodes.forEach((el) => {
    const lat = parseFloat(el.getAttribute('lat') ?? '')
    const lon = parseFloat(el.getAttribute('lon') ?? '')
    if (!isFinite(lat) || !isFinite(lon)) return
    const eleText = el.querySelector('ele')?.textContent
    const ele = eleText ? parseFloat(eleText) : undefined
    raw.push(ele != null && isFinite(ele) ? { lat, lon, ele } : { lat, lon })
  })

  if (raw.length < 2) {
    throw new Error('No track points found in that GPX file (expected <trkpt> or <rtept>).')
  }

  const points = decimate(raw, MAX_POINTS)
  const cumKm: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    cumKm.push(cumKm[i - 1] + haversineKm(points[i - 1], points[i]))
  }

  const name =
    doc.querySelector('trk > name')?.textContent?.trim() ||
    doc.querySelector('metadata > name')?.textContent?.trim() ||
    ''

  return { name, points, cumKm, distanceKm: cumKm[cumKm.length - 1] }
}

/** The lat/lon at `fraction` (0..1) of the way along the course. */
export function positionAtFraction(course: Course, fraction: number): CoursePoint {
  const { points, cumKm, distanceKm } = course
  if (points.length === 0) return { lat: 0, lon: 0 }
  const target = Math.max(0, Math.min(1, fraction)) * distanceKm
  for (let i = 1; i < points.length; i++) {
    if (cumKm[i] >= target || i === points.length - 1) {
      const segLen = cumKm[i] - cumKm[i - 1]
      const segFrac = segLen > 0 ? (target - cumKm[i - 1]) / segLen : 0
      const a = points[i - 1]
      const b = points[i]
      return {
        lat: a.lat + (b.lat - a.lat) * segFrac,
        lon: a.lon + (b.lon - a.lon) * segFrac,
      }
    }
  }
  return points[points.length - 1]
}

/**
 * Builds a projector from a course's lat/lon points to a `width` × `height` SVG
 * box (simple local equirectangular projection — fine at road-race scale, no
 * need for a real map projection). Use the same projector for the route path
 * and any rider markers so they line up.
 */
export function makeProjector(
  points: CoursePoint[],
  width: number,
  height: number,
  padding = 10,
): (p: CoursePoint) => [number, number] {
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const latMin = Math.min(...lats)
  const latMax = Math.max(...lats)
  const lonMin = Math.min(...lons)
  const lonMax = Math.max(...lons)
  const xScale = Math.cos(((latMin + latMax) / 2) * (Math.PI / 180)) || 1
  const xExtent = Math.max(1e-9, (lonMax - lonMin) * xScale)
  const yExtent = Math.max(1e-9, latMax - latMin)
  const innerW = width - padding * 2
  const innerH = height - padding * 2
  const scale = Math.min(innerW / xExtent, innerH / yExtent)
  const offsetX = padding + (innerW - xExtent * scale) / 2
  const offsetY = padding + (innerH - yExtent * scale) / 2
  return (p: CoursePoint) => [
    (p.lon - lonMin) * xScale * scale + offsetX,
    (latMax - p.lat) * scale + offsetY,
  ]
}
