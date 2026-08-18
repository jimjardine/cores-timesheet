import React from 'react'
import { isVideoPath } from '../utils/media'

// Full-size lightbox content — image or video (see MediaThumb for the grid
// equivalent). Video gets native controls and autoplay since opening the
// lightbox already is the "play" action.
export default function MediaViewer({ src, alt = '', style }) {
  if (isVideoPath(src)) {
    return <video src={src} controls autoPlay style={style} />
  }
  return <img src={src} alt={alt} style={style} />
}
