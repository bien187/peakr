import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, JetBrains_Mono, Spectral } from 'next/font/google';
import { ThemeProvider } from '@/lib/theme';
// Reihenfolge wichtig: erst das komplette Design-System, dann nur die Font-Variablen.
import './peakr.css';
import './globals.css';

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
  title: 'Peakr',
  description:
    'Finde das beste Ski- oder Wanderziel der Schweiz nach Fahrzeit, Schnee, Lawinenlage und Bekanntheit. Privates Tool, 100% kostenlose Datenquellen.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="de"
      className={`${spectral.variable} ${hanken.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
