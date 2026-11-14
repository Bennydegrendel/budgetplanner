# Budgetplanner

Persoonlijke budgetplanner in cyberpunkstijl. Leerproject: van één HTML-pagina op claude.ai naar een installeerbare app.

## Mappen

| Map | Wat |
|---|---|
| `claude-versie/` | **v1.0** zoals hij draait op claude.ai, mét Claude-functies. Bevroren. |
| `app/` | De **standalone app** (PWA) in opbouw: zonder Claude, installeerbaar op pc en gsm. |
| `tools/` | `build.py` voegt `core.js` in `app.html` in tot één HTML-bestand. |
| `CLAUDE.md` | Projectdossier en stappenplan voor Claude Code. |

## Bouwen

```
python tools/build.py claude-versie   # -> claude-versie/budgetplanner.html
python tools/build.py app             # -> app/index.html
```

## Online

De app staat op https://bennydegrendel.github.io/budgetplanner/ .
Elke wijziging op `main` wordt automatisch gebouwd en online gezet (`.github/workflows/pages.yml`).
Werken gebeurt op een aparte branch; samenvoegen in `main` = een nieuwe versie vrijgeven.

## Wat er in v1.0 zit

- ING CSV-import met ontdubbelen en automatisch categoriseren
- Overzicht per maand en per jaar, budgetten per maand of per jaar, overschot meenemen
- Spaardoelen en spaarrekening (referenties SP-…), vrij sparen, overboekingen tussen doelen
- Leningen & kredieten, aflossingssimulator, vermogen
- Planner met herinneringen en .ics-export, saldoverwachting, prijsstijgingen
- Splitsregels, labels, pincode
- OneDrive-back-up met gsm-weergave (update-melding, oogje)
- Vraag Claude, maandrapport en Claude-voorstellen (enkel in de claude.ai-versie)

## Privacy

Deze repository bevat alleen code. Financiële gegevens staan er nooit in:
die blijven in de browser en in de eigen OneDrive van de gebruiker.
