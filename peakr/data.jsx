/* Peakr — mock destination dataset (real Swiss places, plausible live data) */

const DESTINATIONS = [
  /* ---- Skigebiete ---- */
  {
    id: 'zermatt', name: 'Zermatt – Matterhorn ski paradise', type: 'ski', canton: 'VS',
    lat: 46.0207, lng: 7.7491, baseM: 1620, topM: 3883, fame: 96,
    snowTop: 212, snowBase: 64, fresh: 18, liftsOpen: 47, liftsTotal: 53,
    weather: 0, temp: -9, wind: 14, avalanche: 2, trendDir: 'up',
    wiki: 'Zermatt', blurb: 'Hochalpines Gletscherskigebiet am Matterhorn, schneesicher bis in den Frühsommer.',
  },
  {
    id: 'saas-fee', name: 'Saas-Fee', type: 'ski', canton: 'VS',
    lat: 46.1095, lng: 7.929, baseM: 1800, topM: 3600, fame: 78,
    snowTop: 184, snowBase: 71, fresh: 22, liftsOpen: 19, liftsTotal: 22,
    weather: 71, temp: -7, wind: 9, avalanche: 2, trendDir: 'up',
    wiki: 'Saas-Fee', blurb: 'Autofreies Gletscherdorf, umrahmt von dreizehn Viertausendern.',
  },
  {
    id: 'verbier', name: 'Verbier – 4 Vallées', type: 'ski', canton: 'VS',
    lat: 46.0961, lng: 7.2286, baseM: 1500, topM: 3330, fame: 84,
    snowTop: 156, snowBase: 48, fresh: 8, liftsOpen: 71, liftsTotal: 89,
    weather: 2, temp: -4, wind: 21, avalanche: 3, trendDir: 'flat',
    wiki: 'Verbier', blurb: 'Weitläufiges Freeride-Revier mit Anschluss an die vier Täler.',
  },
  {
    id: 'davos', name: 'Davos Klosters', type: 'ski', canton: 'GR',
    lat: 46.799, lng: 9.82, baseM: 1560, topM: 2844, fame: 81,
    snowTop: 132, snowBase: 55, fresh: 5, liftsOpen: 48, liftsTotal: 58,
    weather: 3, temp: -6, wind: 12, avalanche: 2, trendDir: 'flat',
    wiki: 'Davos', blurb: 'Sechs Bergbahngebiete rund um die höchstgelegene Stadt der Alpen.',
  },
  {
    id: 'laax', name: 'Flims Laax Falera', type: 'ski', canton: 'GR',
    lat: 46.808, lng: 9.258, baseM: 1100, topM: 3018, fame: 79,
    snowTop: 168, snowBase: 42, fresh: 12, liftsOpen: 26, liftsTotal: 28,
    weather: 0, temp: -5, wind: 8, avalanche: 2, trendDir: 'up',
    wiki: 'Laax', blurb: 'Park-Mekka der Freestyle-Szene mit der grössten Halfpipe der Welt.',
  },
  {
    id: 'st-moritz', name: 'St. Moritz – Corviglia', type: 'ski', canton: 'GR',
    lat: 46.4983, lng: 9.8389, baseM: 1822, topM: 3303, fame: 88,
    snowTop: 121, snowBase: 38, fresh: 3, liftsOpen: 22, liftsTotal: 24,
    weather: 0, temp: -8, wind: 16, avalanche: 1, trendDir: 'flat',
    wiki: 'St. Moritz', blurb: 'Mondäner Klassiker im Engadin mit über 300 Sonnentagen im Jahr.',
  },
  {
    id: 'engelberg', name: 'Engelberg – Titlis', type: 'ski', canton: 'OW',
    lat: 46.821, lng: 8.401, baseM: 1000, topM: 3028, fame: 74,
    snowTop: 198, snowBase: 31, fresh: 27, liftsOpen: 23, liftsTotal: 26,
    weather: 73, temp: -3, wind: 19, avalanche: 3, trendDir: 'up',
    wiki: 'Engelberg', blurb: 'Gletscherabfahrt vom Titlis mit legendärem Tiefschnee-Hang „Laub".',
  },
  {
    id: 'grindelwald', name: 'Grindelwald – First', type: 'ski', canton: 'BE',
    lat: 46.6242, lng: 8.0414, baseM: 1034, topM: 2486, fame: 82,
    snowTop: 96, snowBase: 28, fresh: 6, liftsOpen: 18, liftsTotal: 21,
    weather: 2, temp: -2, wind: 11, avalanche: 2, trendDir: 'up',
    wiki: 'Grindelwald', blurb: 'Pisten mit Logenblick auf Eiger, Mönch und Jungfrau.',
  },
  {
    id: 'andermatt', name: 'Andermatt – Sedrun', type: 'ski', canton: 'UR',
    lat: 46.636, lng: 8.594, baseM: 1444, topM: 2961, fame: 71,
    snowTop: 176, snowBase: 58, fresh: 15, liftsOpen: 31, liftsTotal: 33,
    weather: 71, temp: -6, wind: 24, avalanche: 3, trendDir: 'up',
    wiki: 'Andermatt', blurb: 'Schneeloch am Gotthard, neu vernetzt zur Region SkiArena.',
  },
  {
    id: 'arosa', name: 'Arosa Lenzerheide', type: 'ski', canton: 'GR',
    lat: 46.7833, lng: 9.68, baseM: 1230, topM: 2865, fame: 70,
    snowTop: 142, snowBase: 47, fresh: 9, liftsOpen: 41, liftsTotal: 43,
    weather: 1, temp: -5, wind: 10, avalanche: 2, trendDir: 'flat',
    wiki: 'Arosa', blurb: 'Zwei sonnenverwöhnte Täler, seit 2014 per Bahn verbunden.',
  },

  /* ---- Wanderziele ---- */
  {
    id: 'oeschinensee', name: 'Oeschinensee', type: 'hike', canton: 'BE',
    lat: 46.4992, lng: 7.7286, topM: 1578, sac: 'T2', kind: 'lake',
    fame: 86, ascent: 480, distance: 8.6, fresh: 0,
    weather: 0, temp: 14, wind: 6, trendDir: 'up',
    wiki: 'Oeschinensee', blurb: 'Türkiser Bergsee im UNESCO-Welterbe, umrahmt von Felswänden.',
  },
  {
    id: 'bachalpsee', name: 'Bachalpsee', type: 'hike', canton: 'BE',
    lat: 46.6667, lng: 8.027, topM: 2265, sac: 'T2', kind: 'lake',
    fame: 73, ascent: 200, distance: 6.0, fresh: 0,
    weather: 2, temp: 9, wind: 13, trendDir: 'up',
    wiki: 'Bachalpsee', blurb: 'Spiegelglatter See mit Schreckhorn-Panorama, ab First leicht erreichbar.',
  },
  {
    id: 'creux-du-van', name: 'Creux du Van', type: 'hike', canton: 'NE',
    lat: 46.9333, lng: 6.7333, topM: 1463, sac: 'T2', kind: 'viewpoint',
    fame: 68, ascent: 620, distance: 14.0, fresh: 0,
    weather: 3, temp: 12, wind: 18, trendDir: 'flat',
    wiki: 'Creux du Van', blurb: 'Hufeisenförmiges Felsamphitheater im Jura, oft über dem Nebelmeer.',
  },
  {
    id: 'aletsch', name: 'Aletschgletscher – Bettmerhorn', type: 'hike', canton: 'VS',
    lat: 46.4, lng: 8.05, topM: 2647, sac: 'T2', kind: 'viewpoint',
    fame: 80, ascent: 340, distance: 9.5, fresh: 0,
    weather: 0, temp: 7, wind: 15, trendDir: 'up',
    wiki: 'Aletschgletscher', blurb: 'Logenplatz über dem grössten Gletscher der Alpen, 23 km Eis.',
  },
  {
    id: 'saxer-luecke', name: 'Saxer Lücke', type: 'hike', canton: 'AI',
    lat: 47.2667, lng: 9.4333, topM: 1649, sac: 'T3', kind: 'peak',
    fame: 64, ascent: 780, distance: 11.2, fresh: 0,
    weather: 1, temp: 11, wind: 9, trendDir: 'flat',
    wiki: 'Saxer Lücke', blurb: 'Markanter Felseinschnitt im Alpstein mit Blick auf den Säntis.',
  },
  {
    id: 'lac-de-moiry', name: 'Lac de Moiry', type: 'hike', canton: 'VS',
    lat: 46.145, lng: 7.575, topM: 2249, sac: 'T2', kind: 'lake',
    fame: 58, ascent: 260, distance: 7.4, fresh: 0,
    weather: 2, temp: 8, wind: 12, trendDir: 'flat',
    wiki: 'Lac de Moiry', blurb: 'Leuchtend türkiser Stausee am Fuss des Moiry-Gletschers im Val d’Anniviers.',
  },
];

