import sql from '@/lib/server/db';
import { getUserFromRequest } from '@/lib/server/jwt';
import { err, ok } from '@/lib/server/response';

export async function POST(req: Request, { params }: { params: Promise<{ destinationId: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return err(401, 'UNAUTHORIZED', 'Authentifizierung erforderlich.');
  const { destinationId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(destinationId)) return err(400, 'VALIDATION', 'Ungültige ID');

  try {
    await sql`INSERT INTO favorites (user_id, destination_id) VALUES (${user.sub}, ${destinationId}) ON CONFLICT DO NOTHING`;
    return ok({ message: 'Favorit hinzugefügt.' }, 201);
  } catch (e) {
    console.error(e);
    return err(500, 'INTERNAL', 'Fehler beim Hinzufügen.');
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ destinationId: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return err(401, 'UNAUTHORIZED', 'Authentifizierung erforderlich.');
  const { destinationId } = await params;

  try {
    await sql`DELETE FROM favorites WHERE user_id = ${user.sub} AND destination_id = ${destinationId}`;
    return ok({ message: 'Favorit entfernt.' });
  } catch (e) {
    console.error(e);
    return err(500, 'INTERNAL', 'Fehler beim Entfernen.');
  }
}
