# 🧰 SETUP_EXTERNAL — was DU noch manuell tun musst (macOS)

Diese Liste ist **der Reihe nach** abarbeitbar. Danach läuft CH-AlpineRoute komplett lokal.
Der Code ist fertig; es fehlen nur Tools, ein (kostenloser) API-Key und das Befüllen der `.env`.

> Schätzdauer: ~15–20 Min (plus Download-Zeiten). Alles ist kostenlos — die einzige Ausnahme ist
> der optionale OpenAI-Key in Schritt 4, den du getrost überspringen kannst.

---

## 1) Voraussetzungen installieren

Prüfe zuerst, was schon da ist:

```bash
node -v      # erwartet v20+ (bei dir war v25 vorhanden ✓)
pnpm -v      # erwartet 9.x  (wurde bereits via npm global installiert ✓)
git --version
docker --version   # FEHLT bei dir noch -> Schritt 1b
```

**1a) Falls Node/pnpm/Git fehlen** (Homebrew empfohlen):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"  # nur falls kein brew
brew install node git
npm install -g pnpm@9
```

**1b) Docker Desktop installieren (PFLICHT — fehlt auf deinem Mac):**

```bash
brew install --cask docker
```

Danach **Docker Desktop einmal aus dem Programme-Ordner starten** (Wal-Icon in der Menüleiste muss
„running" zeigen). Erst dann funktioniert `docker compose`. Test:

```bash
docker --version && docker compose version
```

---

## 2) Kostenlosen OpenRouteService-API-Key holen (für echte Fahrzeiten)

1. Auf <https://openrouteservice.org> ein **kostenloses Konto** erstellen.
2. Einloggen → **Dashboard** öffnen.
3. Im Bereich **„Tokens"** einen neuen Token erstellen (Plan „Standard/Free" reicht — 500
   Matrix-Anfragen/Tag, das Projekt nutzt 1 Anfrage pro Suche).
4. Den Token kopieren — kommt in Schritt 5 als `ORS_API_KEY` in die `.env`.

> Ohne diesen Key startet alles trotzdem; die Fahrzeiten sind dann nur Luftlinien-Schätzungen.

---

## 3) Quellen, die KEINEN Key brauchen (nichts zu tun ✅)

Open-Meteo (Wetter/Schnee), SLF (Lawinen), swisstopo GeoAdmin (Ortssuche/Karte), Overpass/OSM
(Ziele), Wikipedia (Bekanntheits-Score), MapLibre + swisstopo-Tiles — alle **kostenlos & ohne Key**.

---

## 4) (Optional, KOSTENPFLICHTIG) OpenAI-Key — sonst überspringen

Nur falls du den Trend-Score per LLM anreichern willst:

1. Key auf <https://platform.openai.com> erstellen (Achtung: verursacht Kosten).
2. In der `.env` (Schritt 5): `ENABLE_OPENAI_TREND=true` und `OPENAI_API_KEY=sk-...`.

Standard bleibt **aus** — der Wikipedia-Score genügt völlig.

---

## 5) `.env` erstellen und ausfüllen

Im Projekt-Root:

```bash
cp .env.example .env
```

Erzeuge zwei Geheimnisse und trage sie ein:

```bash
openssl rand -base64 48    # -> JWT_SECRET
openssl rand -hex 32       # -> ENCRYPTION_KEY (genau 64 Hex-Zeichen!)
```

Öffne `.env` und setze die Werte. Jede Variable erklärt:

| Variable                          | Wert / Erklärung                                                    |
| --------------------------------- | ------------------------------------------------------------------- |
| `POSTGRES_USER/PASSWORD/DB`       | Zugangsdaten der DB (Default `alpine/alpine/ch_alpineroute` ist ok) |
| `DATABASE_URL`                    | muss zu den POSTGRES\_\*-Werten passen (Default passt bereits)      |
| `BACKEND_PORT`                    | `4000` (Default ok)                                                 |
| `CORS_ORIGIN`                     | `http://localhost:3000` (Default ok)                                |
| `JWT_SECRET`                      | **Ausgabe von `openssl rand -base64 48` einfügen**                  |
| `ENCRYPTION_KEY`                  | **Ausgabe von `openssl rand -hex 32` einfügen** (64 Hex-Zeichen)    |
| `ORS_API_KEY`                     | **dein Token aus Schritt 2**                                        |
| `ENABLE_OPENAI_TREND`             | `false` lassen (nur für Schritt 4 auf `true`)                       |
| `OPENAI_API_KEY`                  | leer lassen (nur für Schritt 4)                                     |
| `NEXT_PUBLIC_API_BASE_URL`        | `http://localhost:4000` (Default ok)                                |
| `NEXT_PUBLIC_SWISSTOPO_STYLE_URL` | Karten-Style (Default ok)                                           |

---

## 6) Datenbank starten (PostgreSQL + PostGIS via Docker)

```bash
docker compose up -d
docker compose ps          # "db" sollte "healthy" sein
```

---

## 7) Abhängigkeiten installieren & Migrationen anwenden

```bash
pnpm install
pnpm db:migrate            # legt Tabellen + PostGIS-Extension an
```

---

## 8) Daten laden

```bash
pnpm import:slf-regions    # SLF-Warnregionen
pnpm import:destinations   # Ziele (kuratiert + Overpass/Schweiz)
```

> **Overpass ist rate-limited.** Wenn eine Gruppe mit Timeout/429 abbricht: 1–2 Minuten warten und
> den Befehl erneut ausführen — der Import ist idempotent (überspringt bereits vorhandene Ziele).
> Die 16 kuratierten Ziele (Zermatt, Oeschinensee, Saxer Lücke …) sind sofort da.
> Tipp: `import:destinations` **vor** `import:slf-regions` ist auch ok — führe danach
> `pnpm import:slf-regions` nochmal aus, damit neue Ziele ihrer Lawinenregion zugeordnet werden.

Optional, damit Wetter/Schnee/Trend gefüllt werden:

```bash
pnpm worker:live           # einmal laufen lassen, dann mit Strg+C beenden
pnpm worker:trend
```

---

## 9) App starten

```bash
pnpm dev
```

- Frontend: <http://localhost:3000>
- Backend: <http://localhost:4000/api/health>

---

## 10) Smoke-Test

1. <http://localhost:3000> öffnen.
2. Oben rechts **Registrieren** (E-Mail + Passwort ≥ 8 Zeichen).
3. **Startort** eingeben (z.B. „Bern") und aus der Liste wählen.
4. Modus **Ski** oder **Wandern**, Fahrzeit einstellen → **Ziele finden**.
5. Ergebnisse als Karten + farbige Karten-Marker; ★ macht ein Ziel zum Favoriten.
6. **Dashboard** zeigt Favoriten + Standard-Startort; **Details →** zeigt Verlauf-Chart.

---

## ✅ Fertig

**Sobald `ORS_API_KEY` (und optional der OpenAI-Key) in der `.env` steht, ist von Code-Seite alles
fertig.** Falls etwas hakt, siehe „Fehlerbehebung" in der `README.md`.
