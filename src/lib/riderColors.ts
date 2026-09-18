// Okabe–Ito colorblind-safe qualitative palette, minus a plain grey (would
// blend into the dark UI/route line) — cycles if there are more riders than
// colors. Shared by the course map and the On Course list so a rider's color
// matches everywhere.
const RIDER_COLORS = [
  '#e69f00',
  '#56b4e9',
  '#009e73',
  '#f0e442',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
]

/** Stable color for a rider, keyed by startOrder so it never shifts as others finish. */
export function riderColor(startOrder: number): string {
  const i = ((startOrder % RIDER_COLORS.length) + RIDER_COLORS.length) % RIDER_COLORS.length
  return RIDER_COLORS[i]
}
