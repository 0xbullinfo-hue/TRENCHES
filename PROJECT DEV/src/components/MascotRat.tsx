'use client';

import React from 'react';

interface MascotRatProps {
  className?: string;
  size?: number;
  variant?: 'hero' | 'icon';
}

/**
 * Trench Rat Mascot SVG (Hard Flat Toxic Theme — Zero Blur / Zero Glow Filters).
 */
export const MascotRat: React.FC<MascotRatProps> = ({
  className = '',
  size = 320,
  variant = 'hero',
}) => {
  if (variant === 'icon') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="TrenchLabs Rat Emblem"
      >
        {/* Ears */}
        <path
          d="M14 23C10 18 11 10 17 9C22 8 24 14 22 19Z"
          fill="#11161D"
          stroke="#2A3442"
          strokeWidth="1.5"
        />
        <path
          d="M46 23C50 18 49 10 43 9C38 8 36 14 38 19Z"
          fill="#11161D"
          stroke="#2A3442"
          strokeWidth="1.5"
        />

        {/* Head silhouette */}
        <path
          d="M16 34C14 24 19 16 30 16C41 16 46 24 44 34C42 42 36 47 30 47C24 47 18 42 16 34Z"
          fill="#161C24"
          stroke="#2F3B4C"
          strokeWidth="1.5"
        />

        {/* Matte tactical goggles */}
        <rect
          x="17"
          y="23"
          width="11"
          height="8"
          rx="1.5"
          fill="#0A0E13"
          stroke="#2B3645"
          strokeWidth="1.5"
        />
        <rect
          x="32"
          y="23"
          width="11"
          height="8"
          rx="1.5"
          fill="#0A0E13"
          stroke="#2B3645"
          strokeWidth="1.5"
        />
        <line x1="28" y1="27" x2="32" y2="27" stroke="#2B3645" strokeWidth="2" />

        {/* Snout */}
        <polygon points="28,36 32,36 30,39" fill="#334154" />

        {/* Erlenmeyer Flask */}
        <path
          d="M44 36V31H48V36L55 51C56 53 54.5 55 52 55H40C37.5 55 36 53 37 51L44 36Z"
          fill="#0A0E13"
          stroke="#52647A"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Flat Mint/Emerald Green Liquid (#34D399) */}
        <path
          d="M40.5 45.5H51.5L54.2 51.2C54.8 52.5 53.8 53.8 52 53.8H40C38.2 53.8 37.2 52.5 37.8 51.2L40.5 45.5Z"
          fill="#34D399"
        />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 400 380"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`select-none ${className}`}
      role="img"
      aria-label="Trench Rat Mascot"
    >
      <rect width="400" height="380" fill="#11161D" />
    </svg>
  );
};
