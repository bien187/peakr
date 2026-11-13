import {
  authResponseSchema,
  destinationDetailSchema,
  destinationWithStatusSchema,
  geocodeResponseSchema,
  healthResponseSchema,
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
  destination: (id: string, from?: LatLng | null, signal?: AbortSignal) =>
    request(
      `/api/destinations/${id}${from ? `?from=${from.lat.toFixed(5)},${from.lng.toFixed(5)}` : ''}`,
      destinationDetailSchema,
      { signal },
    ),

  favorites: () => request('/api/favorites', z.array(destinationWithStatusSchema)),

  addFavorite: (id: string) => request(`/api/favorites/${id}`, messageResponseSchema, { method: 'POST' }),

  removeFavorite: (id: string) => request(`/api/favorites/${id}`, messageResponseSchema, { method: 'DELETE' }),

  health: () => request('/api/health', healthResponseSchema),
};
