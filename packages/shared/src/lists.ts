import { z } from 'zod';
import { destinationWithStatusSchema } from './destination';

/**
 * Geteilte Listen («Sammlungen» wie Wunschlisten): Besitzerin bzw. Besitzer
 * lädt über einen Link ein, alle Mitglieder fügen Ziele hinzu oder entfernen sie.
 * Andere Mitglieder sehen nur Anzeigenamen, nie E-Mail-Adressen.
 */

export const LIST_NAME_MAX = 80;
export const listNameSchema = z.string().trim().min(1, 'Bitte einen Namen eingeben.').max(LIST_NAME_MAX);

export const createListSchema = z.object({
  name: listNameSchema,
  /** Ziel, das gleich in die neue Liste kommt. */
  destinationId: z.string().uuid().optional(),
});
export type CreateListInput = z.infer<typeof createListSchema>;

export const updateListSchema = z.object({ name: listNameSchema });
export type UpdateListInput = z.infer<typeof updateListSchema>;

export const addListItemSchema = z.object({ destinationId: z.string().uuid() });

/** Geheimnis im Einladungslink (base64url). */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export const listRoleSchema = z.enum(['owner', 'member']);
export type ListRole = z.infer<typeof listRoleSchema>;

export const listSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: listRoleSchema,
  itemCount: z.number().int(),
  memberCount: z.number().int(),
  /** Namen der zuletzt hinzugefügten Ziele (höchstens drei). */
  preview: z.array(z.string()),
  /** Nur mit `?destination=…`: liegt dieses Ziel bereits in der Liste? */
  contains: z.boolean().optional(),
  updatedAt: z.string(),
});
export type ListSummary = z.infer<typeof listSummarySchema>;

export const listMemberSchema = z.object({
  name: z.string().nullable(),
  role: listRoleSchema,
  isMe: z.boolean(),
});
export type ListMember = z.infer<typeof listMemberSchema>;

export const listItemSchema = destinationWithStatusSchema.extend({
  addedBy: z.string().nullable(),
  addedAt: z.string(),
});
export type ListItem = z.infer<typeof listItemSchema>;

export const listDetailSchema = listSummarySchema.extend({
  inviteToken: z.string(),
  members: z.array(listMemberSchema),
  items: z.array(listItemSchema),
});
export type ListDetail = z.infer<typeof listDetailSchema>;

/** Vorschau einer Einladung (auch ohne Anmeldung abrufbar). */
export const listInviteSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ownerName: z.string().nullable(),
  itemCount: z.number().int(),
  memberCount: z.number().int(),
  /** Angemeldet und bereits Mitglied. */
  isMember: z.boolean(),
});
export type ListInvite = z.infer<typeof listInviteSchema>;
