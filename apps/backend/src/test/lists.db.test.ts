/**
 * Geteilte Listen gegen die echte Datenbank (Migration 0005): Rechte von
 * Besitzerin und Mitgliedern, Einladungslink, keine E-Mail-Adressen nach aussen.
 * Legt eigene Testkonten und -ziele an und entfernt sie danach wieder.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryClient as sql } from '../db';
import {
  apiAddListItem,
  apiCreateList,
  apiDeleteList,
  apiJoinList,
  apiList,
  apiListInvite,
  apiLists,
  apiRemoveListItem,
  apiUpdateList,
} from '../server';
import { signToken } from '../services/auth.service';

const tag = randomUUID().slice(0, 8);
const users: Record<'anna' | 'ben' | 'cem', { id: string; auth: string }> = {} as never;
const dest: { a: string; b: string } = { a: '', b: '' };

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? 0;
  }
}

beforeAll(async () => {
  for (const [key, name] of [['anna', 'Anna'], ['ben', null], ['cem', 'Cem']] as const) {
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`${key}-${tag}@test.invalid`}, 'x', ${name}) RETURNING id
    `;
    users[key] = { id: u.id, auth: `Bearer ${await signToken({ sub: u.id, role: 'user' })}` };
  }
  const rows = await sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, lat, lng, retired_at)
    VALUES (${`Testgipfel A ${tag}`}, 'hike_destination', 46.98, 8.25, now()), (${`Testgipfel B ${tag}`}, 'hike_destination', 47.05, 8.48, now())
    RETURNING id
  `;
  dest.a = rows[0].id;
  dest.b = rows[1].id;
});

afterAll(async () => {
  await sql`DELETE FROM users WHERE email LIKE ${`%-${tag}@test.invalid`}`;
  await sql`DELETE FROM destinations WHERE id IN (${dest.a}, ${dest.b})`;
});

describe('Geteilte Listen', () => {
  it('Besitzerin, Einladung, Mitglieder und Rechte', async () => {
    const { anna, ben, cem } = users;
    const list = await apiCreateList(anna.auth, { name: '  Herbst  ', destinationId: dest.a }, 'test');
    expect(list).toMatchObject({ name: 'Herbst', role: 'owner', itemCount: 1, memberCount: 1 });
    expect(list.inviteToken).toHaveLength(24);
    expect(await status(apiCreateList(anna.auth, { name: '   ' }, 'test'))).toBe(400);

    const mine = await apiLists(anna.auth, dest.a);
    expect(mine.find((l) => l.id === list.id)).toMatchObject({ contains: true, preview: [`Testgipfel A ${tag}`] });
    expect((await apiLists(anna.auth, dest.b)).find((l) => l.id === list.id)?.contains).toBe(false);

    // Wer nicht Mitglied ist, sieht die Liste nicht.
    expect(await status(apiList(ben.auth, list.id))).toBe(404);
    expect(await status(apiAddListItem(ben.auth, list.id, { destinationId: dest.b }))).toBe(404);

    // Einladung: Vorschau ohne Anmeldung, ungültige Anmeldung wie anonym.
    expect(await apiListInvite(null, list.inviteToken, 'test')).toMatchObject({ name: 'Herbst', ownerName: 'Anna', isMember: false });
    expect((await apiListInvite('Bearer kaputt', list.inviteToken, 'test')).isMember).toBe(false);
    expect(await status(apiListInvite(null, 'x'.repeat(24), 'test'))).toBe(404);

    expect((await apiJoinList(ben.auth, list.inviteToken, 'test')).id).toBe(list.id);
    await apiJoinList(ben.auth, list.inviteToken, 'test');
    const asBen = await apiList(ben.auth, list.id);
    expect(asBen).toMatchObject({ role: 'member', memberCount: 2 });
    expect(asBen.members).toEqual([
      { name: 'Anna', role: 'owner', isMe: false },
      { name: null, role: 'member', isMe: true },
    ]);
    expect(JSON.stringify(asBen)).not.toContain('@test.invalid');

    // Mitglieder fügen hinzu und entfernen; doppelt bleibt einmal.
    await apiAddListItem(ben.auth, list.id, { destinationId: dest.b });
    await apiAddListItem(ben.auth, list.id, { destinationId: dest.b });
    const full = await apiList(anna.auth, list.id);
    expect(full.items.map((i) => [i.id, i.addedBy])).toEqual([[dest.b, null], [dest.a, 'Anna']]);
    await apiRemoveListItem(ben.auth, list.id, dest.a);
    expect((await apiList(anna.auth, list.id)).itemCount).toBe(1);

    // Nur die Besitzerin benennt um und löscht; Mitglieder verlassen.
    expect(await status(apiUpdateList(ben.auth, list.id, { name: 'Neu' }))).toBe(403);
    expect((await apiUpdateList(anna.auth, list.id, { name: 'Herbst 2026' })).name).toBe('Herbst 2026');
    await apiJoinList(cem.auth, list.inviteToken, 'test');
    expect((await apiDeleteList(cem.auth, list.id)).message).toBe('Liste verlassen.');
    expect(await status(apiList(cem.auth, list.id))).toBe(404);
    expect((await apiDeleteList(anna.auth, list.id)).message).toBe('Liste gelöscht.');
    expect(await status(apiList(ben.auth, list.id))).toBe(404);
    expect(await status(apiLists(null))).toBe(401);
  });
});
