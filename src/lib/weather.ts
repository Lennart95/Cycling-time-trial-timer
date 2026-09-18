const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]

/** Meteorological wind direction (degrees, where the wind is blowing FROM) to a compass point. */
export function degToCompass(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16
  return COMPASS[idx]
}
