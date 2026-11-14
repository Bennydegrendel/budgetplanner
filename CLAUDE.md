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
- **PWA (stap 3):** `app/manifest.webmanifest` (naam, iconen, kleuren), `app/sw.js` (service worker: app *network-first* met `cache: "no-cache"` zodat updates meteen zichtbaar zijn ondanks de 10 minuten cache van GitHub Pages, met bewaarde kopie voor offline, Google Fonts *cache-first*; bewaart nooit gegevens), iconen in `app/icons/` (opnieuw maken: `node tools/iconen.js`). Manifest en service worker worden alleen geladen via http(s), niet als los bestand. Knop/menu-item **App installeren** + `navigator.storage.persist()` na de eerste gegevens.
- Back-up exporteren/importeren = één `.json`-bestand met de volledige `state`. Hiermee zet Benny zijn gegevens over van de claude.ai-versie naar de app (stap 4).
  Terugzetten (stap 4): `checkBackup(data)` in `core.js` controleert en vat samen (periode, aantallen, waarschuwingen; herkent de gsm-samenvatting en kapotte bestanden), `cleanBackup(data)` haalt onleesbare transacties en de oude `cloud`-instellingen eruit, daarna `hydrate()`. Ook `.json.gz` werkt.

### Stijl (cyberpunk – behouden)
Zwarte achtergrond. Tokens: `--accent #00e5ff`, `--magenta #ff2bd6`, `--gold #ffc934` (sparen/saldo), `--pos #00ffa3`, `--neg #ff2a6d`. Fonts: **Zen Dots** (titels en subtitels, op vraag van Benny i.p.v. Orbitron), Orbitron (grote bedragen in de kaartjes, token `--font-figure`), Rajdhani (tekst), Share Tech Mono (bedragen in lijsten). Kaartlabels mogen bij Cyberpunk naar een tweede regel i.p.v. afgekort te worden. Afgeschuinde hoeken via `clip-path`. Logo: roze € in een afgeschuind blokje.
**Kleuren alleen via tokens** in `:root` (geen losse `#…`/`rgba(…)` in CSS of in de JS-sjablonen). Doorzichtige varianten via de basiswaarden: `rgba(var(--accent-rgb), .45)`. Een thema hoeft dus alleen tokens te overschrijven. Extra tokens: `--on-accent` (tekst op felle knop), `--field`, `--head-top/--head-bottom`, `--grid-line`, `--backdrop`, `--menu-shadow`, `--gold-dark`, `--panel/--panel-rgb` (menu, dialogen, bovenbalk, meldingen), `--scan` (scanlijnen).
**Thema's (stap 6b):** 4 thema's (cyberpunk, synthwave, matrix, oceaan) × `dark`/`light`, als blokken `[data-theme="…"][data-mode="…"]` die alleen tokens invullen. `<html>` krijgt beide attributen van een scriptje in `<head>` (geen flits). Keuze per toestel in localStorage `budgetplanner.v1.theme` = `{t, m}`, niet in de back-up. Benny kiest altijd zelf (niet automatisch het toestel volgen). Lichte varianten: donkerdere neonkleuren voor contrast, geen `text-shadow`. Venster via Back-up ▾ → Thema en onderaan de gsm-weergave; `meta theme-color` volgt `--bg`. Een nieuw thema = één blok per modus toevoegen + naam in `THEMES` en in het `<head>`-scriptje.
**Karakter per thema (stap 6c, op vraag van Benny):** naast kleur heeft elk thema eigen vorm-tokens in een blok `[data-theme="…"]` (geldt voor donker én licht): lettertypes (`--font-display/-body/-mono/-hero`, per thema apart geladen via `window.THEME_FONTS` en `<link id="theme-fonts">`), hoeken (`--r-card/-btn/-field/-pill/-bar/-sm`, `--notch: none` = geen afschuining), hoofdletters (`--case-title`, `--case-ui`; nooit vaste hoofdletters typen), gloed (`--glow`, per modus), hoekhaakje (`--corner`). `--font-figure` = lettertype van grote bedragen (data); bij de andere thema's gelijk aan hun titellettertype. Synthwave: Audiowide/Exo 2, zonsondergang-titel, horizongloed. Matrix: VT323 + IBM Plex Mono, kleine letters, `> titel_`, `//` voor kaarttitels, compacter. Oceaan: Quicksand/Nunito, ronde kaarten, zachte schaduw, luchtiger. De **volgorde** van de onderdelen blijft voor alle thema's gelijk (dat is stap 7).
**Animaties (stap 6c):** alleen bij wisselen van scherm (`afterRender(view)` zet kort `#main.enter`), niet bij elke wijziging: inhoud schuift binnen, grafieken tekenen zich (clip-path), balken groeien, KPI-bedragen tellen op (`countUp`). Dialoog/menu poppen open. Per thema: Cyberpunk glitch op de titel, Matrix typt de titel (`typeTitle`) + knipperende cursor, Synthwave gestreepte zon + neonvloer, Oceaan golven + deinende lichtvlekken in de laag `#fx` (`::before`, `::after` en twee `<i>`; enkel `transform`, zuinig). Kaarten bij Synthwave/Oceaan zijn licht doorschijnend (`rgba(var(--panel-rgb), .8x)`), anders zie je de achtergrond niet. Let op: met perspectief kan een laag buiten beeld vallen; controleer met `getBoundingClientRect()`. Matrix donker = zuiver zwart + matrixgroen `#00ff41` (op vraag van Benny), enkel rood voor negatief. Alles uit bij `prefers-reduced-motion`.

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
- [x] **Stap 3 – Installeerbaar (PWA).** `manifest.webmanifest` (naam "Budgetplanner", kort "Budget", zwarte achtergrond, themakleur `#000000` – op vraag van Benny zwart i.p.v. cyaan, zodat de titelbalk/statusbalk zwart is), iconen in 192/512 px + maskable (roze €-logo), en een service worker voor offline gebruik. Test installeren op pc en gsm.
- [x] **Stap 4 – Gegevens overzetten.** Duidelijke import van een v1.0-back-up (`.json`), met controle en een samenvatting ("x transacties, y categorieën…"). Benny exporteert uit de claude.ai-versie en importeert in de app.
- [x] **Stap 5 – OneDrive-back-up via de OneDrive-map.** Desktop (Edge/Chrome): de gebruiker kiest één keer een map die de OneDrive-app synchroniseert (File System Access API, `showDirectoryPicker`; de map-toegang staat in IndexedDB onder sleutel `"dirHandle"`). De app schrijft daar dezelfde bestanden als v1.0: `budgetplanner-backup.json.gz`, `budgetplanner-backup-JJJJ-MM.json.gz` en `budgetplanner-mobiel.txt`, automatisch na een import, bij openen (max. 1×/dag) en bij wegklikken na een wijziging. Na een herstart kan de browser opnieuw toestemming vragen → melding "Hervatten". Gsm: ⟳ opent het kiesvenster, de gebruiker kiest `budgetplanner-mobiel.txt` uit OneDrive (of een volledige back-up); nieuwer → "⚡ Nieuwe update". *Waarom niet MSAL/Graph zoals eerst gepland:* een app registreren in Microsoft Entra lukt niet met een persoonlijk Microsoft-account zonder eigen tenant (fout AADSTS50020); daarvoor is een Azure-account met creditcard nodig. Kan later alsnog bovenop deze oplossing komen.
- [x] **Stap 6 – Thema's (licht/donker).** Op vraag van Benny vóór de layout.
  - [x] 6a – Opkuis: alle losse kleuren naar tokens (pixelvergelijking vóór/na: 0 verschillen).
  - [x] 6b – Licht/donker + themakiezer, voor de volledige app en de gsm-weergave.
  - [x] 6c – Karakter per thema (lettertypes, hoeken, accenten) + animaties (kort en spaarzaam, respecteert "minder beweging").