const HIKE_KINDS = [
  { value: 'any', label: 'Alle' },
  { value: 'peak', label: 'Gipfel' },
  { value: 'lake', label: 'Bergsee' },
  { value: 'hut', label: 'Hütte' },
  { value: 'viewpoint', label: 'Aussicht' },
];
const SAC = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

/* Build live, origin-relative search results. driveMin derives from air distance
 * so changing the start point actually re-orders things. score blends fame,
 * conditions and (for ski) snow/avalanche into a single 0–100. */
function buildResults(originPt, mode, maxMin, tolMin, hikeKind, maxSac) {
  const out = [];
  for (const d of DESTINATIONS) {
    if (d.type !== mode) continue;
    if (mode === 'hike' && hikeKind && hikeKind !== 'any' && d.kind !== hikeKind) continue;
    if (mode === 'hike' && maxSac && SAC.indexOf(d.sac) > SAC.indexOf(maxSac)) continue;

    const km = airKm(originPt, { lat: d.lat, lng: d.lng });
    const driveMin = Math.round(km * 0.95 + 14);

    let score = d.fame * 0.5;
    if (d.type === 'ski') {
      score += Math.min(28, (d.snowTop || 0) / 8);
      score += Math.min(10, (d.fresh || 0) / 2.5);
      score -= (d.avalanche - 1) * 4;
      if (d.weather <= 2) score += 6;
      const liftRatio = d.liftsOpen / d.liftsTotal;
      score += liftRatio * 8 - 4;
    } else {
      if (d.weather <= 2) score += 16; else if (d.weather <= 3) score += 8;
      score += Math.max(0, 14 - (d.ascent || 0) / 70);
      score -= Math.max(0, (d.wind - 12)) * 0.4;
    }
    score = Math.max(8, Math.min(99, Math.round(score)));

    const over = Math.max(0, driveMin - maxMin);
    const within = driveMin <= maxMin;
    const suggestion = !within && driveMin <= maxMin + tolMin;
    if (!within && !suggestion) continue;

    out.push({ ...d, km, driveMin, score, over, suggestion });
  }
  return out;
}

