import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// NEXT_PUBLIC_* aus der zentralen .env im Monorepo-Root laden,
// damit es nur EINE .env-Datei gibt.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ch-alpineroute/shared'],
  // ESLint läuft separat über das Root-Script `pnpm lint`.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
