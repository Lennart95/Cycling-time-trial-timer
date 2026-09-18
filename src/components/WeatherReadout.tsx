import type { WeatherReading } from '../hooks/useWeather'
import { degToCompass } from '../lib/weather'
import { WindVane } from './WindVane'

/** Small wind/temperature readout. Purely presentational — see useWeather for fetching. */
export function WeatherReadout({
  data,
  loading,
  error,
  onRefresh,
}: {
  data: WeatherReading | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  return (
    <div className="weather-readout">
      {data ? (
        <>
          <WindVane directionDeg={data.windDirectionDeg} />
          <span className="weather-item" title="Wind speed and direction">
            {Math.round(data.windSpeedKmh)} km/h {degToCompass(data.windDirectionDeg)}
            {data.windGustKmh != null && data.windGustKmh > data.windSpeedKmh + 3
              ? ` (gust ${Math.round(data.windGustKmh)})`
              : ''}
          </span>
          <span className="weather-item">{Math.round(data.temperatureC)}°C</span>
        </>
      ) : loading ? (
        <span className="weather-item hint">Loading weather…</span>
      ) : error ? (
        <span className="weather-item hint" title={error}>
          Weather unavailable
        </span>
      ) : null}
      <button
        className="btn icon weather-refresh"
        onClick={onRefresh}
        disabled={loading}
        title="Refresh weather"
      >
        ↻
      </button>
    </div>
  )
}
