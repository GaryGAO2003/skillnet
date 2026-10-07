// qr.js — QR code SVG rendering via uqr (zero-dependency, renders SVG).

import { renderSVG } from 'uqr';

// Return an SVG string encoding `text`. Kept tiny and dependency-light so the
// server can hand out image/svg+xml QR codes for skill and creator links.
export function qrSvg(text) {
  return renderSVG(String(text || ''), { border: 2 });
}
