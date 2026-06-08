/* Peakr — core: icons, theme tokens, helpers, mock data */

/* ---------------------------------------------------------------------------
 * Icon — builds an SVG from Lucide's icon-node data (no hand-drawn paths).
 * ------------------------------------------------------------------------- */
function renderIconNode(node, key) {
  if (!Array.isArray(node) || typeof node[0] !== 'string') return null;
  const [tag, attrs, children] = node;
  const kids = Array.isArray(children) ? children.map((c, i) => renderIconNode(c, i)) : null;
  return React.createElement(tag, { key, ...(attrs && typeof attrs === 'object' ? attrs : {}) }, kids);
}

/* Returns the list of leaf shape nodes for an icon, tolerating both shapes
 * Lucide ships: an array of [tag,attrs] tuples, or a single ['svg',attrs,children]. */
function iconChildren(entry) {
  if (!Array.isArray(entry) || entry.length === 0) return [];
  if (typeof entry[0] === 'string') {
    return Array.isArray(entry[2]) ? entry[2] : [entry];
  }
  return entry;
}

function Icon({ name, size = 20, stroke = 1.75, className, style }) {
  const lib = (typeof window !== 'undefined' && window.lucide && window.lucide.icons) || {};
  const entry = lib[name];
  const kids = iconChildren(entry);
  return React.createElement(
    'svg',
    {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round',
      strokeLinejoin: 'round', className, style, 'aria-hidden': true,
    },
    kids.map((c, i) => renderIconNode(c, i)),
  );
}

/* ---------------------------------------------------------------------------
 * Theme — three directions × light/dark, expressed as CSS custom properties.
 * Neutrals are tinted very slightly toward each direction's accent hue so the
 * whole surface shifts character, not just the accent.
 * ------------------------------------------------------------------------- */
const DIRECTIONS = {
  paper:   { label: 'Alpine Paper', hue: 42,  ac: 0.115, sub: 'Warmes Papier · Terrakotta' },
  glacier: { label: 'Gletscher',    hue: 236, ac: 0.095, sub: 'Kühles Papier · Bergsee' },
  pine:    { label: 'Tannwald',     hue: 158, ac: 0.085, sub: 'Helles Papier · Föhrengrün' },
};

function themeVars(dir, mode) {
  const { hue: H, ac } = DIRECTIONS[dir] || DIRECTIONS.paper;
  if (mode === 'dark') {
    return {
      '--bg':        `oklch(0.205 0.012 ${H})`,
      '--paper':     `oklch(0.235 0.014 ${H})`,
      '--surface':   `oklch(0.262 0.016 ${H})`,
      '--surface-2': `oklch(0.305 0.018 ${H})`,
      '--ink':       `oklch(0.945 0.008 ${H})`,
      '--ink-2':     `oklch(0.760 0.012 ${H})`,
      '--ink-3':     `oklch(0.600 0.012 ${H})`,
      '--line':      `oklch(0.345 0.014 ${H})`,
      '--line-2':    `oklch(0.420 0.016 ${H})`,
      '--accent':    `oklch(0.700 ${ac} ${H})`,
      '--accent-2':  `oklch(0.770 ${ac} ${H})`,
      '--accent-soft':`oklch(0.320 0.045 ${H})`,
      '--on-accent': `oklch(0.180 0.010 ${H})`,
      '--map-1':     `oklch(0.255 0.018 ${H})`,
      '--map-2':     `oklch(0.295 0.022 ${H})`,
      '--map-3':     `oklch(0.235 0.016 ${H})`,
      '--map-water': `oklch(0.420 0.055 235)`,
      '--map-line':  `oklch(0.380 0.014 ${H} / 0.55)`,
      '--shadow':    '0 1px 2px rgba(0,0,0,.5), 0 8px 30px -10px rgba(0,0,0,.6)',
      '--shadow-sm': '0 1px 2px rgba(0,0,0,.45)',
      '--grain':     '0.04',
    };
  }
  return {
    '--bg':        `oklch(0.962 0.008 ${H})`,
    '--paper':     `oklch(0.986 0.006 ${H})`,
    '--surface':   `oklch(0.997 0.004 ${H})`,
    '--surface-2': `oklch(0.945 0.010 ${H})`,
    '--ink':       `oklch(0.255 0.014 ${H})`,
    '--ink-2':     `oklch(0.455 0.013 ${H})`,
    '--ink-3':     `oklch(0.605 0.011 ${H})`,
    '--line':      `oklch(0.905 0.009 ${H})`,
    '--line-2':    `oklch(0.845 0.011 ${H})`,
    '--accent':    `oklch(0.575 ${ac} ${H})`,
    '--accent-2':  `oklch(0.495 ${ac} ${H})`,
    '--accent-soft':`oklch(0.945 0.038 ${H})`,
    '--on-accent': `oklch(0.992 0.008 ${H})`,
    '--map-1':     `oklch(0.945 0.018 ${H})`,
    '--map-2':     `oklch(0.915 0.028 ${H})`,
    '--map-3':     `oklch(0.965 0.012 ${H})`,
    '--map-water': `oklch(0.840 0.055 235)`,
    '--map-line':  `oklch(0.870 0.014 ${H} / 0.6)`,
    '--shadow':    '0 1px 2px rgba(40,30,15,.06), 0 12px 34px -14px rgba(40,30,15,.22)',
    '--shadow-sm': '0 1px 2px rgba(40,30,15,.07)',
    '--grain':     '0.05',
  };
}

