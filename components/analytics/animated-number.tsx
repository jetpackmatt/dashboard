"use client"

import { useEffect, useRef, useState } from "react"

interface AnimatedNumberProps {
  value: number
  duration?: number // ms
  decimals?: number
  prefix?: string
  suffix?: string
  locale?: boolean // use toLocaleString for commas
}

// Ease-out cubic for a satisfying deceleration
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function AnimatedNumber({
  value: rawValue,
  duration = 800,
  decimals = 0,
  prefix = "",
  suffix = "",
  locale = false,
}: AnimatedNumberProps) {
  const value = typeof rawValue === 'number' && isFinite(rawValue) ? rawValue : 0
  const [display, setDisplay] = useState(value)
  const prevValue = useRef(value)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const from = prevValue.current
    const to = value
    prevValue.current = value

    if (from === to) {
      setDisplay(to)
      return
    }

    const start = performance.now()

    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutCubic(progress)
      const current = from + (to - from) * eased
      setDisplay(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setDisplay(to)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  const formatted = locale
    ? display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : display.toFixed(decimals)

  return <>{prefix}{formatted}{suffix}</>
}
