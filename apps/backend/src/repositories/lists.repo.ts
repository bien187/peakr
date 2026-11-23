import { randomBytes } from 'node:crypto';
import type { ListDetail, ListInvite, ListRole, ListSummary } from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';
import { toIso } from '../lib/dates';
import { listDestinationsByIds } from './destination.repo';

/** Grenzen gegen Missbrauch; im normalen Gebrauch nie erreicht. */
export const LIST_LIMITS = { ownedLists: 100, items: 500, members: 50 } as const;

/** 18 Zufallsbytes → 24 Zeichen base64url. */
export function newInviteToken(): string {
  return randomBytes(18).toString('base64url');
}

interface SummaryRow {
  id: string;
  name: string;
  role: ListRole;
  item_count: number;
  member_count: number;
  preview: string[] | null;
  contains: boolean | null;
  updated_at: Date | string;
}

function toSummary(r: SummaryRow, withContains: boolean): ListSummary {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    itemCount: r.item_count,
    memberCount: r.member_count,
    preview: r.preview ?? [],
    ...(withContains ? { contains: r.contains === true } : {}),
    updatedAt: toIso(r.updated_at),
  };
}

/** Rolle in der Liste; null = kein Mitglied (oder Liste gibt es nicht). */
export async function memberRole(listId: string, userId: string): Promise<ListRole | null> {
  const rows = await sql<{ role: ListRole }[]>`
    SELECT role FROM list_members WHERE list_id = ${listId} AND user_id = ${userId}
  `;
  return rows[0]?.role ?? null;
}

export async function countOwnedLists(userId: string): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM lists WHERE owner_id = ${userId}`;
  return n;
}

/** Legt eine Liste an (die anlegende Person wird Besitzerin) und nimmt optional gleich ein Ziel auf. */
export async function createList(userId: string, name: string, destinationId?: string): Promise<string> {
  return sql.begin(async (tx) => {
    const [list] = await tx<{ id: string }[]>`
      INSERT INTO lists (name, owner_id, invite_token) VALUES (${name}, ${userId}, ${newInviteToken()}) RETURNING id
    `;
    await tx`INSERT INTO list_members (list_id, user_id, role) VALUES (${list.id}, ${userId}, 'owner')`;
    if (destinationId) {
      await tx`
        INSERT INTO list_items (list_id, destination_id, added_by)
        SELECT ${list.id}, d.id, ${userId} FROM destinations d WHERE d.id = ${destinationId}
        ON CONFLICT DO NOTHING
      `;
    }
    return list.id;
  });
}

/** Alle Listen, in denen die Person Mitglied ist; mit `destinationId` zusätzlich, ob das Ziel darin liegt. */
export async function listsForUser(userId: string, destinationId?: string): Promise<ListSummary[]> {
  const rows = await sql<SummaryRow[]>`
    SELECT l.id, l.name, m.role, l.updated_at,
      (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id) AS item_count,
      (SELECT count(*)::int FROM list_members x WHERE x.list_id = l.id) AS member_count,
      ARRAY(
        SELECT d.name FROM list_items i JOIN destinations d ON d.id = i.destination_id
        WHERE i.list_id = l.id ORDER BY i.added_at DESC LIMIT 3
      ) AS preview,
      ${destinationId
        ? sql`EXISTS (SELECT 1 FROM list_items i WHERE i.list_id = l.id AND i.destination_id = ${destinationId})`
        : sql`NULL::boolean`} AS contains
    FROM list_members m JOIN lists l ON l.id = m.list_id
    WHERE m.user_id = ${userId}
    ORDER BY l.updated_at DESC
  `;
  return rows.map((r) => toSummary(r, destinationId !== undefined));
}

/** Ganze Liste mit Mitgliedern und Zielen; null, wenn die Person kein Mitglied ist. */
export async function getList(listId: string, userId: string): Promise<ListDetail | null> {
  const [head] = await sql<(SummaryRow & { invite_token: string })[]>`
    SELECT l.id, l.name, m.role, l.updated_at, l.invite_token,
      (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id) AS item_count,
      (SELECT count(*)::int FROM list_members x WHERE x.list_id = l.id) AS member_count,
      ARRAY[]::text[] AS preview, NULL::boolean AS contains
    FROM lists l JOIN list_members m ON m.list_id = l.id AND m.user_id = ${userId}
    WHERE l.id = ${listId}
  `;
  if (!head) return null;
  const [members, items] = await Promise.all([
    sql<{ user_id: string; display_name: string | null; role: ListRole }[]>`
      SELECT m.user_id, u.display_name, m.role
      FROM list_members m JOIN users u ON u.id = m.user_id
      WHERE m.list_id = ${listId}
      ORDER BY (m.role = 'owner') DESC, m.joined_at
    `,
    sql<{ destination_id: string; added_at: Date | string; added_by_name: string | null }[]>`
      SELECT i.destination_id, i.added_at, u.display_name AS added_by_name
      FROM list_items i LEFT JOIN users u ON u.id = i.added_by
      WHERE i.list_id = ${listId}
      ORDER BY i.added_at DESC
    `,
  ]);
  const destinations = await listDestinationsByIds(items.map((i) => i.destination_id));
  const meta = new Map(items.map((i) => [i.destination_id, i]));
  return {
    ...toSummary(head, false),
    preview: destinations.slice(0, 3).map((d) => d.name),
    inviteToken: head.invite_token,
    members: members.map((m) => ({ name: m.display_name, role: m.role, isMe: m.user_id === userId })),
    items: destinations.map((d) => {
      const i = meta.get(d.id)!;
      return { ...d, addedBy: i.added_by_name, addedAt: toIso(i.added_at) };
    }),
  };
}

export async function renameList(listId: string, name: string): Promise<void> {
  await sql`UPDATE lists SET name = ${name}, updated_at = now() WHERE id = ${listId}`;
}

export async function deleteList(listId: string): Promise<void> {
  await sql`DELETE FROM lists WHERE id = ${listId}`;
}

export async function leaveList(listId: string, userId: string): Promise<void> {
  await sql`DELETE FROM list_members WHERE list_id = ${listId} AND user_id = ${userId} AND role <> 'owner'`;
}

export async function countItems(listId: string): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM list_items WHERE list_id = ${listId}`;
  return n;
}

