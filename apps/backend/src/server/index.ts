/**
 * Server-API von Peakr – frei von jedem Web-Framework.
 *
 * Die Next.js-Routen in apps/frontend/app/api rufen ausschliesslich diese
 * Funktionen auf. Es gibt damit genau EINE Implementierung von Suche, Konto und
 * Favoriten; lokale Entwicklung und Produktion verhalten sich gleich.
 */
import {
  isInSwitzerland,
  latLngSchema,
  loginInputSchema,
  registerInputSchema,
  routeGpx,
  searchInputSchema,
  updateMeSchema,
  type AuthResponse,
  type DestinationDetail,
  type DestinationWithStatus,
  type GeocodeResult,
  type HealthResponse,
  type LatLng,
  type PublicUser,
  type SearchResponse,
} from '@ch-alpineroute/shared';
import { z } from 'zod';
import { AppError, validate } from '../lib/errors';
import { logger } from '../lib/logger';
import { getDestinationDetail } from '../repositories/destination.repo';
import { addFavorite, listFavorites, removeFavorite } from '../repositories/favorites.repo';
import { getPublicUser, updateProfile } from '../repositories/user.repo';
import { login, rateLimit, register, requireUser } from '../services/auth.service';
import { destinationDetail } from '../services/destination.service';
import { geocode } from '../services/geocode.service';
import { health } from '../services/health.service';
import { search } from '../services/search.service';

export { AppError } from '../lib/errors';
export { logger } from '../lib/logger';

/**
 * Rate-Limit für Anfragen, die ohne Datenbank funktionieren (Suche): ist die
 * Datenbank nicht erreichbar, wird die Anfrage zugelassen statt abgewiesen.
 */
async function rateLimitOrPass(scope: string, clientIp: string, limit: number, windowSeconds: number): Promise<void> {
  try {
    await rateLimit(scope, clientIp, limit, windowSeconds);
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ scope, error: err instanceof Error ? err.message : String(err) }, 'Rate-Limit nicht prüfbar – Anfrage zugelassen');
  }
}

const uuid = z.string().uuid();
const geocodeQuery = z.string().trim().min(2, 'Mindestens 2 Zeichen').max(120);

export async function apiSearch(body: unknown, clientIp: string): Promise<SearchResponse> {
  const input = validate(searchInputSchema, body);
  if (!isInSwitzerland(input.origin)) {
    throw new AppError(400, 'OUT_OF_BOUNDS', 'Der Startort liegt ausserhalb der Schweiz.');
  }
  await rateLimitOrPass('search', clientIp, 120, 60);
  return search(input);
}

/**
 * Detailansicht. `from` («lat,lng») ist optional: mit Startort wird je
 * Ausgangspunkt die Autofahrzeit ergänzt.
 */
export async function apiDestination(id: string, from?: string | null, clientIp = 'local'): Promise<DestinationDetail> {
  const destinationId = validate(uuid, id);
  let origin: LatLng | undefined;
  if (from) {
    const [lat, lng] = from.split(',').map(Number);
    const parsed = latLngSchema.safeParse({ lat, lng });
    if (parsed.success && isInSwitzerland(parsed.data)) {
      origin = parsed.data;
      await rateLimit('detail', clientIp, 120, 60);
    }
  }
  const detail = await destinationDetail(destinationId, origin);
  if (!detail) throw new AppError(404, 'NOT_FOUND', 'Ziel nicht gefunden.');
  return detail;
}

const routeRank = z.coerce.number().int().min(1).max(20);

/**
 * GPX-Datei einer Routenvariante. Dieselbe Erzeugung wie der Download im Browser;
 * die URL dient dem swisstopo-Kartenviewer, der die Route selbst laden muss.
 * `appOrigin` (z. B. https://peakr-ch.vercel.app) ergibt den Link zur Detailseite in den Metadaten.
 */
export async function apiRouteGpx(id: string, rank: string, appOrigin: string | null): Promise<{ fileName: string; xml: string }> {
  const destinationId = validate(uuid, id);
  const wanted = validate(routeRank, rank);
  const found = await getDestinationDetail(destinationId);
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Ziel nicht gefunden.');
  const { detail } = found;
  const route = detail.routes.find((r) => r.rank === wanted);
  if (!route) throw new AppError(404, 'NOT_FOUND', 'Für dieses Ziel gibt es diese Routenvariante nicht.');
  const gpx = routeGpx({
    destination: {
      name: detail.name, location: detail.location, elevationTopM: detail.elevationTopM,
      poiKind: detail.poiKind, objectClass: detail.objectClass,
    },
    route,
    variantCount: detail.routes.length,
    appUrl: appOrigin ? `${appOrigin}/destinations/${destinationId}` : null,
  });
  return { fileName: gpx.fileName, xml: gpx.xml };
}

export async function apiGeocode(q: string | null): Promise<{ results: GeocodeResult[] }> {
  return { results: await geocode(validate(geocodeQuery, q ?? '')) };
}

export async function apiRegister(body: unknown, clientIp: string): Promise<AuthResponse> {
  return register(validate(registerInputSchema, body), clientIp);
}

export async function apiLogin(body: unknown, clientIp: string): Promise<AuthResponse> {
  return login(validate(loginInputSchema, body), clientIp);
}

export async function apiMe(authorization: string | null): Promise<PublicUser> {
  const { sub } = await requireUser(authorization);
  const user = await getPublicUser(sub);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Benutzer nicht gefunden.');
  return user;
}

export async function apiUpdateMe(authorization: string | null, body: unknown): Promise<PublicUser> {
  const { sub } = await requireUser(authorization);
  await updateProfile(sub, validate(updateMeSchema, body));
  const user = await getPublicUser(sub);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Benutzer nicht gefunden.');
  return user;
}

export async function apiFavorites(authorization: string | null): Promise<DestinationWithStatus[]> {
  const { sub } = await requireUser(authorization);
  return listFavorites(sub);
}

export async function apiAddFavorite(authorization: string | null, destinationId: string): Promise<{ message: string }> {
  const { sub } = await requireUser(authorization);
  const ok = await addFavorite(sub, validate(uuid, destinationId));
  if (!ok) throw new AppError(404, 'NOT_FOUND', 'Ziel nicht gefunden.');
  return { message: 'Favorit hinzugefügt.' };
}

export async function apiRemoveFavorite(authorization: string | null, destinationId: string): Promise<{ message: string }> {
  const { sub } = await requireUser(authorization);
  await removeFavorite(sub, validate(uuid, destinationId));
  return { message: 'Favorit entfernt.' };
}

export async function apiHealth(): Promise<HealthResponse> {
  return health();
}
