import type { Config } from 'tailwindcss';

/**
 * Token-gesteuerte Tailwind-Farben: alle Werte zeigen auf CSS-Variablen, die in
 * globals.css je nach data-direction + .dark aufgelöst werden. Komponenten nutzen
 * also normale Utilities (bg-surface, text-ink-2, border-line …), das Theme
 * schaltet zentral um.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        paper: 'var(--paper)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
        },
        line: {
          DEFAULT: 'var(--line)',
          2: 'var(--line-2)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          2: 'var(--accent-2)',
          soft: 'var(--accent-soft)',
        },
        'on-accent': 'var(--on-accent)',
        // Ampelfarben für Lawinen-Gefahrenstufen 1–5 (offizielles SLF-Schema)
        avalanche: {
          1: '#5cab2e',
          2: '#ffcc00',
          3: '#ff8a00',
          4: '#e8392a',
          5: '#9b1414',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        pk: 'var(--shadow)',
        'pk-sm': 'var(--shadow-sm)',
      },
      borderRadius: {
        xl: '18px',
        '2xl': '24px',
      },
    },
  },
  plugins: [],
};

export default config;