- [x] **Stap 7 – Layout voor elk scherm.**
  - [x] 7a – Brede schermen (≥ 1600 px): inhoud tot 1760 px breed + vast zijpaneel `#side` (Binnenkort te betalen, Resterend budget, Spaardoelen), niet op het Overzicht (daar staat het al). `renderSide()` na elke render; onder 1600 px ongewijzigd.
  - [x] 7b – Volledige planner op de gsm (≤ 900 px): menuknop ☰ `#btn-nav` met naam van het huidige tabblad i.p.v. verborgen veegbalk; ≤ 700 px kaartjes 2 per rij en prijsstijgingen als inklapbare `details.fold` (`narrow()`).
  - [x] 7c – Gsm-weergave: bovenbalk weg (`body.lite header`), logo + titel + 👁/⟳ in één kopregel die bovenaan blijft staan (sticky); prijsstijgingen inklapbaar.
  - Oorspronkelijke omschrijving: Gsm-weergave verfijnen en de lege ruimte op brede schermen benutten (bv. breder raster of zijpaneel met "binnenkort te betalen", spaardoelen, resterend budget).

## Regels

- **Nooit persoonlijke gegevens in de repo**: geen bank-CSV's, back-ups, rekeningnummers of bedragen. Zie `.gitignore`. Testgegevens zijn verzonnen.
- Commitberichten in het Nederlands, in de vorm: `Stap 1: Claude-functies verwijderd`.
- Na wijzigingen aan `core.js`: snel controleren met `node` dat het nog laadt.
- Bij twijfel over een keuze die moeilijk terug te draaien is: eerst vragen.