/** Nimmt ein Ziel auf. false = Ziel gibt es nicht. Bereits enthaltene Ziele gelten als Erfolg. */
export async function addListItem(listId: string, userId: string, destinationId: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO list_items (list_id, destination_id, added_by)
    SELECT ${listId}, d.id, ${userId} FROM destinations d WHERE d.id = ${destinationId}
    ON CONFLICT (list_id, destination_id) DO NOTHING
    RETURNING 1
  `;
  if (rows.length > 0) {
    await sql`UPDATE lists SET updated_at = now() WHERE id = ${listId}`;
    return true;
  }
  const exists = await sql`SELECT 1 FROM destinations WHERE id = ${destinationId}`;
  return exists.length > 0;
}

export async function removeListItem(listId: string, destinationId: string): Promise<void> {
  const rows = await sql`DELETE FROM list_items WHERE list_id = ${listId} AND destination_id = ${destinationId} RETURNING 1`;
  if (rows.length > 0) await sql`UPDATE lists SET updated_at = now() WHERE id = ${listId}`;
}

interface InviteRow {
  id: string;
  name: string;
  owner_name: string | null;
  item_count: number;
  member_count: number;
  is_member: boolean;
}

/** Einladung zum Link-Geheimnis; null = ungültiger oder veralteter Link. */
export async function inviteByToken(token: string, userId: string | null): Promise<ListInvite | null> {
  const [r] = await sql<InviteRow[]>`
    SELECT l.id, l.name, u.display_name AS owner_name,
      (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id) AS item_count,
      (SELECT count(*)::int FROM list_members x WHERE x.list_id = l.id) AS member_count,
      ${userId
        ? sql`EXISTS (SELECT 1 FROM list_members x WHERE x.list_id = l.id AND x.user_id = ${userId})`
        : sql`false`} AS is_member
    FROM lists l JOIN users u ON u.id = l.owner_id
    WHERE l.invite_token = ${token}
  `;
  return r
    ? { id: r.id, name: r.name, ownerName: r.owner_name, itemCount: r.item_count, memberCount: r.member_count, isMember: r.is_member }
    : null;
}

export async function addMember(listId: string, userId: string): Promise<void> {
  await sql`
    INSERT INTO list_members (list_id, user_id, role) VALUES (${listId}, ${userId}, 'member')
    ON CONFLICT (list_id, user_id) DO NOTHING
  `;
}
