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
// zoomed into. Owning zoom/pan here sidesteps that entirely — PROVIDED the
// browser's own native zoom is actually suppressed. It isn't enough to
// preventDefault() from a React onWheel/onTouchMove prop: Chrome (and
// React itself, for touch) registers those as passive listeners for
// scroll-performance reasons, which silently makes preventDefault() a
// no-op — the page zooms/scrolls anyway, on top of this component's own
// transform, which is exactly the "zooms in but I can't get it back"
// symptom this was built to fix. Wheel/touch listeners are therefore
// attached manually with { passive: false } instead of via JSX props.
export default function MediaViewer({ src, alt = '', style }) {
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef(null)
  const dragRef = useRef(null)   // { startX, startY, origX, origY } while a drag is in progress
  const pinchRef = useRef(null)  // { startDist, startScale } while a two-finger pinch is in progress
  const gestureScaleRef = useRef(null) // scale at gesturestart, while a Safari trackpad pinch is in progress
  const stateRef = useRef({ scale, pos })
  stateRef.current = { scale, pos }

  // A new photo (or reopening the lightbox) always starts fresh — zoom
  // state shouldn't carry over from whatever was last viewed.
  useEffect(() => { setScale(1); setPos({ x: 0, y: 0 }) }, [src])

  const isVideo = isVideoPath(src)

  const clamp = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  // Rescales around a focal point (cursor position, or the midpoint between
  // two fingers) instead of the image's own center — zooming in on a
  // specific corner/gauge should keep that spot under the cursor, not
  // recenter the whole image every time.
  function zoomTo(nextScale, focal) {
    const { scale: curScale, pos: curPos } = stateRef.current
    const s = clamp(nextScale)
    if (focal && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const fx = focal.x - rect.left - rect.width / 2
      const fy = focal.y - rect.top - rect.height / 2
      const ratio = curScale === 0 ? 1 : s / curScale
      setPos(s === 1 ? { x: 0, y: 0 } : { x: fx - (fx - curPos.x) * ratio, y: fy - (fy - curPos.y) * ratio })
    } else if (s === 1) {
      setPos({ x: 0, y: 0 })
    }
    setScale(s)
  }

  // Manually-attached, non-passive wheel/touch handlers — see the note
  // above on why this can't just be onWheel/onTouchStart/onTouchMove props.
  useEffect(() => {
    if (isVideo) return
    const el = containerRef.current
    if (!el) return

    function onWheel(e) {
      e.preventDefault()
      zoomTo(stateRef.current.scale - e.deltaY * 0.01, { x: e.clientX, y: e.clientY })
    }

    const touchDist = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

    function onTouchStart(e) {
      if (e.touches.length === 2) {
        e.preventDefault()
        pinchRef.current = { startDist: touchDist(e.touches), startScale: stateRef.current.scale }
      } else if (e.touches.length === 1 && stateRef.current.scale > 1) {
        e.preventDefault()
        const t = e.touches[0]
        setDragging(true)
        dragRef.current = { startX: t.clientX, startY: t.clientY, origX: stateRef.current.pos.x, origY: stateRef.current.pos.y }
      }
    }
    function onTouchMove(e) {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault()
        const { startDist, startScale } = pinchRef.current
        const [a, b] = e.touches
        zoomTo(startScale * (touchDist(e.touches) / startDist), { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 })
      } else if (e.touches.length === 1 && dragRef.current) {
        e.preventDefault()
        const t = e.touches[0]
        const d = dragRef.current
        setPos({ x: d.origX + (t.clientX - d.startX), y: d.origY + (t.clientY - d.startY) })
      }
    }
    function onTouchEnd(e) {
      if (e.touches.length < 2) pinchRef.current = null
      if (e.touches.length === 0) { dragRef.current = null; setDragging(false) }
    }

    // Safari trackpad pinch never fires wheel events at all — it fires these
    // proprietary (WebKit-only) gesture events instead, which is exactly what
    // wheel/touch listeners above can't catch. Without this, a Safari desktop
    // trackpad pinch falls straight through to the browser's own native page
    // zoom: the lightbox visibly enlarges past the viewport with no way to
    // pan it (native zoom on a position:fixed lightbox can't be scrolled into
    // view — same underlying issue as the mobile case described up top),
    // and the only way out is closing the lightbox entirely. Chrome/Firefox
    // never fire these events, so this is a no-op there — safe to always add.
    function onGestureStart(e) { e.preventDefault(); gestureScaleRef.current = stateRef.current.scale }
    function onGestureChange(e) {
      e.preventDefault()
      zoomTo((gestureScaleRef.current ?? stateRef.current.scale) * e.scale, { x: e.clientX, y: e.clientY })
    }
    function onGestureEnd(e) { e.preventDefault(); gestureScaleRef.current = null }

    // Windows Chrome/Edge trackpad-pinch and Ctrl+mouse-wheel both fire as
    // wheel events with ctrlKey:true, and preventDefault() on them does stop
    // the browser's native page zoom — but only for wheel events that reach
    // an element with a non-passive listener. The lightbox this sits in has
    // a full-viewport backdrop around the image (padding, letterboxing on
    // non-square photos) that has no listener at all, so the cursor only
    // has to be a few pixels off the image for Ctrl+wheel to fall through
    // uncaught and trigger native zoom on the whole page. Blocking it at
    // the window level, for as long as the lightbox is mounted, closes that
    // gap without needing every caller's backdrop markup to know about it.
    function onWindowWheel(e) { if (e.ctrlKey) e.preventDefault() }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    el.addEventListener('touchcancel', onTouchEnd, { passive: false })
    el.addEventListener('gesturestart', onGestureStart, { passive: false })
    el.addEventListener('gesturechange', onGestureChange, { passive: false })
    el.addEventListener('gestureend', onGestureEnd, { passive: false })
    window.addEventListener('wheel', onWindowWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
      window.removeEventListener('wheel', onWindowWheel)
    }
  }, [isVideo])

  if (isVideo) {
    return <video src={src} controls autoPlay style={style} />
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

  return (
    <div
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
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
