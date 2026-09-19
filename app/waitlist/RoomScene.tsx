/**
 * The ambient scene on the right: cove measuring a room, on a slow 18s loop.
 * Pure SVG + CSS — no JS, no mouse tracking, and it holds its finished state
 * when the viewer has reduced motion on.
 */
export default function RoomScene() {
  return (
    <svg className="wl-scene" viewBox="0 0 360 300" fill="none" aria-hidden>
      <defs>
        <linearGradient id="wl-scan-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="70%" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        {/* floor + wall corner, always there */}
        <path className="wl-s-floor" d="M6 250h348" />
        <path className="wl-s-floor" d="M150 250V74" opacity="0.35" />

        {/* the scan sweep */}
        <g className="wl-s-scan">
          <rect x="6" y="-48" width="348" height="48" fill="url(#wl-scan-grad)" stroke="none" />
          <path d="M6 0h348" strokeWidth="1.2" opacity="0.9" />
        </g>

        {/* doorway, drawn as the scan clears it */}
        <path className="wl-s-arch" d="M44 250V132a34 34 0 0 1 68 0v118" />

        {/* its height, measured */}
        <g className="wl-s-dim">
          <path d="M24 250V118" strokeDasharray="3 5" />
          <path d="M18 118h12M18 250h12" />
          <text x="14" y="184" transform="rotate(-90 14 184)" className="wl-s-label">
            80&quot;
          </text>
        </g>

        {/* the sofa settles into place */}
        <g className="wl-s-sofa">
          <rect x="196" y="156" width="128" height="42" rx="11" />
          <rect x="190" y="190" width="140" height="44" rx="10" />
          <rect x="178" y="176" width="20" height="60" rx="10" />
          <rect x="322" y="176" width="20" height="60" rx="10" />
          <path d="M260 192v40" opacity="0.45" />
          <path d="M192 236v10M326 236v10" />
        </g>

        {/* width call-out + the payoff tag */}
        <g className="wl-s-late">
          <path d="M178 266h164" strokeDasharray="3 5" />
          <path d="M178 261v10M342 261v10" />
          <text x="260" y="286" textAnchor="middle" className="wl-s-label">
            84&quot;
          </text>

          <g className="wl-s-tag">
            <rect x="228" y="112" width="64" height="24" rx="12" />
            <path d="M242 124.5l4 4 7-8" strokeWidth="1.3" />
            <text x="270" y="128" textAnchor="middle" className="wl-s-label">
              fits
            </text>
          </g>
        </g>

        {/* slow motes, so the scene is never fully still */}
        <circle className="wl-s-mote wl-s-mote-a" cx="140" cy="230" r="1.4" fill="currentColor" stroke="none" />
        <circle className="wl-s-mote wl-s-mote-b" cx="286" cy="240" r="1.2" fill="currentColor" stroke="none" />
        <circle className="wl-s-mote wl-s-mote-c" cx="68" cy="236" r="1.1" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
