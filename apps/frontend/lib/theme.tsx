'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { oklchToHex } from './color';

export type Direction = 'paper' | 'glacier' | 'pine';
export type Mode = 'light' | 'dark';
export type Density = 'compact' | 'regular' | 'comfy';

export const DIRECTIONS: Record<
  Direction,
  { label: string; hue: number; ac: number; sub: string }
> = {
  paper: { label: 'Alpine Paper', hue: 42, ac: 0.115, sub: 'Warmes Papier · Terrakotta' },
  glacier: { label: 'Gletscher', hue: 236, ac: 0.095, sub: 'Kühles Papier · Bergsee' },
  pine: { label: 'Tannwald', hue: 158, ac: 0.085, sub: 'Helles Papier · Föhrengrün' },
};

/** Helligkeit/Buntheit (OKLCH) von Hintergrund und «Papier» (Kopfzeile, Panels) je Modus. */
const BG = { light: [0.962, 0.008], dark: [0.205, 0.012] } as const;
const PAPER = { light: [0.986, 0.006], dark: [0.235, 0.014] } as const;

/**
 * Farben für die Browser-Oberfläche: Statusleiste/Adressleiste (meta theme-color)
 * wie die Kopfzeile, Seitenhintergrund (sichtbar beim Überziehen) wie die App.
 */
export function chromeColors(dir: Direction, mode: Mode): { bar: string; page: string } {
  const H = (DIRECTIONS[dir] ?? DIRECTIONS.paper).hue;
  return { bar: oklchToHex(PAPER[mode][0], PAPER[mode][1], H), page: oklchToHex(BG[mode][0], BG[mode][1], H) };
}

export function themeVars(dir: Direction, mode: Mode): Record<string, string> {
  const { hue: H, ac } = DIRECTIONS[dir] ?? DIRECTIONS.paper;

  if (mode === 'dark') {
    return {
      '--bg': `oklch(${BG.dark[0]} ${BG.dark[1]} ${H})`,
      '--paper': `oklch(${PAPER.dark[0]} ${PAPER.dark[1]} ${H})`,
      '--surface': `oklch(0.262 0.016 ${H})`,
      '--surface-2': `oklch(0.305 0.018 ${H})`,
      '--ink': `oklch(0.945 0.008 ${H})`,
      '--ink-2': `oklch(0.760 0.012 ${H})`,
      '--ink-3': `oklch(0.600 0.012 ${H})`,
      '--line': `oklch(0.345 0.014 ${H})`,
      '--line-2': `oklch(0.420 0.016 ${H})`,
      '--accent': `oklch(0.700 ${ac} ${H})`,
      '--accent-2': `oklch(0.770 ${ac} ${H})`,
      '--accent-soft': `oklch(0.320 0.045 ${H})`,
      '--on-accent': `oklch(0.180 0.010 ${H})`,
      '--map-1': `oklch(0.255 0.018 ${H})`,
      '--map-2': `oklch(0.295 0.022 ${H})`,
      '--map-3': `oklch(0.235 0.016 ${H})`,
      '--map-water': `oklch(0.420 0.055 235)`,
      '--map-line': `oklch(0.380 0.014 ${H} / 0.55)`,
      '--shadow': '0 1px 2px rgba(0,0,0,.5), 0 8px 30px -10px rgba(0,0,0,.6)',
      '--shadow-sm': '0 1px 2px rgba(0,0,0,.45)',
      '--grain': '0.05',
    };
  }

  return {
    '--bg': `oklch(${BG.light[0]} ${BG.light[1]} ${H})`,
    '--paper': `oklch(${PAPER.light[0]} ${PAPER.light[1]} ${H})`,
    '--surface': `oklch(0.997 0.004 ${H})`,
    '--surface-2': `oklch(0.945 0.010 ${H})`,
    '--ink': `oklch(0.255 0.014 ${H})`,
    '--ink-2': `oklch(0.455 0.013 ${H})`,
    '--ink-3': `oklch(0.605 0.011 ${H})`,
    '--line': `oklch(0.905 0.009 ${H})`,
    '--line-2': `oklch(0.845 0.011 ${H})`,
    '--accent': `oklch(0.575 ${ac} ${H})`,
    '--accent-2': `oklch(0.495 ${ac} ${H})`,
    '--accent-soft': `oklch(0.945 0.038 ${H})`,
    '--on-accent': `oklch(0.992 0.008 ${H})`,
    '--map-1': `oklch(0.945 0.018 ${H})`,
    '--map-2': `oklch(0.915 0.028 ${H})`,
    '--map-3': `oklch(0.965 0.012 ${H})`,
    '--map-water': `oklch(0.840 0.055 235)`,
    '--map-line': `oklch(0.870 0.014 ${H} / 0.6)`,
    '--shadow': '0 1px 2px rgba(40,30,15,.06), 0 12px 34px -14px rgba(40,30,15,.22)',
    '--shadow-sm': '0 1px 2px rgba(40,30,15,.07)',
    '--grain': '0.05',
  };
}

export interface Settings {
  mode: Mode;
}

const DEFAULTS: Settings = {
  mode: 'light',
};

const STORAGE_KEY = 'peakr-settings';
const PARAMS_KEY = 'peakr-params';

function directionFromAppMode(appMode: 'ski' | 'hike'): Direction {
  return appMode === 'ski' ? 'glacier' : 'pine';
}

interface ThemeCtx {
  s: Settings;
  set: (patch: Partial<Settings>) => void;
  direction: Direction;
  setAppMode: (m: 'ski' | 'hike') => void;
}

// Default-App-Modus ist 'ski' (siehe DEFAULT_PARAMS) → glacier, damit Theme und
// Modus-Schalter beim Erstbesuch (ohne gespeicherte Parameter) übereinstimmen.
const DEFAULT_DIRECTION = directionFromAppMode('ski');

const Ctx = createContext<ThemeCtx>({
  s: DEFAULTS,
  set: () => {},
  direction: DEFAULT_DIRECTION,
  setAppMode: () => {},
});
export const useSettings = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [direction, setDirection] = useState<Direction>(DEFAULT_DIRECTION);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setS({ ...DEFAULTS, ...(JSON.parse(saved) as Partial<Settings>) });
    } catch { /* ignore */ }

    try {
      const params = JSON.parse(localStorage.getItem(PARAMS_KEY) || '{}') as { mode?: string };
      if (params.mode === 'ski' || params.mode === 'hike') {
        setDirection(directionFromAppMode(params.mode));
      }
    } catch { /* ignore */ }
  }, []);

  const set = (patch: Partial<Settings>) =>
    setS((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });

  const setAppMode = (m: 'ski' | 'hike') => setDirection(directionFromAppMode(m));

  // Statusleiste (iPhone, auch als Web-App vom Home-Bildschirm) und Seitenhintergrund
  // in den Farben der App: hell im hellen, dunkelgrau im dunklen Modus.
  useEffect(() => {
    const { bar, page } = chromeColors(direction, s.mode);
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    if (metas.length === 0) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = bar;
      document.head.appendChild(meta);
    }
    metas.forEach((m) => {
      m.content = bar;
      m.removeAttribute('media');
    });
    document.documentElement.style.backgroundColor = page;
  }, [direction, s.mode]);

  return (
    <Ctx.Provider value={{ s, set, direction, setAppMode }}>
      <div
        className="app"
        data-density="regular"
        data-labels="1"
        style={themeVars(direction, s.mode) as CSSProperties}
      >
        {children}
      </div>
    </Ctx.Provider>
  );
}
