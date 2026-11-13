import { createHash } from 'node:crypto';
import type { AuthResponse, LoginInput, RegisterInput } from '@ch-alpineroute/shared';
import bcrypt from 'bcryptjs';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config/env';
import { queryClient as sql } from '../db';
import { AppError, isUniqueViolation } from '../lib/errors';
import { createUser, findAuthByEmail, getPublicUser } from '../repositories/user.repo';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';
const BCRYPT_COST = 12;
// Fester Vergleichs-Hash, damit ein Login mit unbekannter E-Mail gleich lange dauert.
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8rYJYxF8q3bJ7yM1r0o2bV1n0v2Y9K';

export interface JwtPayload {
  sub: string;
  role: 'user' | 'admin';
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  if (!payload.sub) throw new Error('Token ohne Subjekt');
  return { sub: payload.sub, role: payload.role === 'admin' ? 'admin' : 'user' };
}

/** Liest den Bearer-Token aus dem Authorization-Header; wirft 401, wenn er fehlt oder ungültig ist. */
export async function requireUser(authorization: string | null | undefined): Promise<JwtPayload> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Authentifizierung erforderlich.');
  try {
    return await verifyToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Token ungültig oder abgelaufen.');
  }
}

/**
 * Zählt Zugriffe je Schlüssel in festen Zeitfenstern in der Datenbank, weil
 * Serverless-Instanzen keinen gemeinsamen Arbeitsspeicher haben. Die IP wird
 * nur als gesalzener Hash gespeichert.
 */
export async function rateLimit(scope: string, identity: string, limit: number, windowSeconds: number): Promise<void> {
  const bucket = `${scope}:${createHash('sha256').update(`${identity}|${env.JWT_SECRET}`).digest('hex').slice(0, 32)}`;
  const rows = await sql<{ hits: number }[]>`
    INSERT INTO rate_limits (bucket, window_start, hits)
    VALUES (${bucket}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds}), 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
    RETURNING hits
  `;
  if ((rows[0]?.hits ?? 0) > limit) {
    throw new AppError(429, 'RATE_LIMITED', 'Zu viele Versuche. Bitte später erneut probieren.');
  }
}

export async function register(input: RegisterInput, clientIp: string): Promise<AuthResponse> {
  await rateLimit('register', clientIp, 10, 3600);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  let id: string;
  try {
    id = await createUser({ email: input.email, passwordHash, displayName: input.displayName ?? null });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'EMAIL_TAKEN', 'Diese E-Mail ist bereits registriert.');
    throw err;
  }
  const user = await getPublicUser(id);
  if (!user) throw new AppError(500, 'INTERNAL', 'Konto konnte nicht angelegt werden.');
  return { token: await signToken({ sub: id, role: 'user' }), user };
}

export async function login(input: LoginInput, clientIp: string): Promise<AuthResponse> {
  await rateLimit('login-ip', clientIp, 20, 900);
  await rateLimit('login-email', input.email.toLowerCase(), 10, 900);
  const auth = await findAuthByEmail(input.email);
  // Konten aus der früheren Fastify-Variante (argon2) lassen sich nicht prüfen und gelten als ungültig.
  const hash = auth && auth.passwordHash.startsWith('$2') ? auth.passwordHash : DUMMY_HASH;
  const ok = await bcrypt.compare(input.password, hash);
  if (!auth || !ok || hash === DUMMY_HASH) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'E-Mail oder Passwort ist falsch.');
  }
  const user = await getPublicUser(auth.id);
  if (!user) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-Mail oder Passwort ist falsch.');
  return { token: await signToken({ sub: auth.id, role: auth.role }), user };
}
