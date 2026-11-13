import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Es gibt genau EINE .env im Monorepo-Root; bereits gesetzte Variablen haben Vorrang.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace-Pakete liegen als TypeScript-Quelltext vor.
  transpilePackages: ['@ch-alpineroute/shared', '@ch-alpineroute/backend'],
  serverExternalPackages: ['postgres', 'pino', 'pino-pretty', 'bcryptjs'],
  // Monorepo: Abhängigkeiten ausserhalb von apps/frontend mit ins Funktions-Bundle nehmen.
  outputFileTracingRoot: resolve(here, '../..'),
  // Strassengraph und Suchindex werden zur Laufzeit per fs gelesen und müssen ausdrücklich ins Bundle.
  outputFileTracingIncludes: {
    '/api/search': ['./data/road-graph.bin', './data/search-index.json.gz'],
    '/api/health': ['./data/road-graph.bin', './data/search-index.json.gz'],
    '/api/destinations/[id]': ['./data/road-graph.bin'],
  },
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
