import React from 'react';

export function HexCubeLogo({
  className = 'shrink-0',
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <polygon
        points="18,2 32,10 32,26 18,34 4,26 4,10"
        stroke="#34D399"
        strokeWidth="2"
        fill="#11161D"
      />
      <polygon
        points="18,7 27,12.5 27,23.5 18,29 9,23.5 9,12.5"
        stroke="#6EE7B7"
        strokeWidth="1.2"
        strokeDasharray="2 2"
      />
      <line
        x1="18"
        y1="18"
        x2="18"
        y2="29"
        stroke="#34D399"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />
      <line
        x1="18"
        y1="18"
        x2="9"
        y2="12.5"
        stroke="#34D399"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />
      <line
        x1="18"
        y1="18"
        x2="27"
        y2="12.5"
        stroke="#34D399"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />
      <circle cx="18" cy="18" r="2.2" fill="#34D399" />
    </svg>
  );
}

