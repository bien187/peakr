'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Direction = 'paper' | 'glacier' | 'pine';

export const DIRECTIONS: { value: Direction; label: string; sub: string }[] = [
  { value: 'pine', label: 'Tannwald', sub: 'Helles Papier · Föhrengrün' },
  { value: 'paper', label: 'Alpine Paper', sub: 'Warmes Papier · Terrakotta' },
  { value: 'glacier', label: 'Gletscher', sub: 'Kühles Papier · Bergsee' },
];

interface ThemeState {
  direction: Direction;
  dark: boolean;
  setDirection: (d: Direction) => void;
  toggleDark: () => void;
  setDark: (v: boolean) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

const STORAGE_KEY = 'peakr-theme';

// Standard entspricht dem im Layout gesetzten <html>: Tannwald, dunkel.
const DEFAULTS: { direction: Direction; dark: boolean } = { direction: 'pine', dark: true };

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [direction, setDirectionState] = useState<Direction>(DEFAULTS.direction);
  const [dark, setDarkState] = useState<boolean>(DEFAULTS.dark);

  // Gespeicherte Wahl nach dem Mount übernehmen (vermeidet Hydration-Mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { direction?: Direction; dark?: boolean };
        if (saved.direction) setDirectionState(saved.direction);
        if (typeof saved.dark === 'boolean') setDarkState(saved.dark);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // <html>-Attribute + Persistenz synchron halten.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-direction', direction);
    root.classList.toggle('dark', dark);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ direction, dark }));
    } catch {
      /* ignore */
    }
  }, [direction, dark]);

  const setDirection = useCallback((d: Direction) => setDirectionState(d), []);
  const toggleDark = useCallback(() => setDarkState((v) => !v), []);
  const setDark = useCallback((v: boolean) => setDarkState(v), []);

  return (
    <ThemeContext.Provider value={{ direction, dark, setDirection, toggleDark, setDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme muss innerhalb von <ThemeProvider> verwendet werden.');
  return ctx;
}
