/** Small compass with an arrow pointing where the wind is blowing TO. */
export function WindVane({ directionDeg, size = 34 }: { directionDeg: number; size?: number }) {
  const travelDeg = (directionDeg + 180) % 360

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className="wind-vane"
      role="img"
      aria-label={`Wind blowing toward ${Math.round(travelDeg)}°`}
    >
      <circle cx="20" cy="20" r="18" className="wind-vane-ring" />
      <text x="20" y="8.5" className="wind-vane-n">
        N
      </text>
      <g style={{ transform: `rotate(${travelDeg}deg)`, transformOrigin: '20px 20px' }}>
        <line x1="20" y1="29" x2="20" y2="12" className="wind-vane-arrow" />
        <polygon points="20,7 15,16 25,16" className="wind-vane-arrow" />
      </g>
    </svg>
  )
}
