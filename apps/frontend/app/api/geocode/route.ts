import { err, ok } from '@/lib/server/response';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  if (q.length < 2) return err(400, 'VALIDATION', 'Mindestens 2 Zeichen');

  try {
    const params = new URLSearchParams({ searchText: q, type: 'locations', sr: '4326', limit: '8' });
    const res = await fetch(`https://api3.geo.admin.ch/rest/services/api/SearchServer?${params}`);
    const data = await res.json() as { results?: { attrs: { label?: string; lat?: number; lon?: number; detail?: string } }[] };

    const results = (data.results ?? []).map(({ attrs }) => {
      const label = (attrs.label ?? '').replace(/<[^>]*>/g, '').trim();
      const canton = label.match(/\(([A-Z]{2})\)\s*$/)?.[1] ?? null;
      return { label, lat: Number(attrs.lat), lng: Number(attrs.lon), canton, detail: attrs.detail ?? null };
    }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));

    return ok({ results });
  } catch (e) {
    console.error(e);
    return err(500, 'INTERNAL', 'Geocoding fehlgeschlagen.');
  }
}
