# Handoff: Peakr-Webapp **1:1** in Next.js nachbauen (komplett)

> **An Claude Code:** Baue die **gesamte** Peakr-Webapp aus dem Prototyp `reference/`
> **1:1** in `apps/frontend` nach — **gleiches Aussehen UND gleiche Funktionen**.
> Das umfasst ausdrücklich das **Theme-System**:
> - **3 Design-Richtungen**: Paper · Gletscher · Tannwald (Standard = **Tannwald/pine**)
> - **Hell- und Dunkelmodus** (Toggle in der Topbar, Sonne/Mond-Icon)
> - **Dichte**: kompakt · regulär · komfortabel
> - **Kartenlabels beim Zoomen** an/aus
>
> Alle Einstellungen sind **live umschaltbar** und werden in `localStorage`
> gespeichert. Nicht ans bestehende dunkle Slate-Theme anpassen — das alte Design
> wird **ersetzt**. Bestehende Logik/API/Auth bleibt, nur die UI wird der Prototyp.

---

## So funktioniert das Theme im Prototyp (wichtig)
Die Farben sind **nicht** fest, sondern werden aus zwei Achsen erzeugt:
`themeVars(direction, mode)` nimmt pro Richtung einen **Farbton (hue)** und eine
**Akzent-Sättigung (chroma)** und liefert daraus alle CSS-Variablen (`--bg`, `--ink`,
`--accent`, `--surface`, `--map-*` …) — getrennt für hell/dunkel. Die Variablen
werden als `style` auf das Wurzel-`<div className="app">` gesetzt; `styles.css`
nutzt nur diese Variablen. So verändert ein Richtungs- oder Modus-Wechsel die
**ganze Oberfläche** auf einen Schlag.

→ **Fertig portiert:** `reference/peakr-theme.ts` enthält `DIRECTIONS` und
`themeVars()` als TypeScript **plus** einen auskommentierten `ThemeProvider`
(Client Component, localStorage-Persistenz). Das ist das Herzstück — übernehmen.

---

## Einrichtung (Reihenfolge)

