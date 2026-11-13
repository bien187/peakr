import { apiRadarImage, AppError, logger } from '@ch-alpineroute/backend/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Ein Radarbild (PNG, Web-Mercator) für die Wetterkarte. Ein veröffentlichtes
 * Radarbild ändert sich nicht mehr: das CDN darf es dauerhaft behalten, gerechnet
 * wird es nur beim ersten Abruf.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ stamp: string }> }): Promise<Response> {
  const { stamp } = await params;
  try {
    const png = await apiRadarImage(stamp);
    if (!png) return new Response('Radarbild nicht vorhanden', { status: 404, headers: { 'cache-control': 'public, s-maxage=60' } });
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400, s-maxage=31536000, immutable',
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.statusCode });
    logger.error({ error: err instanceof Error ? err.message : String(err), stamp }, 'Radarbild fehlgeschlagen');
    return new Response('Radarbild nicht verfügbar', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
