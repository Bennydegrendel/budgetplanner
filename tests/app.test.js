/* Controle van de app in een echte browser (Playwright + Chromium). Start: node tests/app.test.js
   Bouwt eerst app/index.html niet zelf: doe dat vooraf met  python tools/build.py app  (alles.js doet het voor je). */
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { console.log("Browsertests overgeslagen: Playwright is niet geïnstalleerd."); module.exports = { ok: 0, fout: 0, skipped: true }; return; }
const path = require("path"), D = require("./testdata.js"), core = require("../app/core.js");
const URL = "file://" + path.resolve(__dirname, "../app/index.html");
const file = (name, text) => ({ name, mimeType: name.endsWith(".json") ? "application/json" : "text/csv", buffer: Buffer.from(text, "utf8") });
let ok = 0, fout = 0; const fouten = [];
function check(naam, voorwaarde, info) { if (voorwaarde) ok++; else { fout++; fouten.push(naam + (info !== undefined ? " → " + JSON.stringify(info).slice(0, 200) : "")); } }

(async () => {
  const browser = await chromium.launch();
  const nieuw = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: opts.w || 1366, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
    await ctx.addInitScript(() => { try { sessionStorage.setItem("budgetplanner.v1.splash", "1"); if (!localStorage.getItem("budgetplanner.v1.tut")) localStorage.setItem("budgetplanner.v1.tut", "0"); } catch (e) {} });
    const p = await ctx.newPage(); p.errs = []; p.on("pageerror", e => { if (!/Testfout/.test(e.message)) p.errs.push(e.message); });
    await p.goto(URL); await p.waitForTimeout(400); return p;
  };
  const metBackup = async p => { await p.setInputFiles("#file-json", file("test-backup.json", JSON.stringify(D.backup()))); await p.waitForTimeout(400); await p.click("#bk-ok"); await p.waitForTimeout(600); await p.keyboard.press("Escape"); };
  const ga = (p, tab) => p.evaluate(t => { history.replaceState(null, "", "#" + t); dispatchEvent(new HashChangeEvent("hashchange")); }, tab);
  const raw = p => p.evaluate(() => new Promise(r => { const q = indexedDB.open("budgetplanner", 1); q.onsuccess = () => { const g = q.result.transaction("kv").objectStore("kv").get("state"); g.onsuccess = () => r(String(g.result || "")); }; }));
  const dlgOK = async p => { for (let i = 0; i < 3; i++) { const t = (await p.textContent("#dlg")).replace(/\s+/g, " "); if (/Nieuwe rekening/.test(t) && await p.evaluate(() => document.getElementById("dlg").open)) { await p.click("#dlg .btn.primary"); await p.waitForTimeout(400); } else return t; } return ""; };

  // 1. lege start
  let p = await nieuw();
  check("lege start: titel Overzicht", (await p.textContent("#main h1")) === "Overzicht");
  check("lege start: geen fouten", !p.errs.length, p.errs); await p.context().close();

  // 2. alle tabbladen in alle thema's, donker en licht
  p = await nieuw(); await metBackup(p);
  const tabs = ["overzicht", "transacties", "budget", "regels", "spaardoelen", "spaar", "planner", "leningen", "help", "profiel", "afsluiting", "abonnementen"];
  const mis = [];
  for (const t of ["cyberpunk", "synthwave", "matrix", "oceaan", "prestige"]) for (const m of ["dark", "light"]) {
    await p.evaluate(([t, m]) => { document.documentElement.dataset.theme = t; document.documentElement.dataset.mode = m; }, [t, m]);
    for (const tab of tabs) { await ga(p, tab); if ((await p.textContent("#main h1")) === "Oei") mis.push(`${t}/${m}/${tab}`); }
  }
  check("alle tabbladen × 10 thema's tonen zonder fout", !mis.length && !p.errs.length, mis.concat(p.errs));
  await ga(p, "jaar"); await p.evaluate(() => { history.replaceState(null, "", "#overzicht"); }); await p.click('[data-act="period-year"]'); await p.waitForTimeout(200);
  check("jaaroverzicht toont", (await p.textContent("#main h1")) !== "Oei");
  await p.context().close();

  // 3. ING-import + opnieuw inlezen
  p = await nieuw(); const ing = D.ingCsv(undefined, 40);
  await p.setInputFiles("#file-csv", file("ing.csv", ing)); await p.waitForTimeout(500); let t = await dlgOK(p);
  check("ING: 40 nieuw, geen koppeltool", /40 nieuwe transacties/.test(t) && !/koppelen/.test(t), t.slice(0, 120)); await p.keyboard.press("Escape");
  await p.setInputFiles("#file-csv", file("ing.csv", ing)); await p.waitForTimeout(500); t = await dlgOK(p);
  check("ING: opnieuw inlezen = dubbels herkend", /0 nieuwe transacties/.test(t) && /40 stonden er al in/.test(t), t.slice(0, 120)); await p.keyboard.press("Escape");

  // 4. koppeltool + bankprofiel
  await p.setInputFiles("#file-csv", file("andere.csv", D.andereBank)); await p.waitForTimeout(600);
  check("koppeltool opent", await p.isVisible("#mp-box"));
  check("koppeltool: knop uit zolang de naam ontbreekt", await p.isDisabled("#mp-ok"));
  await p.fill("#mp-name", "Testbank"); await p.waitForTimeout(500);
  check("koppeltool: 4 herkend", /4 transacties herkend/.test(await p.textContent(".map-status")), await p.textContent(".map-status"));
  await p.click("#mp-ok"); await p.waitForTimeout(500); t = await dlgOK(p);
  check("koppeltool: geïmporteerd", /4 nieuwe transacties/.test(t), t.slice(0, 120)); await p.keyboard.press("Escape");
  await p.setInputFiles("#file-csv", file("andere.csv", D.andereBank)); await p.waitForTimeout(600); t = await dlgOK(p);
  check("bankprofiel: tweede keer zonder koppeltool", /4 stonden er al in/.test(t), t.slice(0, 120)); await p.keyboard.press("Escape");
  check("ING + koppeltool: geen fouten", !p.errs.length, p.errs); await p.context().close();

  // 5. filters, ongedaan maken, vangnet, Toon me
  p = await nieuw(); await metBackup(p);
  await ga(p, "transacties"); await p.click('[data-act="tx-all"]'); await p.click('[data-act="f-toggle"]'); await p.click('[data-act="f-dir"][data-v="uit"]'); await p.fill('[data-f="min"]', "50"); await p.press('[data-f="min"]', "Enter"); await p.waitForTimeout(300);
  const rijen = +((await p.textContent(".totals")).match(/^(\d+)/) || [])[1], st = D.backup();
  const verwacht = core.filterTx(st, core.budgetTx(st), { dir: "uit", min: "50" }).length;
  check("filters: zelfde aantal als het rekenwerk", rijen === verwacht, [rijen, verwacht]);
  await ga(p, "spaardoelen"); const n0 = await p.locator('[data-act="del-goal"]').count(); await p.locator('[data-act="del-goal"]').first().click(); await p.click("#dlg-ok"); await p.waitForTimeout(300);
  const n1 = await p.locator('[data-act="del-goal"]').count(); await p.click(".toast-undo"); await p.waitForTimeout(300);
  check("ongedaan maken: doel terug", n1 === n0 - 1 && (await p.locator('[data-act="del-goal"]').count()) === n0, [n0, n1]);
  await p.evaluate(() => sessionStorage.setItem("budgetplanner.v1.testfout", "budget")); await ga(p, "budget");
  check("vangnet: melding i.p.v. leeg scherm", (await p.textContent("#main h1")) === "Oei" && await p.isVisible('[data-act="goto-overview"]'));
  await p.evaluate(() => sessionStorage.removeItem("budgetplanner.v1.testfout")); await ga(p, "budget");
  check("vangnet: daarna weer normaal", (await p.textContent("#main h1")) === "Budget");
  await ga(p, "help"); const knoppen = await p.$$eval('[data-act="help-show"]', x => x.map(e => [e.dataset.topic, +e.dataset.i]));
  let licht = 0, nietGevonden = [];
  for (const [tp, i] of knoppen) {
    await ga(p, "help"); await p.evaluate(tp => { const d = document.getElementById("help-" + tp); if (d) d.open = true; }, tp);
    await p.click(`[data-act="help-show"][data-topic="${tp}"][data-i="${i}"]`); await p.waitForTimeout(550);
    if (await p.isVisible("#spot")) licht++; else nietGevonden.push(tp + "#" + i);
    await p.mouse.click(5, 450);
  }
  check("Toon me: (bijna) elke knop wordt gevonden", nietGevonden.length <= 2, nietGevonden);
  check("filters/ongedaan/Toon me: geen fouten", !p.errs.length, p.errs); await p.context().close();

  // 6. versleuteling + demo-modus
  p = await nieuw(); await metBackup(p);
  await ga(p, "profiel"); await p.click('[data-act="pin-open"]'); await p.fill("#pin-new", "1234"); await p.fill("#pin-demo", "0000"); await p.click("#pin-ok");
  await p.waitForFunction(() => !document.getElementById("dlg").open); await p.waitForTimeout(600);
  let r = await raw(p);
  check("pincode: gegevens versleuteld", r.startsWith('{"enc":"aes-gcm"') && !r.includes("PIXELFORGE"));
  const ctx = p.context(), q = await ctx.newPage(); q.errs = []; q.on("pageerror", e => q.errs.push(e.message)); await q.goto(URL); await q.waitForTimeout(400);
  check("pincode: slotscherm", await q.isVisible("#lock"));
  await q.fill("#lock-pin", "9999"); await q.press("#lock-pin", "Enter"); await q.waitForTimeout(1500);
  check("pincode: verkeerde code geweigerd", await q.isVisible("#lock"));
  await q.fill("#lock-pin", "0000"); await q.press("#lock-pin", "Enter"); await q.waitForTimeout(1500);
  check("demo: label DEMO-MODE + Oceaan licht", await q.isVisible("#demo-badge") && (await q.evaluate(() => document.documentElement.dataset.theme + document.documentElement.dataset.mode)) === "oceaanlight");
  await ga(q, "spaardoelen"); await q.locator('[data-act="del-goal"]').first().click(); await q.click("#dlg-ok"); await q.waitForTimeout(600);
  check("demo: echte opslag onaangeroerd", (await raw(q)) === r);
  await q.close(); const z = await ctx.newPage(); await z.goto(URL); await z.waitForTimeout(400); await z.fill("#lock-pin", "1234"); await z.press("#lock-pin", "Enter"); await z.waitForTimeout(1500);
  check("pincode: juiste code opent de echte gegevens", !(await z.isVisible("#lock")) && !(await z.isVisible("#demo-badge")));
  check("pincode/demo: geen fouten", !p.errs.length && !q.errs.length, p.errs.concat(q.errs));
  await ctx.close();

  // 7. gsm-weergave
  p = await nieuw({ w: 390 }); await metBackup(p); await p.reload(); await p.waitForTimeout(600);
  check("gsm: samenvatting toont", await p.evaluate(() => document.body.classList.contains("lite")) && (await p.textContent("#main")).length > 100);
  check("gsm: geen fouten", !p.errs.length, p.errs); await p.context().close();

  // 8. snelheid met 6 jaar gegevens (enkel ter info, geen fout)
  p = await nieuw(); await p.setInputFiles("#file-json", file("groot-backup.json", JSON.stringify(D.groot()))); await p.waitForTimeout(600); await p.click("#bk-ok"); await p.waitForTimeout(1500); await p.keyboard.press("Escape");
  const tijden = [];
  for (const tab of ["overzicht", "transacties", "budget", "spaar", "planner", "afsluiting", "profiel"]) {
    const ms = []; for (let i = 0; i < 3; i++) ms.push(await p.evaluate(t => { history.replaceState(null, "", "#" + t); const s = performance.now(); dispatchEvent(new HashChangeEvent("hashchange")); document.body.offsetHeight; return performance.now() - s; }, tab));
    tijden.push(`${tab} ${Math.round(Math.min(...ms))}ms`);
  }
  console.log("Snelheid (6 jaar, 2.000+ transacties): " + tijden.join(" · "));
  await p.context().close();

  await browser.close();
  console.log(`App in de browser: ${ok} OK, ${fout} fout`); if (fouten.length) console.log(" ✗ " + fouten.join("\n ✗ "));
  module.exports.result = { ok, fout };
  if (require.main === module) process.exit(fout ? 1 : 0);
  else module.exports.done(ok, fout);
})().catch(e => { console.error("Testfout:", e); process.exit(1); });
module.exports = { done: () => {} };
