import React from 'react'
import { isVideoPath } from '../utils/media'

// Grid thumbnail for a gear_photos row — image or video, decided by file
// extension (see utils/media.js). Video gets a muted, controls-less preview
// frame plus a play badge so it reads as "tap to play" rather than a broken
// image. Used by GearPhotos/SmsReview/Reports/AdminDashboard/EmployeeHome so
// none of them have to special-case video on their own.
export default function MediaThumb({ src, alt = '', style, onClick, loading }) {
  if (isVideoPath(src)) {
    return (
      <div onClick={onClick} style={{ position: 'relative', cursor: onClick ? 'pointer' : undefined, ...style }}>
        <video src={src} muted playsInline preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 'inherit' }} />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.15)', borderRadius: 'inherit',
        }}>
          <div style={{
            width: '1.6em', height: '1.6em', borderRadius: '50%', background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ width: 0, height: 0, marginLeft: '0.15em', borderTop: '0.5em solid transparent', borderBottom: '0.5em solid transparent', borderLeft: '0.8em solid #fff' }} />
          </div>
        </div>
      </div>
    )
  }
  return <img src={src} alt={alt} loading={loading} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined, ...style }} />
}
