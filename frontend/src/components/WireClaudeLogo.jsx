export default function WireClaudeLogo({ size = 24, className = '' }) {
  const h = Math.round(size * 0.75)
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 48 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Body — torpedo */}
      <path d="M8 18 Q22 10 38 16 L43 18 L38 20 Q22 26 8 18Z" fill="#007acc"/>

      {/* Dorsal fin */}
      <path d="M20 16 L23 5 L27 16" fill="#005a9e"/>

      {/* Caudal fin (tail) */}
      <path d="M8 18 L1 11 L1 25Z" fill="#005a9e"/>

      {/* Pectoral fin */}
      <path d="M23 20 L25 27 L29 20" fill="#0072b8"/>

      {/* Snout tip */}
      <path d="M38 16 L45 17.5 L44 18.5 L38 20Z" fill="#005a9e"/>

      {/* Robot eye — square LED */}
      <rect x="33" y="14.5" width="5.5" height="5.5" rx="0.5" fill="#1e1e1e"/>
      <rect x="34.5" y="16" width="2.5" height="2.5" fill="#dcdcaa"/>

      {/* Antenna */}
      <line x1="23" y1="5" x2="23" y2="1.5" stroke="#4fc1ff" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="23" cy="1" r="1.5" fill="#dcdcaa"/>

      {/* Circuit trace on body */}
      <polyline
        points="15,18 19,18 19,20.5 24,20.5"
        stroke="#4fc1ff" strokeWidth="0.9" strokeLinecap="square" fill="none" opacity="0.7"
      />
      <circle cx="15" cy="18" r="0.9" fill="#4fc1ff" opacity="0.7"/>
      <circle cx="24" cy="20.5" r="0.9" fill="#4fc1ff" opacity="0.7"/>
    </svg>
  )
}
