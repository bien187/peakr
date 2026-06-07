import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// .env liegt im Monorepo-Root — unabhängig vom aktuellen Arbeitsverzeichnis laden.
const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../../../../.env') });

const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().default('postgresql://alpine:alpine@localhost:5432/ch_alpineroute'),

  JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me-please'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // 64 Hex-Zeichen = 32 Byte für AES-256-GCM
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY muss 64 Hex-Zeichen sein (openssl rand -hex 32)')
    .default('0'.repeat(64)),

  ORS_API_KEY: z.string().default(''),

  ENABLE_OPENAI_TREND: booleanFromString.default(false),
  OPENAI_API_KEY: z.string().default(''),

  REDIS_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Ungültige Umgebungsvariablen:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
