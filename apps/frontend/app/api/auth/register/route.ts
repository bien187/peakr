import { registerInputSchema } from '@ch-alpineroute/shared';
import bcrypt from 'bcryptjs';
import sql from '@/lib/server/db';
import { signToken } from '@/lib/server/jwt';
import { err, ok } from '@/lib/server/response';

export async function POST(req: Request) {
  try {
    const body = registerInputSchema.safeParse(await req.json());
    if (!body.success) return err(400, 'VALIDATION', body.error.errors[0]?.message ?? 'Ungültige Eingabe');

    const { email, password, displayName } = body.data;
    const passwordHash = await bcrypt.hash(password, 12);

    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${email.toLowerCase()}, ${passwordHash}, ${displayName ?? null})
      RETURNING id
    `.catch((e: { code?: string }) => {
      if (e.code === '23505') throw Object.assign(new Error('EMAIL_TAKEN'), { code: 409 });
      throw e;
    });

    const id = rows[0].id;
    const user = await getPublicUser(id);
    const token = await signToken({ sub: id, role: 'user' });
    return ok({ token, user }, 201);
  } catch (e: unknown) {
    const cast = e as { code?: number; message?: string };
    if (cast.code === 409) return err(409, 'EMAIL_TAKEN', 'Diese E-Mail ist bereits registriert.');
    console.error(e);
    return err(500, 'INTERNAL', 'Registrierung fehlgeschlagen.');
  }
}

async function getPublicUser(id: string) {
  const rows = await sql<{
    id: string; email: string; display_name: string | null; home_label: string | null;
    role: string; created_at: Date; has_openai_key: boolean;
    home_lat: number | null; home_lng: number | null;
  }[]>`
    SELECT id, email, display_name, home_label, role, created_at,
      (openai_key_enc IS NOT NULL) AS has_openai_key,
      ST_Y(home_location::geometry) AS home_lat,
      ST_X(home_location::geometry) AS home_lng
    FROM users WHERE id = ${id} LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, email: r.email, displayName: r.display_name, homeLabel: r.home_label,
    role: r.role, hasOpenAiKey: r.has_openai_key, createdAt: r.created_at.toISOString(),
    homeLocation: r.home_lat != null && r.home_lng != null ? { lat: r.home_lat, lng: r.home_lng } : null,
  };
}
