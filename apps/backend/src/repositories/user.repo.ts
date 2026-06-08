import type { LatLng, PublicUser, UpdateMeInput } from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';
import { toIso } from '../lib/dates';

interface PublicUserRow {
  id: string;
  email: string;
  display_name: string | null;
  home_label: string | null;
  role: 'user' | 'admin';
  created_at: Date;
  has_openai_key: boolean;
  home_lat: number | null;
  home_lng: number | null;
}

function toPublicUser(r: PublicUserRow): PublicUser {
  const homeLocation: LatLng | null =
    r.home_lat !== null && r.home_lng !== null ? { lat: r.home_lat, lng: r.home_lng } : null;
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    homeLocation,
    homeLabel: r.home_label,
    role: r.role,
    hasOpenAiKey: r.has_openai_key,
    createdAt: toIso(r.created_at),
  };
}

const PUBLIC_SELECT = sql`
  id, email, display_name, home_label, role, created_at,
  (openai_key_enc IS NOT NULL) AS has_openai_key,
  ST_Y(home_location::geometry) AS home_lat,
  ST_X(home_location::geometry) AS home_lng
`;

export async function getPublicUser(id: string): Promise<PublicUser | null> {
  const rows = await sql<PublicUserRow[]>`
    SELECT ${PUBLIC_SELECT} FROM users WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  displayName?: string | null;
}): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${input.email.toLowerCase()}, ${input.passwordHash}, ${input.displayName ?? null})
    RETURNING id
  `;
  return rows[0].id;
}

export interface AuthRecord {
  id: string;
  passwordHash: string;
  role: 'user' | 'admin';
}

export async function findAuthByEmail(email: string): Promise<AuthRecord | null> {
  const rows = await sql<{ id: string; password_hash: string; role: 'user' | 'admin' }[]>`
    SELECT id, password_hash, role FROM users WHERE email = ${email.toLowerCase()} LIMIT 1
  `;
  const r = rows[0];
  return r ? { id: r.id, passwordHash: r.password_hash, role: r.role } : null;
}

export async function updateProfile(id: string, patch: UpdateMeInput): Promise<void> {
  if (patch.displayName !== undefined) {
    await sql`UPDATE users SET display_name = ${patch.displayName}, updated_at = now() WHERE id = ${id}`;
  }
  if (patch.homeLabel !== undefined) {
    await sql`UPDATE users SET home_label = ${patch.homeLabel}, updated_at = now() WHERE id = ${id}`;
  }
  if (patch.homeLocation !== undefined) {
    await sql`
      UPDATE users
      SET home_location = ST_SetSRID(ST_MakePoint(${patch.homeLocation.lng}, ${patch.homeLocation.lat}), 4326)::geography,
          updated_at = now()
      WHERE id = ${id}
    `;
  }
}

export async function setOpenAiKey(id: string, ciphertext: Buffer, iv: Buffer): Promise<void> {
  await sql`
    UPDATE users SET openai_key_enc = ${ciphertext}, openai_key_iv = ${iv}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function clearOpenAiKey(id: string): Promise<void> {
  await sql`
    UPDATE users SET openai_key_enc = NULL, openai_key_iv = NULL, updated_at = now() WHERE id = ${id}
  `;
}

export async function getOpenAiKey(id: string): Promise<{ ciphertext: Buffer; iv: Buffer } | null> {
  const rows = await sql<{ openai_key_enc: Buffer | null; openai_key_iv: Buffer | null }[]>`
    SELECT openai_key_enc, openai_key_iv FROM users WHERE id = ${id} LIMIT 1
  `;
  const r = rows[0];
  if (!r || !r.openai_key_enc || !r.openai_key_iv) return null;
  return { ciphertext: r.openai_key_enc, iv: r.openai_key_iv };
}
