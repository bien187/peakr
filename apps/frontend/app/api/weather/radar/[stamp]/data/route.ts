import { apiRadarData, AppError, logger } from '@ch-alpineroute/backend/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Radar-Datenbild: Graustufen-PNG mit der Niederschlagsintensität je Pixel
 * (Byte 0 = trocken, 1–255 = 0,1–100 mm/h logarithmisch). Der Browser färbt,
 * zeichnet weich und überblendet die Bilder. Ein Radarbild ändert sich nicht
 * mehr – das CDN darf es dauerhaft behalten.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ stamp: string }> }): Promise<Response> {
  const { stamp } = await params;
  try {
    const png = await apiRadarData(stamp);
    if (!png) return new Response('Radarbild nicht vorhanden', { status: 404, headers: { 'cache-control': 'public, s-maxage=60' } });
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400, s-maxage=31536000, immutable' },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.statusCode });
    logger.error({ error: err instanceof Error ? err.message : String(err), stamp }, 'Radar-Datenbild fehlgeschlagen');
    return new Response('Radarbild nicht verfügbar', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
