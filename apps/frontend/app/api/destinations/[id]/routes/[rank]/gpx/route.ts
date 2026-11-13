import { apiRouteGpx, AppError, logger } from '@ch-alpineroute/backend/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GPX-Datei einer Routenvariante. Wird vom swisstopo-Kartenviewer (map.geo.admin.ch)
 * direkt aus dem Browser geladen: dafür HTTPS, CORS und eine HEAD-Antwort mit dem
 * Inhaltstyp `application/gpx+xml` (der Viewer vergleicht den Wert wörtlich).
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-expose-headers': 'content-type, content-disposition',
};

type Ctx = { params: Promise<{ id: string; rank: string }> };

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const { id, rank } = await params;
  try {
    const { fileName, xml } = await apiRouteGpx(id, rank, new URL(req.url).origin);
    return new Response(xml, {
      status: 200,
      headers: {
        'content-type': 'application/gpx+xml',
        'content-disposition': `attachment; filename="${fileName}"`,
        // Routen ändern sich höchstens mit dem wöchentlichen Datenaufbau.
        'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        ...CORS,
      },
    });
  } catch (err) {
    const known = err instanceof AppError;
    if (!known) logger.error({ error: err instanceof Error ? (err.stack ?? err.message) : String(err) }, 'GPX-Export fehlgeschlagen');
    return Response.json(
      { error: known ? { code: err.code, message: err.message } : { code: 'INTERNAL', message: 'Interner Serverfehler.' } },
      { status: known ? err.statusCode : 500, headers: { 'cache-control': 'no-store', ...CORS } },
    );
  }
}

export async function HEAD(req: Request, ctx: Ctx): Promise<Response> {
  const res = await GET(req, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
}
