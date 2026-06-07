# Designentscheidungen & Annahmen

Dieses Dokument hält bewusste Entscheidungen fest, die beim Bauen getroffen wurden.

## Phase 0 — Gerüst

- **Paketmanager:** pnpm 9 (via npm global installiert, da Homebrew-Node kein corepack mitliefert).
- **Modulsystem:** durchgängig ESM (`"type": "module"`). TypeScript mit
  `moduleResolution: "Bundler"` → extensionslose Imports, kein `.js`-Suffix nötig.
- **Shared-Paket ohne Build-Schritt:** `@ch-alpineroute/shared` exportiert direkt die
  TS-Quelle (`exports` → `./src/index.ts`). Backend lädt sie über `tsx`, das Frontend über
  Next.js `transpilePackages`. Das spart einen separaten Build und hält die Typen synchron.
- **Eine einzige `.env` im Root:** Das Backend lädt sie über einen absoluten Pfad
  (`import.meta.url`), das Frontend über `dotenv` in `next.config.mjs`. So gibt es nur eine
  Quelle für Secrets statt je eine pro App.
- **TypeScript strict:** `strict: true` aktiv. `noUncheckedIndexedAccess` und
  `verbatimModuleSyntax` bewusst **aus** gelassen, um Reibung in einem so großen Codebestand
  zu vermeiden, ohne die Kern-Typsicherheit zu verlieren.
- **ESLint:** eine flache Root-Config (`eslint.config.mjs`) mit typescript-eslint
  (syntaktisch, nicht typ-bewusst → schnell, weniger False Positives) + Prettier-Kompat.
  Next.js führt sein eigenes Lint nicht beim Build aus (`ignoreDuringBuilds`), da separat gelintet wird.
- **Redis optional:** in `docker-compose.yml` hinter dem Profil `with-redis`, startet also
  nicht standardmäßig. Aktuell nicht zwingend gebraucht.
- **Frontend-Style:** Tailwind 3.4 (stabile Config-Datei) statt Tailwind 4 (CSS-first),
  da der Prompt eine `tailwind.config.ts` mit Breakpoints vorsieht.

## Phase 1 — DB & Shared

_(folgt)_

## Phase 2 — Externe Services

_(folgt)_

## Datenlage (ehrlich)

- **Live-Liftstatus** hat keine offizielle, schweizweite Gratis-Quelle. Die Skigebiet-Adapter
  geben bei fehlender Quelle sauber `unknown` zurück statt zu crashen. Echte Live-Liftdaten gibt
  es nur für Gebiete, für die ein konkreter Adapter existiert (siehe Phase 5).
