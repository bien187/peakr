/* ============================================================
 * Peakr — Theme-Engine (portiert aus dem Prototyp, core.jsx)
 * 3 Design-Richtungen × Hell/Dunkel. Liefert die CSS-Variablen
 * als Objekt — als inline style auf einen Wrapper setzen, ODER
 * per ThemeProvider auf <html>/<body> schreiben.
 * Zusätzlich: density (compact|regular|comfy) als data-Attribut.
 * ============================================================ */

export type Direction = 'paper' | 'glacier' | 'pine';
export type Mode = 'light' | 'dark';
export type Density = 'compact' | 'regular' | 'comfy';

export const DIRECTIONS: Record<Direction, { label: string; hue: number; ac: number; sub: string }> = {
  paper:   { label: 'Alpine Paper', hue: 42,  ac: 0.115, sub: 'Warmes Papier · Terrakotta' },
  glacier: { label: 'Gletscher',    hue: 236, ac: 0.095, sub: 'Kühles Papier · Bergsee' },
  pine:    { label: 'Tannwald',     hue: 158, ac: 0.085, sub: 'Helles Papier · Föhrengrün' },
};

/** Liefert die CSS-Custom-Properties für eine Richtung + Modus.
 *  Beispiel: style={themeVars('pine','light')} auf das App-Root. */
export function themeVars(dir: Direction, mode: Mode): Record<string, string> {
  const { hue: H, ac } = DIRECTIONS[dir] ?? DIRECTIONS.paper;

  if (mode === 'dark') {
    return {
      '--bg':          `oklch(0.205 0.012 ${H})`,
      '--paper':       `oklch(0.235 0.014 ${H})`,
      '--surface':     `oklch(0.262 0.016 ${H})`,
      '--surface-2':   `oklch(0.305 0.018 ${H})`,
      '--ink':         `oklch(0.945 0.008 ${H})`,
      '--ink-2':       `oklch(0.760 0.012 ${H})`,
      '--ink-3':       `oklch(0.600 0.012 ${H})`,
      '--line':        `oklch(0.345 0.014 ${H})`,
      '--line-2':      `oklch(0.420 0.016 ${H})`,
      '--accent':      `oklch(0.700 ${ac} ${H})`,
      '--accent-2':    `oklch(0.770 ${ac} ${H})`,
      '--accent-soft': `oklch(0.320 0.045 ${H})`,
      '--on-accent':   `oklch(0.180 0.010 ${H})`,
      '--map-1':       `oklch(0.255 0.018 ${H})`,
      '--map-2':       `oklch(0.295 0.022 ${H})`,
      '--map-3':       `oklch(0.235 0.016 ${H})`,
      '--map-water':   `oklch(0.420 0.055 235)`,
      '--map-line':    `oklch(0.380 0.014 ${H} / 0.55)`,
      '--shadow':      '0 1px 2px rgba(0,0,0,.5), 0 8px 30px -10px rgba(0,0,0,.6)',
      '--shadow-sm':   '0 1px 2px rgba(0,0,0,.45)',
      '--grain':       '0.05',
    };
  }

  return {
    '--bg':          `oklch(0.962 0.008 ${H})`,
    '--paper':       `oklch(0.986 0.006 ${H})`,
    '--surface':     `oklch(0.997 0.004 ${H})`,
    '--surface-2':   `oklch(0.945 0.010 ${H})`,
    '--ink':         `oklch(0.255 0.014 ${H})`,
    '--ink-2':       `oklch(0.455 0.013 ${H})`,
    '--ink-3':       `oklch(0.605 0.011 ${H})`,
    '--line':        `oklch(0.905 0.009 ${H})`,
    '--line-2':      `oklch(0.845 0.011 ${H})`,
    '--accent':      `oklch(0.575 ${ac} ${H})`,
    '--accent-2':    `oklch(0.495 ${ac} ${H})`,
    '--accent-soft': `oklch(0.945 0.038 ${H})`,
    '--on-accent':   `oklch(0.992 0.008 ${H})`,
    '--map-1':       `oklch(0.945 0.018 ${H})`,
    '--map-2':       `oklch(0.915 0.028 ${H})`,
    '--map-3':       `oklch(0.965 0.012 ${H})`,
    '--map-water':   `oklch(0.840 0.055 235)`,
    '--map-line':    `oklch(0.870 0.014 ${H} / 0.6)`,
    '--shadow':      '0 1px 2px rgba(40,30,15,.06), 0 12px 34px -14px rgba(40,30,15,.22)',
    '--shadow-sm':   '0 1px 2px rgba(40,30,15,.07)',
    '--grain':       '0.05',
  };
}

/* --------------------------------------------------------------------------
 * Optionaler React-Provider (Next.js Client Component).
 * Persistiert Einstellungen in localStorage und setzt die Variablen +
 * data-density auf ein Wrapper-<div className="app">.
 * ------------------------------------------------------------------------ */
/*
'use client';
import { createContext, useContext, useEffect, useState } from 'react';

type Settings = { direction: Direction; mode: Mode; density: Density; alwaysLabels: boolean };
const DEFAULTS: Settings = { direction: 'pine', mode: 'light', density: 'regular', alwaysLabels: true };
const Ctx = createContext<{ s: Settings; set: (p: Partial<Settings>) => void }>({ s: DEFAULTS, set: () => {} });
export const useSettings = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => {
    try { const r = localStorage.getItem('peakr-settings'); if (r) setS({ ...DEFAULTS, ...JSON.parse(r) }); } catch {}
  }, []);
  const set = (p: Partial<Settings>) => setS(prev => {
    const next = { ...prev, ...p };
    try { localStorage.setItem('peakr-settings', JSON.stringify(next)); } catch {}
    return next;
  });
  return (
    <Ctx.Provider value={{ s, set }}>
      <div className="app" data-density={s.density} data-labels={s.alwaysLabels ? '1' : '0'}
           style={themeVars(s.direction, s.mode) as React.CSSProperties}>
        {children}
      </div>
    </Ctx.Provider>
  );
}
*/
