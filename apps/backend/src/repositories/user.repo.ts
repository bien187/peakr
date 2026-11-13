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
    createdAt: toIso(r.created_at),
  };
}

export async function getPublicUser(id: string): Promise<PublicUser | null> {
  const rows = await sql<PublicUserRow[]>`
    SELECT id, email, display_name, home_label, role, created_at,
           home_lat::float8 AS home_lat, home_lng::float8 AS home_lng
    FROM users WHERE id = ${id} LIMIT 1
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
  await sql`
    UPDATE users SET
      display_name = ${patch.displayName === undefined ? sql`display_name` : patch.displayName},
      home_label = ${patch.homeLabel === undefined ? sql`home_label` : patch.homeLabel},
      home_lat = ${patch.homeLocation === undefined ? sql`home_lat` : patch.homeLocation.lat},
      home_lng = ${patch.homeLocation === undefined ? sql`home_lng` : patch.homeLocation.lng},
      updated_at = now()
    WHERE id = ${id}
  `;
}
