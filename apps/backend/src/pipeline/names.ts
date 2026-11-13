/** Namensvergleich für die Duplikaterkennung. */

/** Kleinschreibung, ohne Akzente/Umlaut-Varianten, ohne Satzzeichen und Füllwörter. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/\b(sac|cas|cai|capanna|cabane|refuge|rifugio|chamanna|camona|berghaus|berggasthaus|bergrestaurant|restaurant|gasthaus|alphutte|bivouac|bivacco|biwak)\b/g, ' ')
    // «Vermigelhütte» = «Vermigel Hütte»: Gattungswort auch angehängt entfernen.
    .replace(/(hutte|hutten|hutta)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Ähnlichkeit zweier Namen, 0–1. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length === 0 || y.length === 0) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // «Piz Bernina» ⊂ «Piz Bernina / Pizzo Bernina»: ganze Wörter müssen enthalten sein.
  if (short.length >= 4 && (` ${long} `).includes(` ${short} `)) return 0.9;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** Beste Ähnlichkeit über alle Namensvarianten beider Seiten. */
export function bestNameSimilarity(a: string[], b: string[]): number {
  let best = 0;
  for (const x of a) for (const y of b) best = Math.max(best, nameSimilarity(x, y));
  return best;
}
