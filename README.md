# Budgetplanner

Persoonlijke budgetplanner in één HTML-pagina, in cyberpunkstijl.

## Bestanden

| Bestand | Wat het is |
|---|---|
| `budgetplanner.html` | De volledige app, klaar om te openen. Gebouwd uit de twee bestanden hieronder. |
| `app.html` | Het uitzicht en de bediening (tabbladen, knoppen, grafieken, gsm-weergave). Bevat de plek `/*__CORE__*/` waar `core.js` wordt ingevoegd. |
| `core.js` | De rekenkern: CSV-import, categoriseren, budgetten, sparen, leningen, planner. Bevat geen schermcode. |

## Bouwen

`budgetplanner.html` = `app.html` waarin `/*__CORE__*/` vervangen is door de inhoud van `core.js`.

## Wat er in v1.0 zit

- ING CSV-import met ontdubbelen en automatisch categoriseren (regels, leren, Claude-voorstellen)
- Overzicht per maand en per jaar, budgetten per maand of per jaar, overschot meenemen
- Spaardoelen en spaarrekening (via referenties SP-…), vrij sparen, overboekingen tussen doelen
- Leningen & kredieten, aflossingssimulator, vermogen
- Planner met herinneringen en .ics-export, saldoverwachting, prijsstijgingen
- Splitsregels (bv. € 15 van elke supermarktbetaling naar Huisdieren), labels, pincode
- OneDrive-back-up met gsm-samenvatting, lite-weergave op gsm met update-melding en oogje
- Vraag Claude

## Privacy

Deze repository bevat alleen code. Je financiële gegevens staan nooit hierin:
die blijven in je browser en in je eigen OneDrive.
