import { ok } from '@/lib/server/response';

export async function POST() {
  return ok({ message: 'Erfolgreich abgemeldet.' });
}
