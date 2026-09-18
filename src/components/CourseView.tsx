import { useMemo } from 'react'
import { estimatedPaceKmh, onCourse, useStore } from '../store'
import { useNow } from '../hooks/useNow'
import { useWeather } from '../hooks/useWeather'
import { CourseMap, type CourseRiderMarker } from './CourseMap'
import { WeatherReadout } from './WeatherReadout'

export function CourseView() {
  const now = useNow(200)
  const course = useStore((s) => s.course)
  const config = useStore((s) => s.config)

  const state = useStore()
  const riders = onCourse(state)
  const paceKmh = estimatedPaceKmh(state)

  const courseLat = course?.points[0]?.lat ?? null
  const courseLon = course?.points[0]?.lon ?? null
  const weather = useWeather(courseLat, courseLon)

  const courseRiders: CourseRiderMarker[] = useMemo(() => {
    if (paceKmh == null || !(config.courseDistanceKm > 0)) return []
    return riders
      .filter((p) => p.startTime != null)
      .map((p) => ({
        id: p.id,
        bib: p.bib,
        name: p.name,
        startOrder: p.startOrder,
        fraction:
          (((now - (p.startTime as number)) / 3_600_000) * paceKmh) / config.courseDistanceKm,
      }))
  }, [riders, paceKmh, config.courseDistanceKm, now])

  return (
    <div className="view course-view">
      <section className="panel">
        <h2>{course?.name ? course.name : 'Course'}</h2>
        {course ? (
          <>
            <div className="course-map-wrap">
              <CourseMap course={course} riders={courseRiders} />
              <WeatherReadout
                data={weather.data}
                loading={weather.loading}
                error={weather.error}
                onRefresh={weather.refresh}
              />
            </div>
            <p className="hint">
              {course.distanceKm.toFixed(2)} km
              {courseRiders.length === 0 && riders.length > 0
                ? ' — estimated positions appear once you set an expected average speed in Setup, or a rider finishes.'
                : ''}
            </p>
          </>
        ) : (
          <p className="empty">No course loaded. Import a GPX on the Setup tab.</p>
        )}
      </section>
    </div>
  )
}
