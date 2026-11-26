# Peakr – Bildmarke

<img src="peakr-logo.svg" height="48" alt="Peakr-Logo: Wegpunkt-Ring mit Gipfel und Wortmarke «peakr»">

**Wegpunkt-Ring mit Gipfel.** Ein offener Ring markiert den Wegpunkt – das Ziel, nach dem Peakr
sucht. Von unten durchbricht ihn eine Bergform, deren Spitze exakt im Mittelpunkt des Rings liegt:
Gipfel und Ziel sind derselbe Punkt.

## Konstruktion (48er-Raster)

- Ring: Mittelpunkt (24 | 22.75), Radius 17.4, Strichstärke 5.
- Gipfel: gleichseitiges Dreieck, Spitze im Ringmittelpunkt, Basis bei y 45.25.
- Ringenden parallel zu den Flanken geschnitten, Abstand 2.6 – der Ring läuft in die Bergform über.
- Reine Pfade, keine Masken, Verläufe oder Effekte. Einfarbig vollständig, weil Ring und Berg über
  Abstände getrennt sind, nicht über Farbe.

## Farben

| Name       | HEX       | Verwendung                           |
| ---------- | --------- | ------------------------------------ |
| Waldgrün   | `#173F35` | Ring, Wortmarke, App-Icon-Fläche     |
| Terrakotta | `#C66A4E` | Gipfel                               |
| Papier     | `#F5F1E8` | Ring und Wortmarke auf dunklem Grund |

In der App kommen die Farben aus den Tokens `--brand` (Ring, Wortmarke) und `--brand-accent` (Gipfel),
gesetzt in `apps/frontend/lib/theme.tsx`. Sie sind bewusst fest und folgen nicht der Akzentfarbe der
Farbwelt (Ski/Wandern).

## Dateien

| Datei                                          | Zweck                                                |
| ---------------------------------------------- | ---------------------------------------------------- |
| `peakr-mark.svg`                               | Bildmarke für helle Gründe                           |
| `peakr-mark-inverse.svg`                       | Bildmarke für dunkle Gründe                          |
| `peakr-mark-black.svg`, `peakr-mark-white.svg` | einfarbig                                            |
| `peakr-logo.svg`, `peakr-logo-inverse.svg`     | mit Wortmarke «peakr» (Spectral SemiBold als Kontur) |
| `peakr-app-icon.svg`                           | Master der App-Icons                                 |

Abgeleitet daraus (im Frontend):

- `apps/frontend/app/icon.svg` – Favicon (Kachel 32, Zeichen 84 % der Breite)
- `apps/frontend/app/favicon.ico` – 16/32/48 px, je eigens gerastert
- `apps/frontend/app/apple-icon.png`, `public/apple-touch-icon.png` – 180 px, randlos (iOS rundet selbst)
- `apps/frontend/public/icons/icon-192.png`, `icon-512.png` – Kachel mit Ecken 22.5 %
- `apps/frontend/public/icons/icon-maskable-512.png` – randlos, Zeichen innerhalb der Safe-Zone

In der Oberfläche rendert `BrandSymbol` / `Brandmark` (`components/PeakrChrome.tsx`) die Marke inline.

## Anwendung

- Mindestgrösse: 16 px (Favicon), mit Wortmarke 24 px Zeichenhöhe.
- Schutzraum rundum: mindestens die Strichstärke des Rings × 2.
- Nicht verzerren, nicht drehen, keine Schatten oder Verläufe, Farben nicht tauschen.
