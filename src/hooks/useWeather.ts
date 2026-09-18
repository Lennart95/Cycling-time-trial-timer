import { useEffect, useRef, useState } from 'react'

export interface WeatherReading {
  temperatureC: number
  windSpeedKmh: number
  windDirectionDeg: number
  windGustKmh: number | null
  fetchedAt: number
}

interface WeatherState {
  data: WeatherReading | null
  loading: boolean
  error: string | null
}

const REFRESH_MS = 10 * 60 * 1000 // conditions at a venue don't need finer than this

/**
 * Current temperature + wind for a fixed lat/lon, via Open-Meteo (free, no API
 * key — safe to call directly from client-side code in a public repo/build).
 * Refetches every REFRESH_MS and whenever lat/lon changes; best-effort only —
 * failures surface as `error` rather than breaking anything else.
 */
export function useWeather(lat: number | null, lon: number | null) {
  const [state, setState] = useState<WeatherState>({ data: null, loading: false, error: null })
  const reqIdRef = useRef(0)

  const fetchNow = () => {
    if (lat == null || lon == null) return
    const reqId = ++reqIdRef.current
    setState((s) => ({ ...s, loading: true, error: null }))
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&wind_speed_unit=kmh&temperature_unit=celsius`
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
        return res.json()
      })
      .then((json) => {
        if (reqIdRef.current !== reqId) return // superseded by a newer request
        const c = json?.current
        if (!c || typeof c.temperature_2m !== 'number' || typeof c.wind_speed_10m !== 'number') {
          throw new Error('Unexpected response from weather service')
        }
        setState({
          data: {
            temperatureC: c.temperature_2m,
            windSpeedKmh: c.wind_speed_10m,
            windDirectionDeg: typeof c.wind_direction_10m === 'number' ? c.wind_direction_10m : 0,
            windGustKmh: typeof c.wind_gusts_10m === 'number' ? c.wind_gusts_10m : null,
            fetchedAt: Date.now(),
          },
          loading: false,
          error: null,
        })
      })
      .catch((err: unknown) => {
        if (reqIdRef.current !== reqId) return
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not load weather',
        }))
      })
  }

  useEffect(() => {
    if (lat == null || lon == null) {
      setState({ data: null, loading: false, error: null })
      return
    }
    fetchNow()
    const iv = setInterval(fetchNow, REFRESH_MS)
    return () => clearInterval(iv)
    // fetchNow closes over lat/lon fresh each render; only re-arm on real change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon])

  return { ...state, refresh: fetchNow }
}
