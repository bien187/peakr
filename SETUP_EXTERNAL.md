# Peakr – Einrichtung der externen Dienste

Alles hier ist kostenlos. Reihenfolge einhalten: erst Datenbank, dann GitHub, dann Vercel.
Aufwand: rund 30 Minuten, davon ~20 Minuten Warten auf den ersten Datenaufbau.

Benötigt werden Konten bei **Vercel** (Projekt `peakr-frontend`, Domain `peakr-ch.vercel.app`) und
**GitHub** (Repository `bien187/peakr`, öffentlich). Die Datenbank (**Neon**) wird über Vercel
angelegt. Schlüssel für OpenRouteService oder OpenAI sind **nicht** nötig.

Befehle unten laufen im Repository-Root mit angemeldeter `vercel`- und `gh`-CLI. Sie übergeben
Geheimnisse direkt von Programm zu Programm – nichts muss kopiert oder irgendwo eingefügt werden.

---

## 1. Datenbank (Neon über Vercel)

Supabase wird nicht mehr verwendet. Neon bietet PostgreSQL mit PostGIS kostenlos an; die Gratisstufe
reicht für Peakr deutlich (Stand der Neon-FAQ vom 03.11.2026: 1 GB Speicher, 100 CU-Stunden
Rechenzeit und 5 GB ausgehender Datenverkehr je Projekt und Monat). Peakr belegt rund 110 MB.

### 1.1 Alte Variablen entfernen

Im Projekt stehen noch Werte der gelöschten Supabase-Datenbank. Sie würden mit der Neon-Integration
kollidieren:

```bash
vercel link --yes --project peakr-frontend      # einmalig; legt .vercel/ an (gitignored)
rm -f .env.local                                # vercel link lädt Altwerte herunter – nicht benötigt
for env in production preview; do
  vercel env rm DATABASE_URL "$env" --yes
  vercel env rm ENCRYPTION_KEY "$env" --yes     # wird nicht mehr verwendet
done
```

### 1.2 Neon anlegen