const SORTS = [
  { value: 'score', label: 'Score' },
  { value: 'drive', label: 'Fahrzeit' },
  { value: 'snow', label: 'Schnee' },
  { value: 'fame', label: 'Bekanntheit' },
];

function sortResults(list, sort) {
  const a = [...list];
  if (sort === 'drive') a.sort((x, y) => x.driveMin - y.driveMin);
  else if (sort === 'snow') a.sort((x, y) => (y.snowTop || 0) - (x.snowTop || 0));
  else if (sort === 'fame') a.sort((x, y) => y.fame - x.fame);
  else a.sort((x, y) => y.score - x.score);
  return a;
}

/* Deterministic 14-point history for the detail sparkline. */
function historyFor(d) {
  const base = d.type === 'ski' ? (d.snowTop || 100) : d.fame;
  const pts = [];
  let v = base * 0.78;
  for (let i = 0; i < 14; i++) {
    const seed = Math.sin((d.id.charCodeAt(0) + i * 2.7)) * 0.5 + 0.5;
    v += (seed - 0.42) * base * 0.06;
    v = Math.max(base * 0.55, Math.min(base * 1.12, v));
    pts.push(Math.round(v));
  }
  pts[13] = d.type === 'ski' ? d.snowTop : d.fame;
  return pts;
}

Object.assign(window, {
  DESTINATIONS, HIKE_KINDS, SAC, SORTS,
  buildResults, sortResults, historyFor,
});
