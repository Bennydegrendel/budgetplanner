# CLAUDE.md – Budgetplanner

Projectdossier voor Claude Code. Lees dit volledig voor je iets doet.

## Over de gebruiker (belangrijk)

- **Benny** is technisch tekenaar, géén software-engineer. Hij gebruikt dit project om **te leren hoe je software maakt** met Claude. Later wil hij een eigen tool bouwen (repo `IZUMI.BOMexporter`, nu nog niet aan beginnen).
- **Taal:** antwoord altijd in **Nederlands (Vlaams)**, ook commitberichten en teksten in de app.
- **Leg het waarom uit**, niet alleen het hoe. Gebruik vergelijkingen met zijn vak waar het helpt (revisies, revisievak, varianten). Houd uitleg kort en concreet; geen jargon zonder uitleg.
- **Eerst mening, dan bouwen.** Vraagt hij je mening of "wat denk je", geef dan je advies en wacht op zijn akkoord. Begin niet ongevraagd te bouwen.
- Werk in **kleine stappen**: één stap = één commit met een duidelijke Nederlandse omschrijving. Toon na elke stap kort wat er veranderde en hoe hij het kan testen.

## Twee versies – de afspraak

| Map | Wat | Regel |
|---|---|---|
| `claude-versie/` | De planner zoals hij draait als artifact op claude.ai (v1.0). Benny gebruikt die dagelijks. | **BEVROREN.** Niets aan veranderen, niets toevoegen. Enkel een echte bug oplossen als Benny daar expliciet om vraagt. |
| `app/` | De **standalone app** (PWA) die we nu bouwen, vertrekkend van een kopie van v1.0. | Hier werken we. |

Doel van de standalone app: **overal installeerbaar bij iedereen** (Windows, Mac, Android, iPhone) via de browser, zonder app store en zonder code-ondertekening/certificaten. Niet commercieel.

## Architectuur (zoals in v1.0)

- Eén zelfstandige HTML-pagina, geen framework, geen build-tools behalve `tools/build.py`.
- `core.js` = pure rekenlogica, geen DOM. Testbaar met `node`.
- `app.html` = uitzicht, bediening en grafieken (SVG met de hand). Bevat de plek `/*__CORE__*/`.
- Bouwen: `python tools/build.py app` → `app/index.html` (app.html met core.js ingevoegd). Voor de bevroren versie: `python tools/build.py claude-versie`.
- **Opslag:** IndexedDB, database `"budgetplanner"`, store `"kv"`, sleutel `"state"` (JSON-string), met localStorage als terugval (sleutel `budgetplanner.v1`). In de PWA blijft dit zo; de gegevens horen bij het webadres (origin) van de app.
- **PWA (stap 3):** `app/manifest.webmanifest` (naam, iconen, kleuren), `app/sw.js` (service worker: app *network-first* met bewaarde kopie voor offline, Google Fonts *cache-first*; bewaart nooit gegevens), iconen in `app/icons/` (opnieuw maken: `node tools/iconen.js`). Manifest en service worker worden alleen geladen via http(s), niet als los bestand. Knop/menu-item **App installeren** + `navigator.storage.persist()` na de eerste gegevens.
- Back-up exporteren/importeren = één `.json`-bestand met de volledige `state`. Hiermee zet Benny zijn gegevens over van de claude.ai-versie naar de app (stap 4).
  Terugzetten (stap 4): `checkBackup(data)` in `core.js` controleert en vat samen (periode, aantallen, waarschuwingen; herkent de gsm-samenvatting en kapotte bestanden), `cleanBackup(data)` haalt onleesbare transacties en de oude `cloud`-instellingen eruit, daarna `hydrate()`. Ook `.json.gz` werkt.

### Stijl (cyberpunk – behouden)
Zwarte achtergrond. Tokens: `--accent #00e5ff`, `--magenta #ff2bd6`, `--gold #ffc934` (sparen/saldo), `--pos #00ffa3`, `--neg #ff2a6d`. Fonts: Orbitron (titels), Rajdhani (tekst), Share Tech Mono (bedragen). Afgeschuinde hoeken via `clip-path`. Logo: roze € in een afgeschuind blokje.

### Functies in v1.0
ING CSV-import (ontdubbelen), automatisch categoriseren (regels + leren van keuzes), overzicht maand/jaar met heatmap per categorie, budgetten per maand of jaar met overschot meenemen ("meenemen vanaf"), categorievolgorde, spaardoelen + spaarrekening via referenties `SP-…` (incl. vrij sparen, overboekingen tussen doelen, ankersaldo), leningen & kredieten (L&K: trefwoorden + ankersaldo), aflossingssimulator, vermogen, planner met herinneringen + `.ics`-export, saldoverwachting, prijsstijgingen, splitsregels (bv. € 15 van elke supermarktbetaling naar Huisdieren), labels, splitsen van transacties, pincode, CSV-export, OneDrive-back-up met gsm-samenvatting, gsm lite-weergave met update-melding en oogje (bedragen vervagen).

### Lessen uit v1.0 (niet opnieuw tegenaan lopen)
- ING's omzetnummer begint elk jaar opnieuw → ontdubbelsleutel = `rekening|omzetnummer|datum`.
- Spaarankers: bewegingen op de ankerdag zelf expliciet bijhouden (`anchor.included`).
- Kleine bedragen niet afronden naar € 0 (helper `eurS`).
- Microsoft Graph remt af bij veel schrijfacties kort na elkaar → altijd opnieuw proberen met pauze.
- Een persoonlijke OneDrive weigerde via de Claude-koppeling het teruglezen van `.json` (401) – `.txt` werkte. Bij rechtstreekse Graph-toegang (stap 5) opnieuw testen.

