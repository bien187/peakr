import { queryClient as sql } from '../../db';
import { fetchWarningRegions } from '../../services/slf.service';

/** Schritt «slf»: Warnregionen als Polygone speichern und Ziele per ST_Contains zuordnen. */
export async function importSlfRegions(): Promise<Record<string, unknown>> {
  const regions = await fetchWarningRegions();
  if (regions.length < 50) throw new Error(`SLF lieferte nur ${regions.length} Warnregionen – Abbruch.`);

  let failed = 0;
  for (const r of regions) {
    try {
      await sql`
        INSERT INTO avalanche_regions (id, name, geom, updated_at)
        VALUES (${r.id}, ${r.name}, ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(r.geometry)}), 4326))), now())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom, updated_at = now()
      `;
    } catch {
      failed++;
    }
  }
  const linked = await sql`
    UPDATE destinations d SET slf_region_id = r.id
    FROM avalanche_regions r
    WHERE d.retired_at IS NULL AND ST_Contains(r.geom, d.geom) AND d.slf_region_id IS DISTINCT FROM r.id
  `;
  return { regions: regions.length - failed, failed, destinationsLinked: linked.count, partial: failed > 0 };
}
