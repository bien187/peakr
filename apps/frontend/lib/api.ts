import {
  authResponseSchema,
  destinationDetailSchema,
  destinationWithStatusSchema,
  geocodeResponseSchema,
  messageResponseSchema,
  publicUserSchema,
  searchResponseSchema,
  type LoginInput,
  type RegisterInput,
  type SearchInput,
  type UpdateMeInput,
} from '@ch-alpineroute/shared';
import { z } from 'zod';
import { useAuthStore } from './store';

// In production (Netlify) requests go to Next.js API routes on the same domain.
// In local dev, set NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 in .env to use the Hapi backend.
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

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
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(res.status, err?.message ?? `HTTP ${res.status}`, err?.code);
  }
  return schema.parse(data);
}

export const api = {
  geocode: (q: string) => request(`/api/geocode?q=${encodeURIComponent(q)}`, geocodeResponseSchema),

  search: (body: SearchInput) =>
    request('/api/search', searchResponseSchema, { method: 'POST', body: JSON.stringify(body) }),

  register: (body: RegisterInput) =>
    request('/api/auth/register', authResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: LoginInput) =>
    request('/api/auth/login', authResponseSchema, { method: 'POST', body: JSON.stringify(body) }),

  logout: () => request('/api/auth/logout', messageResponseSchema, { method: 'POST' }),

  me: () => request('/api/me', publicUserSchema),

  updateMe: (body: UpdateMeInput) =>
    request('/api/me', publicUserSchema, { method: 'PATCH', body: JSON.stringify(body) }),

  setOpenAiKey: (apiKey: string) =>
    request('/api/me/openai-key', messageResponseSchema, {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  destination: (id: string) => request(`/api/destinations/${id}`, destinationDetailSchema),

  favorites: () => request('/api/favorites', z.array(destinationWithStatusSchema)),

  addFavorite: (id: string) =>
    request(`/api/favorites/${id}`, messageResponseSchema, { method: 'POST' }),

  removeFavorite: (id: string) =>
    request(`/api/favorites/${id}`, messageResponseSchema, { method: 'DELETE' }),
};
