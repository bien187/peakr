import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CH-AlpineRoute — Ski- & Wander-Navigator Schweiz',
  description:
    'Finde das beste Ski- oder Wanderziel der Schweiz nach Fahrzeit, Schnee, Lawinenlage und Bekanntheit. Privates Tool, 100% kostenlose Datenquellen.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" className="dark">
      <body>{children}</body>
    </html>
  );
}
