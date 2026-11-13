import type { DestinationWithStatus } from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';
import { listDestinationsByIds } from './destination.repo';

export async function addFavorite(userId: string, destinationId: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO favorites (user_id, destination_id)
    SELECT ${userId}, d.id FROM destinations d WHERE d.id = ${destinationId}
    ON CONFLICT (user_id, destination_id) DO NOTHING
    RETURNING 1
  `;
  if (rows.length > 0) return true;
  const exists = await sql`SELECT 1 FROM destinations WHERE id = ${destinationId}`;
  return exists.length > 0;
}

export async function removeFavorite(userId: string, destinationId: string): Promise<void> {
  await sql`DELETE FROM favorites WHERE user_id = ${userId} AND destination_id = ${destinationId}`;
}

export async function listFavorites(userId: string): Promise<DestinationWithStatus[]> {
  const rows = await sql<{ destination_id: string }[]>`
    SELECT destination_id FROM favorites WHERE user_id = ${userId} ORDER BY created_at DESC
  `;
  return listDestinationsByIds(rows.map((r) => r.destination_id));
}
