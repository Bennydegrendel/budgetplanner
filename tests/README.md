# Controlelijst (tests)

Zoals een tekeningcontrole vóór vrijgave: één commando kijkt na dat alles nog werkt.

```
node tests/alles.js
```

- `core.test.js` – het rekenwerk (`app/core.js`): ING inlezen, koppeltool, filters, saldo, maandafsluiting, abonnementen, kredietkaart, demo.
- `app.test.js` – de echte app in een browser (Playwright): alle tabbladen in alle thema's, ING-import, koppeltool, filters, ongedaan maken, vangnet, Toon me, pincode/versleuteling, demo-modus, gsm-weergave, en de snelheid met 6 jaar gegevens.
- `testdata.js` – **alle testgegevens zijn verzonnen** en worden telkens opnieuw gemaakt (uit de demo-persoon Luna). Er staan bewust geen gegevensbestanden in deze map.
