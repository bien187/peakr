import { describe, expect, it } from 'vitest';
import { isSameObject, mergeCandidates, metadataQuality, type Candidate } from './destinations';

const c = (over: Partial<Candidate>): Candidate => ({
  kind: 'peak', name: 'Testgipfel', names: {}, altNames: [], lat: 46.8, lng: 8.5, elevation: 2000, objectClass: 'Gipfel',
  importance: 3, refs: [{ source: 'swissnames3d', ref: Math.random().toString() }], wikidata: null, wikipedia: null,
  extentM: null, official: true, ...over,
});

describe('Duplikaterkennung', () => {
  it('führt amtlichen Gipfel und gleichnamigen OSM-Gipfel in 80 m Abstand zusammen; amtlich bleibt führend', () => {
    const official = c({ name: 'Grosser Mythen', elevation: 1898 });
    const osm = c({ name: 'Grosser Mythen', lat: 46.8007, official: false, refs: [{ source: 'osm', ref: 'n1' }], wikidata: 'Q1', elevation: 1899 });
    const { merged, duplicates } = mergeCandidates([osm, official]);
    expect(duplicates).toBe(1);
    expect(merged).toHaveLength(1);
    expect(merged[0].elevation).toBe(1898);
    expect(merged[0].wikidata).toBe('Q1');
    expect(merged[0].refs.map((r) => r.source).sort()).toEqual(['osm', 'swissnames3d']);
  });

  it('benachbarte, verschieden benannte Gipfel bleiben getrennt', () => {
    const a = c({ name: 'Grosser Mythen', elevation: 1898 });
    const b = c({ name: 'Kleiner Mythen', lat: 46.806, elevation: 1811 });
    expect(isSameObject(a, b)).toBe(false);
  });

  it('gleicher Name, aber 3 km entfernt → zwei Ziele (z. B. mehrere «Stock»)', () => {
    const a = c({ name: 'Stock' });
    const b = c({ name: 'Stock', lat: 46.827 });
    expect(mergeCandidates([a, b]).merged).toHaveLength(2);
  });

  it('Aussichtspunkt auf gleichnamigem Gipfel geht im Gipfel auf', () => {
    const peak = c({ name: 'Rigi Kulm' });
    const view = c({ kind: 'viewpoint', name: 'Rigi Kulm', lat: 46.8003, official: false, refs: [{ source: 'osm', ref: 'n2' }] });
    const { merged } = mergeCandidates([view, peak]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('peak');
  });

  it('gleichnamiger OSM-Gipfel 250 m neben dem amtlichen Punkt mit gleicher Höhe ist dasselbe Objekt', () => {
    const a = c({ name: 'Lonzahörner', elevation: 3547 });
    const b = c({ name: 'Lonzahörner', lat: 46.80225, elevation: 3559, official: false, refs: [{ source: 'osm', ref: 'n3' }] });
    expect(isSameObject(a, b)).toBe(true);
  });

  it('gleicher Name, 200 m entfernt, aber 80 m Höhenunterschied → zwei Gipfel', () => {
    const a = c({ name: 'Huwetz', elevation: 2837 });
    const b = c({ name: 'Huwetz', lat: 46.8018, elevation: 2918 });
    expect(isSameObject(a, b)).toBe(false);
  });

  it('Gipfel und gleichnamige Hütte sind verschiedene Ziele', () => {
    expect(isSameObject(c({ name: 'Pizol' }), c({ kind: 'hut', name: 'Pizol' }))).toBe(false);
  });
});

describe('Metadaten-Qualität', () => {
  it('liegt zwischen 0 und 100 und belohnt vollständige Angaben', () => {
    const poor = metadataQuality(c({ elevation: null, official: false, refs: [{ source: 'osm', ref: 'x' }] }));
    const rich = metadataQuality(c({ wikidata: 'Q1', wikipedia: 'X', names: { de: 'a', fr: 'b' } }));
    expect(poor).toBeGreaterThanOrEqual(0);
    expect(rich).toBeLessThanOrEqual(100);
    expect(rich).toBeGreaterThan(poor);
  });
});