### 1. Fonts
Drei Google Fonts in `apps/frontend/app/layout.tsx` laden:
```tsx
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

### 2. Globales Stylesheet
`reference/styles.css` → `apps/frontend/app/peakr.css` kopieren und in `layout.tsx`
importieren (**vor** `globals.css`). In `globals.css` alle Regeln entfernen, die
Hintergrund/Farbe/Body überschreiben — die Optik kommt komplett aus `peakr.css`.
> `styles.css` definiert **keine** Farbwerte direkt, nur `var(--…)`. Die Werte
> liefert der ThemeProvider zur Laufzeit (Schritt 3). Verlass dich also nicht auf
> `peakr-tokens.css` für die fertige App — die ist nur ein statischer Fallback für
> eine einzelne Richtung. **Für alle 3 Richtungen + Dark Mode → ThemeProvider.**

### 3. ThemeProvider einbauen
`reference/peakr-theme.ts` → `apps/frontend/lib/theme.ts` (o. `app/theme.tsx`).
Den auskommentierten `ThemeProvider`/`useSettings` aktivieren und in
`app/layout.tsx` um `{children}` legen:
```tsx
// layout.tsx
import './peakr.css';
import './globals.css';
import { ThemeProvider } from '@/lib/theme';

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
```
Der Provider setzt `themeVars(direction, mode)` + `data-density` auf das
`<div className="app">` und speichert alles in `localStorage('peakr-settings')`.
Default = `{ direction: 'pine', mode: 'light', density: 'regular', alwaysLabels: true }`.

### 4. Einstellungs-UI (gleiche Funktionen wie der Prototyp)
Im Prototyp sitzen die Schalter im Tweaks-Panel — in der echten App als normale
**Einstellungen** umsetzen (z. B. Zahnrad-Menü in der Topbar). Controls:
- **Richtung** (Radio): Paper / Gletscher / Tannwald → `set({ direction })`.
  Unter dem Radio den Hinweistext `DIRECTIONS[direction].sub` zeigen.
- **Dark Mode** (Toggle) → `set({ mode: on ? 'dark' : 'light' })`.
  Zusätzlich der **Sonne/Mond-Button in der Topbar** (siehe `reference/app.jsx`,
  `icon-btn`, Icons `Sun`/`Moon`) — schaltet denselben Wert.
- **Dichte** (Radio): compact / regular / comfy → `set({ density })`.
- **Kartenlabels beim Zoomen** (Toggle) → `set({ alwaysLabels })`, an die Karte
  durchreichen (zeigt alle Zielnamen beim Hineinzoomen).

### 5. Icons
`npm i lucide-react`. Der Prototyp nutzt Lucide durchgehend (`<Mountain/>`,
`<Wind/>`, `<Star/>`, `<Sun/>`, `<Moon/>`, `<ArrowLeft/>`, `<Navigation/>`,
`<ChevronDown/>`, `<Droplets/>`, `<X/>`, `<Play/>`, `<Pause/>`, `<RotateCw/>`,
`<Image/>`, `<TriangleAlert/>`, `<CloudSun/>` …). `weatherInfo()` im Prototyp gibt
bereits **Lucide-Icon-Namen** zurück (kein Emoji) — übernehmen.

---

## Seiten 1:1 nachbauen (mit echten Daten)
Jede Route mit den **gleichen Klassennamen/Strukturen** wie im Prototyp, Daten aus
eurer bestehenden API (`lib/api.ts`). Vorlagen:

| Eure Route | Prototyp-Vorlage (`reference/`) | Kernklassen |
|---|---|---|
| `app/page.tsx` (Suche/Karte) | `app.jsx` `App` + `SearchView`, `map.jsx`, `ui.jsx` `ResultsPanel`/`ResultCard` | `.topbar`, `.rcard`, Relief-Karte |
| `app/destinations/[id]/page.tsx` | `views.jsx` `DetailView` + `detail3d.jsx` | `.detail-media`, `.detail-card`, `.wx-pop` |
| `app/dashboard/page.tsx` | `views.jsx` `DashboardView` | `.detail-card`, Favoriten-Grid |
| `app/login`, `app/register` | `views.jsx` `AuthView` | `.auth-*` |
| `components/Header.tsx` | `app.jsx` `TopBar` + `Brandmark` | `.topbar`, `.brand` |

### Daten-Mapping (Prototyp → eure `DestinationDetail`)
| Prototyp | Eure API |
|---|---|
| `d.type === 'ski'` | `d.type === 'ski_resort'` |
| `d.lat` / `d.lng` | `d.location.lat` / `d.location.lng` |
| `d.weather` / `d.temp` / `d.wind` | `d.live.weatherCode` / `d.live.temperatureC` / `d.live.windKmh` |
| `d.avalanche` | `d.live.avalancheLevel` |
| `ROUTE_PTS[d.id]` (Parkplatz/Ziel) | **fehlt → siehe Datenlücke** |

---

## Die 4 neuen Detailseiten-Features (bereits im Prototyp enthalten)
Vorlage `reference/detail3d.jsx` + `reference/views.jsx` `DetailView`:
1. **3D-Geländeansicht** mit Route Parkplatz→Ziel (swisstopo-Luftbild + DEM,
   Auto-Rotation, „Überflug"). MapLibre ist bereits Dependency. Style & Logik
   komplett in `detail3d.jsx` (`Terrain3D`).
2. **Foto-Umschalter** (3D / Foto) im Medienbereich. In der App „Foto" = echtes
   Bild pro Ziel **oder** swisstopo-Standbild (`pitch:0`); der Drag-Slot ist nur Demo.
3. **7-Tage-Wetterfenster** bei Klick auf Wetter/Wind (`.wx-pop`). In der App
   **echte Daten** statt Mock: Open-Meteo (kostenlos, kein Key):
   ```
   https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}
     &daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max
     &timezone=Europe/Zurich&forecast_days=7
   ```
4. **Kein Wikipedia-Button** (im alten `[id]/page.tsx` den `d.wikipediaTitle`-Block löschen).

### Datenlücke: Parkplatz-/Startkoordinaten
`DestinationDetail` hat nur das Ziel. **Schnell:** Startpunkt synthetisch ableiten
(`routeGeo`-Fallback in `reference/data.jsx`). **Sauber (später):** Feld
`parking:{lat,lng,label}` ins `destinations`-Schema (`packages/shared`) + Import
(`apps/backend`, Overpass `amenity=parking`/Talstation) + Detail-Response. Dann im
Google-Maps-Link `origin={park}&destination={ziel}` → Navigation startet am Parkplatz.

---

## Verifizierung (alle Funktionen)
- App startet im **Tannwald/hell**-Look (Serif-Headlines, grünlicher Akzent).
- **Richtung** wechseln (Paper/Gletscher/Tannwald) → ganze Oberfläche ändert Farbton.
- **Dark Mode** (Topbar Sonne/Mond) → alles dunkel, gleiche Richtung beibehalten.
- **Dichte** ändert Abstände/Kartengröße; **Kartenlabels** zeigen Namen beim Zoomen.
- Einstellungen überstehen **Reload** (localStorage).
- Detailseite: 3D-Route, Foto-Toggle, 7-Tage-Open-Meteo-Fenster, kein Wikipedia.

## Hinweise
- **oklch** wird von allen aktuellen Browsern unterstützt — Tokens bewusst in oklch
  (exakt wie Prototyp). Kein Sass/Umrechnen.
- **MapLibre rendert nur im sichtbaren Tab** (rAF) → in Headless/CI evtl. schwarz,
  kein Bug. Lade-/Fehler-Overlay ist im Prototyp vorhanden.
- 3D/Wetter brauchen Internet (swisstopo, Open-Meteo); bei Fehlern sauber auf
  Foto/Standbild zurückfallen. Attribution „© swisstopo" sichtbar lassen.

## Referenzdateien (`reference/`)
- `peakr-theme.ts` — **Theme-Engine** (DIRECTIONS + themeVars + ThemeProvider) ← Herz
- `styles.css` — **komplettes Design-System** (alle Klassen, nutzt nur Variablen)
- `peakr-tokens.css` — statischer Token-Fallback (eine Richtung; für die volle App
  reicht das nicht — ThemeProvider nutzen)
- `app.jsx` — App-Shell, Topbar, Routing, Settings-Schalter (Tweaks-Panel)
- `views.jsx` — `DetailView`, `DashboardView`, `AuthView`
- `detail3d.jsx` — `Terrain3D`, `WeatherWindow`, Foto
- `data.jsx` — Datenform, `routeGeo`, `ROUTE_PTS`, `forecastFor`
- `ui.jsx` — Badges, `ScoreDot`, `ResultCard`/`ResultsPanel`
- `map.jsx` — Relief-Karte & Marker-Optik
- `core.jsx` — Icons, `themeVars`-Original, `scoreColor`, `weatherInfo`, `AVALANCHE`
- `Peakr.html` — Font-Einbindung & Script-Reihenfolge
