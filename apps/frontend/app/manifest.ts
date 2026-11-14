import type { MetadataRoute } from 'next';

/**
 * Web-App-Manifest: Name und Icons für «Zum Home-Bildschirm» (Android/Chrome;
 * iOS nimmt das apple-touch-icon aus app/apple-icon.png). Peakr öffnet sich
 * vom Home-Bildschirm weiterhin im Browser.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Peakr – Ski- und Wanderziele der Schweiz',
    short_name: 'Peakr',
    description: 'Ski- und Wanderziele der Schweiz nach Fahrzeit, Verfügbarkeit und Bedingungen.',
    start_url: '/',
    display: 'browser',
    background_color: '#faf9f6',
    // Wie die Kopfzeile im hellen Modus – nicht die Akzentfarbe, sonst färbt iOS die
    // Statusleiste der Home-Bildschirm-App orange. Die Seite setzt theme-color je Modus.
    theme_color: '#f7fbfe',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
