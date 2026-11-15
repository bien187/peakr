import { gpxHandlers } from '@/lib/server/gpxRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GPX-Datei einer Routenvariante (Download, swisstopo-Kartenviewer). */
const h = gpxHandlers();
export const GET = h.GET;
export const HEAD = h.HEAD;
export const OPTIONS = h.OPTIONS;
