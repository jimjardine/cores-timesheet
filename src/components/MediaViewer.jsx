import React, { useState, useRef, useEffect } from 'react'
import { isVideoPath } from '../utils/media'

const MIN_SCALE = 1
const MAX_SCALE = 4

// Full-size lightbox content — image or video (see MediaThumb for the grid
// equivalent). Video gets native controls and autoplay since opening the
// lightbox already is the "play" action.
//
// Images get their own wheel/pinch zoom + drag pan, driven entirely by CSS
// transforms rather than the browser's native page zoom. The lightbox this
// sits in is position:fixed, and fixed-position content can't be panned
// once the *page* is pinch-zoomed on mobile (a long-standing iOS Safari
// quirk — the browser keeps re-centering fixed elements in the visual
// viewport) — you could zoom in but never scroll to see the part you
// zoomed into. Owning zoom/pan here sidesteps that entirely.
export default function MediaViewer({ src, alt = '', style }) {
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef(null)
  const dragRef = useRef(null)   // { startX, startY, origX, origY } while a drag is in progress
  const pinchRef = useRef(null)  // { startDist, startScale } while a two-finger pinch is in progress

  // A new photo (or reopening the lightbox) always starts fresh — zoom
  // state shouldn't carry over from whatever was last viewed.
  useEffect(() => { setScale(1); setPos({ x: 0, y: 0 }) }, [src])

  if (isVideoPath(src)) {
    return <video src={src} controls autoPlay style={style} />
  }

  const clamp = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  // Rescales around a focal point (cursor position, or the midpoint between
  // two fingers) instead of the image's own center — zooming in on a
  // specific corner/gauge should keep that spot under the cursor, not
  // recenter the whole image every time.
  function zoomTo(nextScale, focal) {
    const s = clamp(nextScale)
    if (focal && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const fx = focal.x - rect.left - rect.width / 2
      const fy = focal.y - rect.top - rect.height / 2
      const ratio = scale === 0 ? 1 : s / scale
      setPos(p => (s === 1 ? { x: 0, y: 0 } : { x: fx - (fx - p.x) * ratio, y: fy - (fy - p.y) * ratio }))
    } else if (s === 1) {
      setPos({ x: 0, y: 0 })
    }
    setScale(s)
  }

  function handleWheel(e) {
    e.preventDefault()
    e.stopPropagation()
    zoomTo(scale - e.deltaY * 0.01, { x: e.clientX, y: e.clientY })
  }

  function handleDoubleClick(e) {
    e.stopPropagation()
    zoomTo(scale > 1 ? 1 : 2.5, { x: e.clientX, y: e.clientY })
  }

  function handleMouseDown(e) {
    if (scale <= 1) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }
  function handleMouseMove(e) {
    if (!dragRef.current) return
    e.stopPropagation()
    const d = dragRef.current
    setPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) })
  }
  function endDrag() { dragRef.current = null; setDragging(false) }

  const touchDist = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      e.stopPropagation()
      pinchRef.current = { startDist: touchDist(e.touches), startScale: scale }
    } else if (e.touches.length === 1 && scale > 1) {
      e.stopPropagation()
      const t = e.touches[0]
      setDragging(true)
      dragRef.current = { startX: t.clientX, startY: t.clientY, origX: pos.x, origY: pos.y }
    }
  }
  function handleTouchMove(e) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault()
      e.stopPropagation()
      const { startDist, startScale } = pinchRef.current
      const [a, b] = e.touches
      zoomTo(startScale * (touchDist(e.touches) / startDist), { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 })
    } else if (e.touches.length === 1 && dragRef.current) {
      e.preventDefault()
      e.stopPropagation()
      const t = e.touches[0]
      const d = dragRef.current
      setPos({ x: d.origX + (t.clientX - d.startX), y: d.origY + (t.clientY - d.startY) })
    }
  }
  function handleTouchEnd(e) {
    if (e.touches.length < 2) pinchRef.current = null
    if (e.touches.length === 0) endDrag()
  }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      title={scale > 1 ? 'Drag to pan, double-click to reset' : 'Scroll or pinch to zoom, double-click to zoom in'}
      style={{ ...style, overflow: 'hidden', touchAction: 'none', cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in' }}
    >
      <img
        src={src} alt={alt} draggable={false}
        style={{
          width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none',
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          transition: dragging || pinchRef.current ? 'none' : 'transform 0.15s ease-out',
        }}
      />
    </div>
  )
}
