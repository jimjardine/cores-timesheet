import React, { useEffect, useState } from 'react'

const COLORS = ['#ff5e7e', '#ffd23f', '#6ac3ff', '#7ee787', '#c792ff', '#ff9f45']

// Lightweight, dependency-free confetti — a fixed number of pieces falling
// from the top of the viewport with randomized drift/spin/timing, removed
// once the longest piece's animation finishes. No canvas, no library: a
// one-off celebratory flourish doesn't need either.
export default function ConfettiBurst({ active, onDone }) {
  const [pieces, setPieces] = useState([])

  useEffect(() => {
    if (!active) return
    const count = 90
    const next = Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duration: 2.4 + Math.random() * 1.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 6 + Math.random() * 6,
      drift: (Math.random() - 0.5) * 200,
      spin: 360 + Math.random() * 720,
      shape: Math.random() < 0.5 ? '50%' : '2px',
    }))
    setPieces(next)
    const maxLife = Math.max(...next.map(p => p.delay + p.duration)) * 1000
    const t = setTimeout(() => { setPieces([]); onDone?.() }, maxLife + 200)
    return () => clearTimeout(t)
  }, [active])

  if (pieces.length === 0) return null

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2000, overflow: 'hidden' }}>
      <style>{`
        @keyframes confetti-fall {
          from { transform: translate(0, -10vh) rotate(0deg); opacity: 1; }
          to   { transform: translate(var(--drift), 110vh) rotate(var(--spin)); opacity: 0.9; }
        }
      `}</style>
      {pieces.map(p => (
        <div key={p.id} style={{
          position: 'absolute', top: 0, left: `${p.left}%`,
          width: p.size, height: p.size * 1.4, background: p.color, borderRadius: p.shape,
          animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
          '--drift': `${p.drift}px`, '--spin': `${p.spin}deg`,
        }} />
      ))}
    </div>
  )
}
