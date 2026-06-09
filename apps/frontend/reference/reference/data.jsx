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

/* Real-ish parking / valley-station (start) and top / destination points per
 * place, so the 3D overview shows a route that begins at the actual car park or
 * lift base and ends at the marked summit / lake. */
const ROUTE_PTS = {
  /* ski: park = Parkhaus / Talstation, peak = Bergstation / Gipfel */
  'zermatt':     { park: { lat: 46.0235, lng: 7.7480, label: 'Parkhaus Zermatt' },   peak: { lat: 45.9760, lng: 7.7460, label: 'Trockener Steg' } },
  'saas-fee':    { park: { lat: 46.1090, lng: 7.9280, label: 'Parkhaus Saas-Fee' },  peak: { lat: 46.0830, lng: 7.9240, label: 'Mittelallalin' } },
  'verbier':     { park: { lat: 46.0961, lng: 7.2286, label: 'Talstation Médran' },  peak: { lat: 46.0930, lng: 7.2960, label: 'Mont-Fort' } },
  'davos':       { park: { lat: 46.7990, lng: 9.8200, label: 'Parsennbahn' },        peak: { lat: 46.8290, lng: 9.7960, label: 'Weissfluhgipfel' } },
  'laax':        { park: { lat: 46.8080, lng: 9.2580, label: 'Talstation Laax' },    peak: { lat: 46.8440, lng: 9.2470, label: 'Vorab' } },
  'st-moritz':   { park: { lat: 46.4983, lng: 9.8389, label: 'Signalbahn' },         peak: { lat: 46.4900, lng: 9.8050, label: 'Piz Nair' } },
  'engelberg':   { park: { lat: 46.8210, lng: 8.4010, label: 'Titlisbahn' },         peak: { lat: 46.7720, lng: 8.4360, label: 'Titlis' } },
  'grindelwald': { park: { lat: 46.6242, lng: 8.0414, label: 'Firstbahn' },          peak: { lat: 46.6580, lng: 8.0560, label: 'First' } },
  'andermatt':   { park: { lat: 46.6360, lng: 8.5940, label: 'Gütsch-Express' },     peak: { lat: 46.6010, lng: 8.6010, label: 'Gemsstock' } },
  'arosa':       { park: { lat: 46.7833, lng: 9.6800, label: 'Arosa Bahnhof' },      peak: { lat: 46.7960, lng: 9.6610, label: 'Weisshorn' } },
  /* hike: park = Wanderparkplatz / Trailhead, peak = Ziel */
  'oeschinensee':{ park: { lat: 46.4928, lng: 7.7000, label: 'P Kandersteg' },       peak: { lat: 46.4992, lng: 7.7286, label: 'Oeschinensee' } },
  'bachalpsee':  { park: { lat: 46.6580, lng: 8.0560, label: 'Bergstation First' },  peak: { lat: 46.6667, lng: 8.0270, label: 'Bachalpsee' } },
  'creux-du-van':{ park: { lat: 46.9230, lng: 6.7160, label: 'Ferme Robert' },       peak: { lat: 46.9333, lng: 6.7333, label: 'Creux du Van' } },
  'aletsch':     { park: { lat: 46.3920, lng: 8.0360, label: 'Bettmeralp' },         peak: { lat: 46.4000, lng: 8.0500, label: 'Bettmerhorn' } },
  'saxer-luecke':{ park: { lat: 47.2820, lng: 9.4180, label: 'P Brülisau' },         peak: { lat: 47.2667, lng: 9.4333, label: 'Saxer Lücke' } },
  'lac-de-moiry':{ park: { lat: 46.1380, lng: 7.5700, label: 'Barrage de Moiry' },   peak: { lat: 46.1450, lng: 7.5750, label: 'Lac de Moiry' } },
};

/* Build a plausible, deterministic trail/piste polyline between two points,
 * gently wobbling around the direct line so it reads like a real route. */
function routeGeo(d) {
  const r = ROUTE_PTS[d.id] || {
    park: { lat: d.lat - 0.009, lng: d.lng - 0.012, label: 'Parkplatz' },
    peak: { lat: d.lat, lng: d.lng, label: d.name.split(' – ')[0].split(' (')[0] },
  };
  const park = [r.park.lng, r.park.lat];
  const peak = [r.peak.lng, r.peak.lat];
  const seed = d.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const N = 16;
  const dx = peak[0] - park[0], dy = peak[1] - park[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len; /* unit perpendicular */
  const line = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const env = Math.sin(t * Math.PI);            /* zero at both ends */
    const wob = (Math.sin(seed + t * 6.3) * 0.6 + Math.sin(seed * 0.7 + t * 13) * 0.25);
    const off = env * wob * len * 0.16;
    line.push([park[0] + dx * t + px * off, park[1] + dy * t + py * off]);
  }
  return { park, peak, line, parkLabel: r.park.label, peakLabel: r.peak.label };
}

/* Deterministic 7-day forecast for the detail weather window (mock, plausible). */
const WX_CODES = [0, 1, 2, 3, 45, 51, 61, 71, 80, 95];
function forecastFor(d) {
  const seed = d.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const today = new Date();
  const base = d.temp;
  const out = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(today.getTime() + i * 86400000);
    const r1 = Math.abs(Math.sin(seed * 1.7 + i * 2.3));
    const r2 = Math.abs(Math.sin(seed * 0.9 + i * 1.1 + 1));
    const code = i === 0 ? d.weather : WX_CODES[Math.floor(r1 * WX_CODES.length) % WX_CODES.length];
    const tmax = Math.round(base + (r2 - 0.45) * 7 + (d.type === 'ski' ? 1 : 3));
    const tmin = Math.round(tmax - (3 + r1 * 6));
    const wind = Math.max(2, Math.round((d.wind || 10) * (0.55 + r2 * 0.95)));
    const pop = Math.round(code >= 45 ? 25 + r1 * 65 : r1 * 25);
    out.push({
      label: i === 0 ? 'Heute' : i === 1 ? 'Morgen' : names[dt.getDay()],
      date: `${dt.getDate()}.${dt.getMonth() + 1}.`, code, tmax, tmin, wind, pop,
    });
  }
  return out;
}

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
  DESTINATIONS, HIKE_KINDS, SAC, SORTS, ROUTE_PTS,
  buildResults, sortResults, historyFor, routeGeo, forecastFor,
});
