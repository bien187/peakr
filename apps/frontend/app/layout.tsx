import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/lib/theme';
// Schriften aus npm (Fontsource, SIL Open Font License) statt next/font/google:
// Der Build lädt damit nichts von Google Fonts nach – der Vercel-Build war beim
// Abruf der Schriftdateien abgebrochen. Jede Datei bringt alle Zeichenbereiche mit
// unicode-range mit; der Browser lädt nur die tatsächlich benötigten.
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/600.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
// Reihenfolge wichtig: erst das komplette Design-System, dann nur die Font-Variablen.
import './peakr.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Peakr',
  description:
    'Finde das beste Ski- oder Wanderziel der Schweiz nach Fahrzeit, Schnee, Lawinenlage und Bekanntheit. Privates Tool, 100% kostenlose Datenquellen.',
  // Name unter dem Icon auf dem iPhone-Home-Bildschirm (sonst der Seitentitel).
  // capable: false – vom Home-Bildschirm weiter im Browser öffnen (Next setzt sonst «capable»).
  appleWebApp: { title: 'Peakr', capable: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Statusleiste wie die Kopfzeile (hell); ThemeProvider passt sie an Modus und Farbwelt an.
  themeColor: '#f7fbfe',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
