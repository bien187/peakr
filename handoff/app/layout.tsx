import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, JetBrains_Mono, Spectral } from 'next/font/google';
import { ThemeProvider } from '@/lib/theme';
import './globals.css';

// Ruhige Serif für Headlines, klare Grotesk für Text, Mono für technische Werte.
const spectral = Spectral({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-spectral',
  display: 'swap',
});
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-hanken',
  display: 'swap',
});
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Peakr — Ski- & Wander-Navigator Schweiz',
  description:
    'Finde das beste Ski- oder Wanderziel der Schweiz nach Fahrzeit, Schnee, Lawinenlage und Bekanntheit.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="de"
      // Standard: Tannwald-Richtung, dunkel. ThemeProvider liest danach die
      // gespeicherte Wahl aus localStorage und aktualisiert diese Attribute.
      className={`dark ${spectral.variable} ${hanken.variable} ${jetbrains.variable}`}
      data-direction="pine"
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
