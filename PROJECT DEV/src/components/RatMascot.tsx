import React from 'react';

export function RatMascot({ className = 'w-48 h-48' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Body & Trench Vest */}
      <circle cx="100" cy="115" r="45" fill="#161C24" stroke="#163A2D" strokeWidth="2" />
      <path d="M78 100 L100 135 L122 100 Z" fill="#11161D" />

      {/* Ears */}
      <circle cx="70" cy="65" r="16" fill="#161C24" stroke="#163A2D" strokeWidth="2" />
      <circle cx="70" cy="65" r="9" fill="#11161D" />
      <circle cx="130" cy="65" r="16" fill="#161C24" stroke="#163A2D" strokeWidth="2" />
      <circle cx="130" cy="65" r="9" fill="#11161D" />

      {/* Head */}
      <ellipse cx="100" cy="85" rx="32" ry="28" fill="#161C24" stroke="#163A2D" strokeWidth="2" />
      <circle cx="100" cy="94" r="5" fill="#0A0E13" />

      {/* Tactical Goggles (Matte Dark - STRICTLY NON-GLOWING) */}
      <rect x="74" y="74" width="22" height="14" rx="2" fill="#0A0E13" stroke="#374151" strokeWidth="2" />
      <rect x="104" y="74" width="22" height="14" rx="2" fill="#0A0E13" stroke="#374151" strokeWidth="2" />
      <line x1="96" y1="81" x2="104" y2="81" stroke="#374151" strokeWidth="3" />

      {/* Flat Toxic Beaker (Matches Theme Palette #34D399 / #6EE7B7) */}
      <g>
        <path
          d="M125 125 L135 155 C136 158 133 162 129 162 L111 162 C107 162 104 158 105 155 L115 125 Z"
          fill="#34D399"
          stroke="#6EE7B7"
          strokeWidth="1.5"
        />
        <rect x="117" y="122" width="6" height="4" rx="1" fill="#6EE7B7" />
        {/* Bubbles */}
        <circle cx="120" cy="148" r="2" fill="#FFFFFF" />
        <circle cx="125" cy="140" r="1.5" fill="#FFFFFF" />
      </g>
    </svg>
  );
}
