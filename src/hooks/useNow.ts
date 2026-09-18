import { useEffect, useState } from 'react'

/** Re-renders the caller on an interval, returning the current epoch ms. */
export function useNow(intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(iv)
  }, [intervalMs])
  return now
}
