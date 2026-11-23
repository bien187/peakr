import {
  authResponseSchema,
  destinationDetailSchema,
  destinationWithStatusSchema,
  geocodeResponseSchema,
  healthResponseSchema,
  listDetailSchema,
  listInviteSchema,
  listSummarySchema,
  messageResponseSchema,
  publicUserSchema,
  searchInputSchema,
  searchResponseSchema,
  type LatLng,
  type LoginInput,
  type RegisterInput,
  type UpdateMeInput,
} from '@ch-alpineroute/shared';
import { z } from 'zod';
import { useAuthStore } from './store';

// Die API liegt in derselben Next.js-App (app/api/*) – immer gleiche Herkunft, kein CORS.
const BASE = '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // Content-Type nur mit Body: ein JSON-Header ohne Inhalt wird von manchen Servern abgelehnt.
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string } } | null)?.error;
    // Abgelaufene Anmeldung: Token verwerfen, damit die Oberfläche wieder «Anmelden» zeigt.
    if (res.status === 401 && token) useAuthStore.getState().logout();
    throw new ApiError(res.status, err?.message ?? `HTTP ${res.status}`, err?.code);
  }
  return schema.parse(data);
}

/** Eingabe der Suche; Felder mit Standardwert dürfen fehlen. */
export type SearchRequest = z.input<typeof searchInputSchema>;

export const api = {
  geocode: (q: string) => request(`/api/geocode?q=${encodeURIComponent(q)}`, geocodeResponseSchema),

  search: (body: SearchRequest, signal?: AbortSignal) =>
    request('/api/search', searchResponseSchema, { method: 'POST', body: JSON.stringify(body), signal }),

  register: (body: RegisterInput) =>
    request('/api/auth/register', authResponseSchema, { method: 'POST', body: JSON.stringify(body) }),

  login: (body: LoginInput) =>
    request('/api/auth/login', authResponseSchema, { method: 'POST', body: JSON.stringify(body) }),

  logout: () => request('/api/auth/logout', messageResponseSchema, { method: 'POST' }),

  me: () => request('/api/me', publicUserSchema),

  updateMe: (body: UpdateMeInput) =>
    request('/api/me', publicUserSchema, { method: 'PATCH', body: JSON.stringify(body) }),

  /** Mit Startort liefert die API zusätzlich die Autofahrzeit je Ausgangspunkt. */
  destination: (id: string, from?: LatLng | null, signal?: AbortSignal, plan?: { date: string; startHour: number } | null) => {
    const q = new URLSearchParams();
    if (from) q.set('from', `${from.lat.toFixed(5)},${from.lng.toFixed(5)}`);
    if (plan) {
      q.set('date', plan.date);
      q.set('start', String(plan.startHour));
    }
    const qs = q.toString();
    return request(`/api/destinations/${id}${qs ? `?${qs}` : ''}`, destinationDetailSchema, { signal });
  },

  favorites: () => request('/api/favorites', z.array(destinationWithStatusSchema)),

  addFavorite: (id: string) => request(`/api/favorites/${id}`, messageResponseSchema, { method: 'POST' }),

  removeFavorite: (id: string) => request(`/api/favorites/${id}`, messageResponseSchema, { method: 'DELETE' }),

  health: () => request('/api/health', healthResponseSchema),

  // Geteilte Listen
  lists: (destinationId?: string) =>
    request(`/api/lists${destinationId ? `?destination=${destinationId}` : ''}`, z.array(listSummarySchema)),

  createList: (name: string, destinationId?: string) =>
    request('/api/lists', listDetailSchema, { method: 'POST', body: JSON.stringify({ name, destinationId }) }),

  list: (id: string) => request(`/api/lists/${id}`, listDetailSchema),

  renameList: (id: string, name: string) =>
    request(`/api/lists/${id}`, listDetailSchema, { method: 'PATCH', body: JSON.stringify({ name }) }),

  /** Besitzer: löscht die Liste · Mitglied: verlässt sie. */
  deleteList: (id: string) => request(`/api/lists/${id}`, messageResponseSchema, { method: 'DELETE' }),

  addToList: (id: string, destinationId: string) =>
    request(`/api/lists/${id}/items`, messageResponseSchema, { method: 'POST', body: JSON.stringify({ destinationId }) }),

  removeFromList: (id: string, destinationId: string) =>
    request(`/api/lists/${id}/items/${destinationId}`, messageResponseSchema, { method: 'DELETE' }),

  listInvite: (token: string) => request(`/api/lists/join/${encodeURIComponent(token)}`, listInviteSchema),

  joinList: (token: string) =>
    request(`/api/lists/join/${encodeURIComponent(token)}`, z.object({ id: z.string().uuid() }), { method: 'POST' }),
};
