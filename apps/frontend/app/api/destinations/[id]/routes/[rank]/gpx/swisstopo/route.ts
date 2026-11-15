import { gpxHandlers } from '@/lib/server/gpxRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GPX-Datei einer Routenvariante im Format der swisstopo-App – Ziel des Routen-Links
 * swisstopo.app/u/… («In Swisstopo öffnen» auf dem Handy): Trackpunkte mit
 * Routenpunkt-ID, Start, Orte am Weg und Ziel als Kontrollpunkte auf der Route.
 */
const h = gpxHandlers({ swisstopoApp: true });
export const GET = h.GET;
export const HEAD = h.HEAD;
export const OPTIONS = h.OPTIONS;
