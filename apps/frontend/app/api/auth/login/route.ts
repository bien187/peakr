import { loginInputSchema } from '@ch-alpineroute/shared';
import bcrypt from 'bcryptjs';
import sql from '@/lib/server/db';
import { signToken } from '@/lib/server/jwt';
import { err, ok } from '@/lib/server/response';

export async function POST(req: Request) {
  try {
    const body = loginInputSchema.safeParse(await req.json());
    if (!body.success) return err(400, 'VALIDATION', 'Ungültige Eingabe');

    const { email, password } = body.data;
    const rows = await sql<{ id: string; password_hash: string; role: string }[]>`
      SELECT id, password_hash, role FROM users WHERE email = ${email.toLowerCase()} LIMIT 1
    `;
    const auth = rows[0];
    const ok_ = auth ? await bcrypt.compare(password, auth.password_hash) : false;
    if (!auth || !ok_) return err(401, 'INVALID_CREDENTIALS', 'E-Mail oder Passwort ist falsch.');

    const user = await getPublicUser(auth.id);
    const token = await signToken({ sub: auth.id, role: auth.role === 'admin' ? 'admin' : 'user' });
    return ok({ token, user });
  } catch (e) {
    console.error(e);
    return err(500, 'INTERNAL', 'Login fehlgeschlagen.');
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
      ST_Y(home_location::geometry) AS home_lat, ST_X(home_location::geometry) AS home_lng
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
