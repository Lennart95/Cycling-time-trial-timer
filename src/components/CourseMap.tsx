import { useMemo } from 'react'
import type { Course } from '../types'
import { makeProjector, positionAtFraction } from '../lib/gpx'
import { riderColor } from '../lib/riderColors'

const WIDTH = 320
const HEIGHT = 140

export interface CourseRiderMarker {
  id: string
  bib: string
  name: string
  /** Stable start-order-based color assignment — doesn't shift as riders finish. */
  startOrder: number
  fraction: number
}

/** A simple offline sketch of a GPX route, with optional estimated rider markers. */
export function CourseMap({
  course,
  riders,
}: {
  course: Course
  riders: CourseRiderMarker[]
}) {
  const project = useMemo(
    () => makeProjector(course.points, WIDTH, HEIGHT),
    [course],
  )

  const pathD = useMemo(
    () =>
      course.points
        .map((p, i) => {
          const [x, y] = project(p)
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        })
        .join(' '),
    [course, project],
  )

  const start = course.points[0] ? project(course.points[0]) : null
  const finish = course.points[course.points.length - 1]
    ? project(course.points[course.points.length - 1])
    : null

  return (
    <svg
      className="course-map"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={course.name ? `Course map: ${course.name}` : 'Course map'}
    >
      <path d={pathD} className="course-path" fill="none" />
      {start && <circle cx={start[0]} cy={start[1]} r={4} className="course-start" />}
      {finish && <circle cx={finish[0]} cy={finish[1]} r={4} className="course-finish" />}
      {riders.map((r) => {
        const [x, y] = project(positionAtFraction(course, r.fraction))
        const color = riderColor(r.startOrder)
        // Label on whichever side has room to grow outward — right half of
        // the map gets a right-hand label, left half gets a left-hand one —
        // so it doesn't run off the edge and stays clear of the dot itself.
        const onRightHalf = x >= WIDTH / 2
        return (
          <g key={r.id} className="course-rider">
            <circle cx={x} cy={y} r={4} style={{ fill: color }} />
            <text
              x={onRightHalf ? x + 6 : x - 6}
              y={y}
              style={{
                fill: color,
                textAnchor: onRightHalf ? 'start' : 'end',
                dominantBaseline: 'central',
              }}
            >
              {r.bib} {r.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
