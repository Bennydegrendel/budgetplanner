/* Testgegevens – ALLES VERZONNEN, er staan geen bestanden met gegevens in de repo.
   Alles wordt gemaakt uit de demo-persoon Luna (demoState in core.js) of staat hieronder als korte, verzonnen tekst. */
const core = require("../app/core.js");
const vandaag = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

// een back-up (.json) met Luna's gegevens, als gewone planner (geen demo)
function backup(today) { const st = core.demoState(today || vandaag()); delete st.demo; st.exportedAt = new Date().toISOString(); return st; }

// een ING-CSV met verzonnen verrichtingen (zelfde kolommen als een echte ING-export)
function ingCsv(today, n) {
  const t = today || vandaag(), st = core.demoState(t), rows = st.transactions.filter(x => !x.account.startsWith("KAART")).slice(0, n || 40);
  const head = "Rekeningnummer;Naam van de rekening;Rekening tegenpartij;Omzetnummer;Boekingsdatum;Valutadatum;Bedrag;Munteenheid;Omschrijving;Detail van de omzet;Bericht";
  const dmy = d => d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4);
  return [head, ...rows.map((x, i) => ["BE00 0000 0000 0111", "Testrekening", x.counterparty || "", String(9000 + i), dmy(x.date), dmy(x.date), x.amount.toFixed(2).replace(".", ","), "EUR", x.desc, "", ""].join(";"))].join("\r\n");
}

// een andere bank: info-regels bovenaan, eigen kolomnamen, totaalregel onderaan
const andereBank = [
  "Rekeninguitdraai Testbank - verzonnen;;;;;;;;", "Periode: 01/11/2026 tot 14/11/2026;;;;;;;;",
  "Rekening;Datum;Volgnummer;Omschrijving;Naam tegenpartij;Rekening tegenpartij;Bedrag;Munt;Mededeling",
  "BE00 0000 0000 0777;03/11/2026;2026-0412;Betaling Bancontact;CARREFOUR MARKET GENT;;-42,85;EUR;",
  "BE00 0000 0000 0777;04/11/2026;2026-0413;Overschrijving;Jeroen Peeters;BE00 0000 0000 0888;-25,00;EUR;Pizza vrijdag",
  "BE00 0000 0000 0777;07/11/2026;2026-0415;Storting;MAMA;BE00 0000 0000 0555;150,00;EUR;Verjaardagscadeau",
  "BE00 0000 0000 0777;13/11/2026;2026-0419;Overschrijving;Huisbaas Verzonnen;BE00 0000 0000 0444;-1.050,00;EUR;Huur december",
  "Totaal;;;;;;-967,85;EUR;"].join("\n");

// komma's, jaar-maand-dag, aparte kolommen voor af/bij, geen rekeningkolom
const engelsBestand = "Date,Description,Debit,Credit,Balance\n2026-10-01,Coffee Bar Gent,3.50,,100.00\n2026-10-02,Salary ACME NV,,2100.00,2196.50\n2026-10-03,Rent October,750.00,,1446.50\n";

// kredietkaart: aankopen als POSITIEF getal, één terugbetaling negatief
function kaartCsv(today) {
  const t = today || vandaag(), d = n => { const x = new Date(t); x.setDate(x.getDate() - n); return String(x.getDate()).padStart(2, "0") + "/" + String(x.getMonth() + 1).padStart(2, "0") + "/" + x.getFullYear(); };
  return ["Kaartafschrift - verzonnen;;;;;", "Datum transactie;Datum boeking;Omschrijving;Plaats;Bedrag in EUR;Kaartnummer",
    `${d(60)};${d(59)};BOOKING.COM HOTEL;AMSTERDAM;189,00;XXXX 0000`, `${d(45)};${d(44)};RESTAURANT DE GOUDEN LEEUW;GENT;64,50;XXXX 0000`,
    `${d(30)};${d(29)};AMAZON.DE MARKETPLACE;LUXEMBOURG;-15,00;XXXX 0000`, `${d(20)};${d(19)};ZALANDO;BERLIN;79,95;XXXX 0000`,
    `${d(5)};${d(4)};KINEPOLIS GENT;GENT;24,00;XXXX 0000`, `${d(2)};${d(1)};BOL.COM;UTRECHT;42,30;XXXX 0000`].join("\n");
}

// grote planner (6 jaar) om de snelheid te meten
function groot(today) {
  const st = core.demoState(today || vandaag()), base = st.transactions.slice();
  for (const y of [2, 4]) for (const t of base) st.transactions.push(Object.assign({}, t, { id: t.id + "|" + y, date: (+t.date.slice(0, 4) - y) + t.date.slice(4), omzet: t.omzet + "-" + y }));
  st.transactions.sort((a, b) => b.date.localeCompare(a.date)); delete st.demo; return st;
}
module.exports = { vandaag, backup, ingCsv, andereBank, engelsBestand, kaartCsv, groot };