/* Score → harmonised semantic colour (0–100). */
function scoreColor(s) {
  if (s >= 80) return 'oklch(0.62 0.12 150)';
  if (s >= 65) return 'oklch(0.66 0.12 128)';
  if (s >= 50) return 'oklch(0.72 0.13 92)';
  if (s >= 35) return 'oklch(0.68 0.14 55)';
  return 'oklch(0.60 0.16 28)';
}
function scoreLabel(s) {
  if (s >= 80) return 'top';
  if (s >= 65) return 'sehr gut';
  if (s >= 50) return 'gut';
  if (s >= 35) return 'mässig';
  return 'schwach';
}

/* Official SLF avalanche palette — kept accurate for recognition/safety. */
const AVALANCHE = {
  1: { label: 'gering',     color: '#5cab2e', text: '#fff' },
  2: { label: 'mässig',     color: '#ffcc00', text: '#1a1a1a' },
  3: { label: 'erheblich',  color: '#ff8a00', text: '#1a1a1a' },
  4: { label: 'gross',      color: '#e8392a', text: '#fff' },
  5: { label: 'sehr gross', color: '#9b1414', text: '#fff' },
};

/* WMO weather code → Lucide icon name + German label (no emoji). */
function weatherInfo(code) {
  if (code == null) return { icon: 'CircleHelp', label: 'unbekannt' };
  if (code === 0) return { icon: 'Sun', label: 'Klar' };
  if (code <= 2) return { icon: 'CloudSun', label: 'Heiter' };
  if (code === 3) return { icon: 'Cloud', label: 'Bewölkt' };
  if (code <= 48) return { icon: 'CloudFog', label: 'Nebel' };
  if (code <= 57) return { icon: 'CloudDrizzle', label: 'Niesel' };
  if (code <= 67) return { icon: 'CloudRain', label: 'Regen' };
  if (code <= 77) return { icon: 'CloudSnow', label: 'Schneefall' };
  if (code <= 82) return { icon: 'CloudRain', label: 'Schauer' };
  if (code <= 86) return { icon: 'Snowflake', label: 'Schneeschauer' };
  return { icon: 'CloudLightning', label: 'Gewitter' };
}

function fmtDrive(min) {
  const t = Math.round(min);
  const h = Math.floor(t / 60), m = t % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/* Haversine distance (km). */
function airKm(a, b) {
  const R = 6371, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/* Swiss bounding box → map percentage. */
const BOX = { w: 5.9, e: 10.5, n: 47.85, s: 45.78 };
const mapX = (lng) => ((lng - BOX.w) / (BOX.e - BOX.w)) * 100;
const mapY = (lat) => ((BOX.n - lat) / (BOX.n - BOX.s)) * 100;

const ORIGINS = [
  { id: 'bern',   label: 'Bern',           lat: 46.948, lng: 7.447 },
  { id: 'zurich', label: 'Zürich',         lat: 47.377, lng: 8.540 },
  { id: 'geneve', label: 'Genève',         lat: 46.204, lng: 6.143 },
  { id: 'basel',  label: 'Basel',          lat: 47.560, lng: 7.588 },
  { id: 'luzern', label: 'Luzern',         lat: 47.050, lng: 8.307 },
  { id: 'lugano', label: 'Lugano',         lat: 46.005, lng: 8.951 },
];

const LAKES = [
  { name: 'Genfersee',  lng: 6.55, lat: 46.45, w: 13, h: 4.5, r: -18 },
  { name: 'Bodensee',   lng: 9.35, lat: 47.55, w: 11, h: 4,   r: -8 },
  { name: 'Vierwaldst.',lng: 8.45, lat: 47.00, w: 6,  h: 3.5, r: 20 },
  { name: 'Zürichsee',  lng: 8.72, lat: 47.22, w: 6,  h: 2.6, r: -32 },
  { name: 'Neuenburg.', lng: 6.90, lat: 46.92, w: 7,  h: 3,   r: -34 },
  { name: 'Lago Magg.', lng: 8.78, lat: 46.10, w: 3.5,h: 6,   r: 6 },
];

Object.assign(window, {
  Icon, DIRECTIONS, themeVars, scoreColor, scoreLabel, AVALANCHE,
  weatherInfo, fmtDrive, airKm, mapX, mapY, ORIGINS, LAKES,
});
