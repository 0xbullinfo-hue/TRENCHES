/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

// CSP. Next.js inline bootstrap scripts need 'unsafe-inline' unless you add nonce middleware.
// Ships as Report-Only by default (so a wallet integration can't be broken blind);
// set CSP_ENFORCE=true once staging shows no violations in the browser console.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src https://connect.solflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const cspHeader =
  process.env.CSP_ENFORCE === 'true' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true }, // disables /_next/image attack surface
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: cspHeader, value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
};

export default nextConfig;