## Wat eruit moet in de standalone app

Anthropic laat **niet** toe dat een eigen app gebruikers laat aanmelden met hun Claude-account of hun Claude-abonnement gebruikt. Daarom gaan **alle Claude-functies eruit**:

1. Tabblad **Vraag Claude** (`#vraag`, `viewAsk`/chat-code).
2. Knop **✦ Maandrapport** (`reportDialog`).
3. Knop **✦ Laat Claude voorstellen doen** bij categoriseren (`ai-suggest`).

Daarnaast hangt v1.0 af van `window.claude` (alleen beschikbaar binnen claude.ai):
- `window.claude.use("sample")` → Claude-functies: weg.
- `window.claude.use("mcp")` → OneDrive via de Claude-koppeling: weg in stap 1, rechtstreeks via Microsoft in stap 5.
- `window.claude.use("downloads")` → `offerFile()`: vervangen door een gewone browserdownload (Blob + `<a download>`).

Wie Claude wil gebruiken, gebruikt de versie op claude.ai. Geen API-sleutel-optie inbouwen tenzij Benny erom vraagt.

## Werkversie en vrijgeven (zoals revisies)

- Werken gebeurt op een **werkbranch** (`claude/…`). Dat is de werktekening: niemand anders ziet ze.
- **`main` = de vrijgegeven versie.** Alles wat op `main` komt, zet `.github/workflows/pages.yml` automatisch online op `https://bennydegrendel.github.io/budgetplanner/`.
- Vrijgeven = de werkbranch samenvoegen in `main` via een pull request, pas nadat Benny getest heeft. Nooit rechtstreeks op `main` pushen zonder zijn akkoord.

## Afwijkingen in de standalone app (op vraag van Benny)

- **Blanco start:** een nieuwe gebruiker krijgt geen standaardcategorieën, -regels of -spaardoelen (`DEFAULT_*` in `core.js` zijn leeg).
- **Regels → "Transacties analyseren":** `suggestRules(state)` in `core.js` stelt regels voor (uit eigen keuzes, een lijst bekende Belgische bedrijven `RULE_HINTS`, en terugkerende onbekende tegenpartijen). Niets wordt toegepast tot de gebruiker aanvinkt en goedkeurt; ontbrekende categorieën worden pas dan aangemaakt.

## Stappenplan standalone app

Werk ze in volgorde af. Na elke stap: commit, korte uitleg, en wacht op Benny voor de volgende.

- [x] **Stap 0 – Opsplitsen.** v1.0 in `claude-versie/`, `tools/build.py`, dit dossier.
- [x] **Stap 1 – Kopie zonder Claude.** Kopieer `claude-versie/app.html` en `core.js` naar `app/`. Verwijder de drie Claude-functies, de OneDrive-via-Claude-code (back-upmenu-item, automatische cloud-back-up, gsm-samenvatting uploaden/ophalen) en alle afhankelijkheid van `window.claude`. Downloads via de browser. Alles moet lokaal werken door `app/index.html` te openen. Test in de browser dat er geen fouten in de console staan.
- [x] **Stap 2 – Online via GitHub Pages.** Publiceer `app/` (bv. via een GitHub Actions-workflow of Pages vanuit een map). Adres: `https://bennydegrendel.github.io/budgetplanner/`. Leg Benny uit wat er gebeurt.
- [x] **Stap 3 – Installeerbaar (PWA).** `manifest.webmanifest` (naam "Budgetplanner", kort "Budget", zwarte achtergrond, themakleur `#00e5ff`), iconen in 192/512 px + maskable (roze €-logo), en een service worker voor offline gebruik. Test installeren op pc en gsm.
- [ ] **Stap 4 – Gegevens overzetten.** Duidelijke import van een v1.0-back-up (`.json`), met controle en een samenvatting ("x transacties, y categorieën…"). Benny exporteert uit de claude.ai-versie en importeert in de app.
- [ ] **Stap 5 – OneDrive-sync via Microsoft.** Benny registreert eenmalig een gratis app in Microsoft Entra (persoonlijke + werkaccounts, SPA redirect naar het Pages-adres). Gebruik MSAL.js + Microsoft Graph (`Files.ReadWrite.AppFolder` of `Files.ReadWrite`). Back-up + gsm-samenvatting zoals in v1.0, met opnieuw-proberen bij afremming. Elke gebruiker meldt zich aan met zijn eigen Microsoft-account.
- [ ] **Stap 6 – Layout voor elk scherm.** Gsm-weergave verfijnen en de lege ruimte op brede schermen benutten (bv. breder raster of zijpaneel met "binnenkort te betalen", spaardoelen, resterend budget).

## Regels

- **Nooit persoonlijke gegevens in de repo**: geen bank-CSV's, back-ups, rekeningnummers of bedragen. Zie `.gitignore`. Testgegevens zijn verzonnen.
- Commitberichten in het Nederlands, in de vorm: `Stap 1: Claude-functies verwijderd`.
- Na wijzigingen aan `core.js`: snel controleren met `node` dat het nog laadt.
- Bij twijfel over een keuze die moeilijk terug te draaien is: eerst vragen.
