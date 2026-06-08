import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Ampelfarben für Lawinen-Gefahrenstufen 1–5 (offizielles SLF-Schema)
        avalanche: {
          1: '#c8e676', // gering (gelb-grün)
          2: '#fff200', // mässig (gelb)
          3: '#ff9900', // erheblich (orange)
          4: '#ff0000', // gross (rot)
          5: '#a30000', // sehr gross (dunkelrot)
        },
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
