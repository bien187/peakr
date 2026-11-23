/**
 * Geteilte Listen – Regeln:
 *  - Alle Mitglieder sehen die Liste, fügen Ziele hinzu und entfernen sie.
 *  - Nur die Besitzerin bzw. der Besitzer benennt um und löscht.
 *  - Andere Mitglieder können die Liste verlassen.
 *  - Wer nicht Mitglied ist, bekommt 404 (nicht 403): die Liste bleibt unsichtbar.
 *  - Beitreten nur über den Einladungslink.
 */
import type { CreateListInput, ListDetail, ListInvite, ListSummary } from '@ch-alpineroute/shared';
import { AppError } from '../lib/errors';
import {
  addListItem,
  addMember,
  countItems,
  countOwnedLists,
  createList,
  deleteList,
  getList,
  inviteByToken,
  leaveList,
  LIST_LIMITS,
  listsForUser,
  memberRole,
  removeListItem,
  renameList,
} from '../repositories/lists.repo';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Liste nicht gefunden.');

async function requireMember(listId: string, userId: string) {
  const role = await memberRole(listId, userId);
  if (!role) throw notFound();
  return role;
}

export function myLists(userId: string, destinationId?: string): Promise<ListSummary[]> {
  return listsForUser(userId, destinationId);
}

export async function newList(userId: string, input: CreateListInput): Promise<ListDetail> {
  if ((await countOwnedLists(userId)) >= LIST_LIMITS.ownedLists) {
    throw new AppError(409, 'LIMIT', `Höchstens ${LIST_LIMITS.ownedLists} eigene Listen.`);
  }
  const id = await createList(userId, input.name, input.destinationId);
  const list = await getList(id, userId);
  if (!list) throw new AppError(500, 'INTERNAL', 'Liste konnte nicht angelegt werden.');
  return list;
}

export async function listDetail(listId: string, userId: string): Promise<ListDetail> {
  const list = await getList(listId, userId);
  if (!list) throw notFound();
  return list;
}

export async function rename(listId: string, userId: string, name: string): Promise<ListDetail> {
  const role = await requireMember(listId, userId);
  if (role !== 'owner') throw new AppError(403, 'FORBIDDEN', 'Nur wer die Liste erstellt hat, kann sie umbenennen.');
  await renameList(listId, name);
  return listDetail(listId, userId);
}

/** Besitzer: Liste löschen. Mitglied: Liste verlassen. */
export async function removeOrLeave(listId: string, userId: string): Promise<{ message: string }> {
  const role = await requireMember(listId, userId);
  if (role === 'owner') {
    await deleteList(listId);
    return { message: 'Liste gelöscht.' };
  }
  await leaveList(listId, userId);
  return { message: 'Liste verlassen.' };
}

export async function addItem(listId: string, userId: string, destinationId: string): Promise<{ message: string }> {
  await requireMember(listId, userId);
  if ((await countItems(listId)) >= LIST_LIMITS.items) {
    throw new AppError(409, 'LIMIT', `Höchstens ${LIST_LIMITS.items} Ziele je Liste.`);
  }
  const ok = await addListItem(listId, userId, destinationId);
  if (!ok) throw new AppError(404, 'NOT_FOUND', 'Ziel nicht gefunden.');
  return { message: 'Zur Liste hinzugefügt.' };
}

export async function removeItem(listId: string, userId: string, destinationId: string): Promise<{ message: string }> {
  await requireMember(listId, userId);
  await removeListItem(listId, destinationId);
  return { message: 'Aus der Liste entfernt.' };
}

export async function invite(token: string, userId: string | null): Promise<ListInvite> {
  const found = await inviteByToken(token, userId);
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Dieser Einladungslink ist ungültig.');
  return found;
}

export async function join(token: string, userId: string): Promise<{ id: string }> {
  const found = await inviteByToken(token, userId);
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Dieser Einladungslink ist ungültig.');
  if (!found.isMember) {
    if (found.memberCount >= LIST_LIMITS.members) {
      throw new AppError(409, 'LIMIT', `Diese Liste hat bereits ${LIST_LIMITS.members} Mitglieder.`);
    }
    await addMember(found.id, userId);
  }
  return { id: found.id };
}
