/* Controle van het rekenwerk (core.js), zonder browser. Start: node tests/core.test.js */
const core = require("../app/core.js"), D = require("./testdata.js");
let ok = 0, fout = 0; const fouten = [];
function check(naam, voorwaarde, info) { if (voorwaarde) ok++; else { fout++; fouten.push(naam + (info !== undefined ? " → " + JSON.stringify(info).slice(0, 200) : "")); } }
const T = "2026-11-15";

// demo-gegevens
const a = core.demoState(T), b = core.demoState(T);
check("demo: altijd dezelfde gegevens", JSON.stringify(a) === JSON.stringify(b));
check("demo: ±2 jaar transacties", a.transactions.length > 600, a.transactions.length);
check("demo: hele euro's", a.transactions.every(t => Number.isInteger(t.amount)));
check("demo: regels werken (bijna alles ingedeeld)", a.transactions.filter(t => t.cat === core.UNCAT).length <= 3);

// ING
const ing = core.parseBankCsv(D.ingCsv(T, 40));
check("ING: herkend", ing.bank === "ING", ing.bank);
check("ING: 40 rijen", ing.rows.length === 40, ing.rows.length);
check("ING: datums jjjj-mm-dd", ing.rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
const st = core.newState(); st.accounts["BE00 0000 0000 0111"] = { type: "zicht", name: "Test" };
const m1 = core.mergeRows(st, ing.rows), m2 = core.mergeRows(st, core.parseBankCsv(D.ingCsv(T, 40)).rows);
check("ING: geen dubbels bij opnieuw inlezen", m1.added === 40 && m2.added === 0 && m2.dup === 40, [m1.added, m2.added, m2.dup]);

// koppeltool (andere banken)
check("andere bank: niet als ING herkend", core.parseBankCsv(D.andereBank).unknown === true);
function viaProfiel(text, extra) { const sn = core.sniffCsv(text), g = core.guessMap(sn.rows[sn.head], sn.rows.slice(sn.head + 1, sn.head + 12)); return core.parseWithProfile(text, Object.assign({ sep: sn.sep, head: sn.head, map: g.map, twoCols: g.twoCols, dateFmt: g.dateFmt }, extra || {})); }
const ab = viaProfiel(D.andereBank);
check("andere bank: 4 verrichtingen, totaalregel overgeslagen", ab.rows.length === 4 && ab.bad === 1, [ab.rows.length, ab.bad]);
check("andere bank: bedrag met duizendtal", ab.rows.some(r => r.amount === -1050), ab.rows.map(r => r.amount));
check("andere bank: nette omschrijving", ab.rows.some(r => r.desc === "Naar Jeroen Peeters · Pizza vrijdag"), ab.rows.map(r => r.desc));
const en = viaProfiel(D.engelsBestand, { fixedAccount: "BE00 0000 0000 0999" });
check("komma-bestand: af/bij-kolommen", en.rows.map(r => r.amount).join(",") === "-3.5,2100,-750", en.rows.map(r => r.amount));
const kk = viaProfiel(D.kaartCsv(T), { flip: true, fixedAccount: "KAART-x" });
check("kaart: tekens omgedraaid", kk.rows.filter(r => r.amount < 0).length === 5 && kk.rows.filter(r => r.amount > 0).length === 1, kk.rows.map(r => r.amount));
check("bedragen lezen", [core.parseAnyAmount("1.234,56"), core.parseAnyAmount("1,234.56"), core.parseAnyAmount("12.50-"), core.parseAnyAmount("(5,00)")].join() === "1234.56,1234.56,-12.5,-5");
check("datums lezen", [core.parseDateFmt("05/10/26", "dmy"), core.parseDateFmt("10/25/2026", "mdy"), core.parseDateFmt("2026-1-3", "dmy")].join() === "2026-10-05,2026-10-25,2026-01-03");

// filters
const alle = a.transactions, uit = core.filterTx(a, alle, { dir: "uit" });
check("filters: enkel uitgaven", uit.length > 0 && uit.every(t => t.amount < 0));
check("filters: bedrag van/tot", core.filterTx(a, alle, { min: "50", max: "100" }).every(t => Math.abs(t.amount) >= 50 && Math.abs(t.amount) <= 100));
check("filters: zoeken op bedrag", core.filterTx(a, alle, { q: "18" }).some(t => t.amount === -18));

// saldo = ijkpunt (vooruit én terug)
const bal = core.balanceAt(a, T.slice(0, 7)), anker = a.balances[0];
const naAnker = a.transactions.filter(t => t.account === anker.account && t.date > anker.date && t.date <= core.endOfMonth(T.slice(0, 7))).reduce((s, t) => s + t.amount, 0);
check("saldo: ijkpunt klopt", Math.abs(bal.total - (anker.amount + naAnker)) < 0.01, [bal.total, anker.amount]);

// maandafsluiting, abonnementen
const mc = core.monthClose(a, core.addMonths(T.slice(0, 7), -1));
check("maandafsluiting: top 5 uitgaven", mc.top.length === 5 && mc.top.every(t => t.amount < 0));
check("maandafsluiting: vergelijking met gemiddelde", mc.cmp.expenses.avg > 0, mc.cmp.expenses);
const subs = core.subscriptions(a, T);
check("abonnementen: Netflix herkend", subs.some(x => /NETFLIX/.test(x.title)));

// kredietkaart: afrekening wordt verplaatsing zodra er aankopen zijn
const kaart = a.cards[0]; core.syncCardAccounts(a);
const voor = a.transactions.filter(t => core.cardMatch(a, t) === kaart).slice(0, 2);
check("kaart: afrekening eerst een uitgave", voor.every(t => !core.ownTransfer(a, t)));
core.mergeRows(a, viaProfiel(D.kaartCsv(T), { flip: true, fixedAccount: core.cardKey(kaart) }).rows); core.applyCards(a);
const laatste = a.transactions.find(t => core.cardMatch(a, t) === kaart);
check("kaart: recente afrekening wordt verplaatsing", core.ownTransfer(a, laatste) === core.cardKey(kaart), laatste && laatste.date);
const open = core.cardOpen(a, kaart, T);
check("kaart: nog te betalen berekend", open && open.open > 0, open);

console.log(`Rekenwerk: ${ok} OK, ${fout} fout`); if (fouten.length) console.log(" ✗ " + fouten.join("\n ✗ "));
module.exports = { ok, fout };
if (require.main === module) process.exit(fout ? 1 : 0);
