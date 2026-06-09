import { updateMeSchema } from '@ch-alpineroute/shared';
import sql from '@/lib/server/db';
import { getUserFromRequest } from '@/lib/server/jwt';
import { err, ok } from '@/lib/server/response';

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

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return err(401, 'UNAUTHORIZED', 'Authentifizierung erforderlich.');
  const data = await getPublicUser(user.sub);
  if (!data) return err(404, 'NOT_FOUND', 'Benutzer nicht gefunden.');
  return ok(data);
}

export async function PATCH(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return err(401, 'UNAUTHORIZED', 'Authentifizierung erforderlich.');

  try {
    const body = updateMeSchema.safeParse(await req.json());
    if (!body.success) return err(400, 'VALIDATION', 'Ungültige Eingabe');
    const patch = body.data;

    if (patch.displayName !== undefined) {
      await sql`UPDATE users SET display_name = ${patch.displayName}, updated_at = now() WHERE id = ${user.sub}`;
    }
    if (patch.homeLabel !== undefined) {
      await sql`UPDATE users SET home_label = ${patch.homeLabel}, updated_at = now() WHERE id = ${user.sub}`;
    }
    if (patch.homeLocation !== undefined) {
      await sql`
        UPDATE users SET
          home_location = ST_SetSRID(ST_MakePoint(${patch.homeLocation.lng}, ${patch.homeLocation.lat}), 4326)::geography,
          updated_at = now()
        WHERE id = ${user.sub}
      `;
    }

    const data = await getPublicUser(user.sub);
    return ok(data);
  } catch (e) {
    console.error(e);
    return err(500, 'INTERNAL', 'Profil konnte nicht aktualisiert werden.');
  }
}