1. [vercel.com](https://vercel.com) → Projekt **peakr-frontend** → Tab **Storage** → **Create Database** → **Neon**.
2. Plan **Free**, Region **Frankfurt (aws-eu-central-1)**, Name `peakr`.
3. **Environment Variables Prefix leer lassen**, mit **Connect** an das Projekt hängen
   (Production, Preview, Development).

Vercel legt dabei unter anderem `DATABASE_URL` (über den Pooler, für die Website) und
`DATABASE_URL_UNPOOLED` (direkt, für Importe und Worker) an. Peakr nimmt automatisch die passende:
auf Vercel die gepoolte, auf der Kommandozeile und in GitHub Actions die direkte.

PostGIS muss nicht von Hand aktiviert werden – die Migration erledigt das.

> Neon pausiert die Datenbank nach 5 Minuten ohne Zugriff und weckt sie beim nächsten Zugriff
> selbst wieder auf (erste Antwort dann 1–2 s langsamer). Anders als bei Supabase wird ein
> Gratisprojekt dabei nicht gesperrt.

## 2. GitHub

### 2.1 Secrets

```bash
S=$(mktemp)
vercel env pull "$S" --environment=production --yes
URL=$(grep '^DATABASE_URL_UNPOOLED=' "$S" | cut -d= -f2- | tr -d '"')
rm -f "$S"
if [ -n "$URL" ]; then printf %s "$URL" | gh secret set DATABASE_URL; else echo "leer – siehe Hinweis unten"; fi
unset URL
```

Damit erhält GitHub die **direkte** Neon-Verbindung als Secret `DATABASE_URL`.

Bleibt der Wert leer (Vercel gibt als «sensitiv» markierte Variablen nicht heraus): Vercel →
*Storage* → `peakr` → Abschnitt *.env.local* → `DATABASE_URL_UNPOOLED` anzeigen und mit
`gh secret set DATABASE_URL` eintragen (die Eingabe ist verdeckt).

| Secret | Wert | Pflicht |
|---|---|---|
| `DATABASE_URL` | direkte Neon-Verbindung (siehe oben) | ja |
| `VERCEL_DEPLOY_HOOK_URL` | URL aus 4.4 | empfohlen |

Veraltete Secrets können gelöscht werden: `ORS_API_KEY`, `ENCRYPTION_KEY`, `OPENAI_API_KEY`, `JWT_SECRET`
(die Worker signieren keine Token).

### 2.2 Änderungen pushen und Workflows aktivieren

GitHub hatte den Worker-Workflow wegen 60 Tagen Inaktivität abgeschaltet. Nach dem Push dieser
Version:

```bash
gh workflow enable "Peakr Worker"
gh workflow enable "Peakr Daten"
gh workflow enable "CI"
```

Der wöchentliche Daten-Workflow schaltet beide Zeitpläne bei jedem Lauf wieder ein, damit sie nicht
erneut stillschweigend abgeschaltet werden.

### 2.3 Erster Datenaufbau

```bash
gh workflow run "Peakr Daten"
gh run watch "$(gh run list --workflow 'Peakr Daten' --limit 1 --json databaseId -q '.[0].databaseId')"
```

Dauer ~15–25 Minuten. Der Lauf legt das Schema an, lädt swissNAMES3D, die amtlichen Wanderwege und
den OSM-Auszug, baut Ziele, Skigebiete, Strassengraph, Parkplätze und Routen auf, schreibt den
Datenqualitätsbericht in die Zusammenfassung und veröffentlicht `road-graph.bin` (~40 MB) und
`search-index.json.gz` (~2 MB) im Release **data-latest**.

### 2.4 Live-Daten einmal füllen

```bash
for job in ski weather trend; do gh workflow run "Peakr Worker" -f job=$job; done
```

Danach laufen sie automatisch (ski alle 3 h, weather alle 6 h, trend montags, maintenance täglich).

## 3. Lokale Umgebung

Die lokale `.env` zeigt noch auf die gelöschte Supabase-Datenbank. Für die Entwicklung auf die
lokale Datenbank umstellen:

```
DATABASE_URL=postgresql://alpine:alpine@localhost:5432/peakr
```

`NEXT_PUBLIC_API_BASE_URL`, `BACKEND_PORT`, `CORS_ORIGIN` und `ENCRYPTION_KEY` werden nicht mehr
gelesen und können entfernt werden.

> Das Repository liegt im iCloud-synchronisierten Schreibtisch. iCloud hat dort Dateien ausgelagert
> und Konfliktkopien wie `search 2/` angelegt (eine davon brach den Typecheck). Empfehlung: das
> Repository ausserhalb von *Schreibtisch*/*Dokumente* ablegen, z. B. `~/Developer/peakr`.

## 4. Vercel

### 4.1 Projekt-Einstellungen

*Project → Settings → General*: **Root Directory** `apps/frontend`, Framework **Next.js**,
Install Command leer lassen (pnpm wird über `packageManager` erkannt), Node.js **22.x**.

Die Funktionsregion ist über `apps/frontend/vercel.json` auf **Frankfurt (`fra1`)** gesetzt – neben
der Neon-Datenbank.

### 4.2 Umgebungsvariablen

`DATABASE_URL` und `DATABASE_URL_UNPOOLED` hat die Neon-Integration gesetzt. Zusätzlich nötig ist
ein Signatur-Geheimnis für Anmeldungen (mindestens 32 Zeichen). Ein vorhandenes `JWT_SECRET` aus
der Supabase-Zeit kann bleiben, wenn es mindestens 32 Zeichen hat – sonst startet die API nicht.
Neu setzen (meldet alle Benutzer ab):

```bash
for env in production preview; do
  vercel env rm JWT_SECRET "$env" --yes 2>/dev/null
  openssl rand -base64 48 | tr -d '\n' | vercel env add JWT_SECRET "$env"
done
```

Entfernen, falls vorhanden: `NEXT_PUBLIC_API_BASE_URL`, `ORS_API_KEY`, `ENCRYPTION_KEY`.

### 4.3 Deploy

Nach dem ersten Datenaufbau (2.3): *Deployments → … → Redeploy* (ohne Build-Cache) oder
`vercel deploy --prod`. Der Build lädt Strassengraph und Suchindex aus dem Release `data-latest`
und packt beide in die Serverfunktionen.

### 4.4 Deploy-Hook (für die wöchentlichen Daten)

*Settings → Git → Deploy Hooks* → Name `peakr-data`, Branch `main` → URL kopieren und speichern:

```bash
gh secret set VERCEL_DEPLOY_HOOK_URL     # fragt den Wert verdeckt ab
```

Ohne Hook nutzt die Suche die Daten des letzten Deploys weiter – Fahrzeiten bleiben korrekt, nur
neue Strassen, Parkplätze und Saisonsperren kommen erst mit dem nächsten Push an.

## 5. Abnahme

1. `https://peakr-ch.vercel.app/api/health` → `"status": "ok"`, `"database": true`,
   `"routing.available": true`, `"searchIndex.available": true`, alle Jobs `stale: false`.
2. Startseite: Startort Zürich, Wandern, 90 min → mehrere tausend Ziele, Rigi Kulm um 45 min.
3. Ein Ziel öffnen → Anreise mit Fahrzeit, Route auf der Karte.
4. Registrieren, Favorit setzen, Seite neu laden → Favorit bleibt.

`"status": "degraded"` bedeutet: Daten sind da, aber ein Job ist überfällig oder lief noch nie –
siehe [docs/BETRIEB.md](docs/BETRIEB.md#fehlerbehebung).
