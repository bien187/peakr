import { apiRouteGpx, AppError, logger } from '@ch-alpineroute/backend/server';

/**
 * GPX-Datei einer Routenvariante als HTTP-Antwort.
 *  - Standard: für Download und swisstopo-Kartenviewer (map.geo.admin.ch). Der Viewer
 *    lädt sie direkt aus dem Browser: dafür HTTPS, CORS und eine HEAD-Antwort mit dem
 *    Inhaltstyp `application/gpx+xml` (er vergleicht den Wert wörtlich).
 *  - `swisstopoApp`: Format der swisstopo-App für deren Routen-Link swisstopo.app/u/….
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-expose-headers': 'content-type, content-disposition',
};

type Ctx = { params: Promise<{ id: string; rank: string }> };

export function gpxHandlers(opts: { swisstopoApp?: boolean } = {}) {
  async function GET(req: Request, { params }: Ctx): Promise<Response> {
    const { id, rank } = await params;
    try {
      const { fileName, xml } = await apiRouteGpx(id, rank, new URL(req.url).origin, opts);
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

  async function HEAD(req: Request, ctx: Ctx): Promise<Response> {
    const res = await GET(req, ctx);
    return new Response(null, { status: res.status, headers: res.headers });
  }

  function OPTIONS(): Response {
    return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
  }

  return { GET, HEAD, OPTIONS };
}
