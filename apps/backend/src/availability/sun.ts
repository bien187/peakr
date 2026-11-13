/**
 * Sonnenauf- und -untergang ohne externen Dienst (Sonnenstandsgleichung nach
 * NOAA/«sunrise equation», Genauigkeit rund eine Minute). Gelände, das die Sonne
 * früher verdeckt, ist nicht berücksichtigt.
 */
const RAD = Math.PI / 180;
const J2000 = 2451545.0;
/** Sonnenmittelpunkt 0,833° unter dem Horizont (Refraktion + Sonnenradius). */
const SUNSET_ALT = -0.833;
/** Bürgerliche Dämmerung: danach ist es ohne Lampe zu dunkel zum Wandern. */
const CIVIL_ALT = -6;

const toJulian = (ms: number): number => ms / 86_400_000 + 2440587.5;
const fromJulian = (j: number): Date => new Date((j - 2440587.5) * 86_400_000);

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  /** Ende der bürgerlichen Dämmerung. */
  dusk: Date | null;
  /** Beginn der bürgerlichen Dämmerung. */
  dawn: Date | null;
}

const cache = new Map<string, SunTimes>();

/**
 * `date` als YYYY-MM-DD (Kalendertag am Ort); `lng` östlich positiv. Auf 0,01°
 * (~1 km) gerundet zwischengespeichert – die Zeiten ändern sich dabei um Sekunden.
 */
export function sunTimes(date: string, lat: number, lng: number): SunTimes {
  const key = `${date}|${lat.toFixed(2)}|${lng.toFixed(2)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = computeSunTimes(date, lat, lng);
    if (cache.size > 50_000) cache.clear();
    cache.set(key, hit);
  }
  return hit;
}

function computeSunTimes(date: string, lat: number, lng: number): SunTimes {
  // Mittag UTC des Tages als Ausgangspunkt
  const n = Math.round(toJulian(Date.parse(`${date}T12:00:00Z`)) - J2000 + 0.0008);
  const jStar = n - lng / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));

  const at = (alt: number): [Date | null, Date | null] => {
    const cosH = (Math.sin(alt * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
    if (cosH < -1 || cosH > 1) return [null, null]; // Polartag/-nacht
    const h = Math.acos(cosH) / RAD;
    return [fromJulian(transit - h / 360), fromJulian(transit + h / 360)];
  };
  const [sunrise, sunset] = at(SUNSET_ALT);
  const [dawn, dusk] = at(CIVIL_ALT);
  return { sunrise, sunset, dawn, dusk };
}
