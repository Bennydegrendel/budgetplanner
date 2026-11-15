/* ---------- Kernlogica: CSV-import, categoriseren, berekeningen ---------- */
/* Een nieuwe gebruiker begint blanco: geen categorieën, regels of spaardoelen.
   Regels stelt de planner voor met "Transacties analyseren" (zie suggestRules). */
const DEFAULT_CATEGORIES = [];
const DEFAULT_RULES = [];
const DEFAULT_GOALS = [];
const UNCAT = "Te categoriseren";
const TYPES = ["Inkomen", "Vaste kosten", "Variabele kosten", "Sparen", "Overboeking"];
const BUDGET_TYPES = ["Inkomen", "Vaste kosten", "Variabele kosten", "Sparen"];
const SAV_CAT = "Spaarrekening";
function isSavAcc(state, acc) { return !!(state.accounts && acc && state.accounts[acc] && state.accounts[acc].type === "spaar"); }
function isSav(state, t) { return isSavAcc(state, t.account); }
function budgetTx(state) { return state.accounts && Object.values(state.accounts).some(a => a.type === "spaar") ? state.transactions.filter(t => !isSav(state, t)) : state.transactions; }

function newState() {
  return {
    version: 1,
    transactions: [],
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
    goals: JSON.parse(JSON.stringify(DEFAULT_GOALS)),
    balances: [],
    loans: [],
    credits: [],
    accounts: {},
    plans: [],
    ignoredRecurring: [],
    ignoredPrice: [],
    splitRules: [],
    lastBackup: null,
  };
}

function decodeBytes(buf) {
  const u8 = new Uint8Array(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^﻿/, ""); }
  catch (e) { return new TextDecoder("windows-1252").decode(u8); }
}

function splitCsvLine(line, sep) {
  const out = []; let buf = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { buf += '"'; i++; } else q = !q; }
    else if (ch === sep && !q) { out.push(buf); buf = ""; }
    else buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim());
}

function parseAmount(s) {
  s = String(s || "").replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function parseDate(s) {
  const m = String(s || "").match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function titleCase(s) { return s.toLowerCase().replace(/(^|[\s\-\/])(\S)/g, (a, b, c) => b + c.toUpperCase()); }

function cleanDescription(s) {
  s = (s || "").trim(); const low = s.toLowerCase();
  let p = low.indexOf(" uur - ");
  if (p >= 0 && /^betaling (bancontact|debit|maestro)/.test(low)) {
    let rest = s.slice(p + 7), q = rest.indexOf(" - ");
    if (q >= 0) {
      let name = rest.slice(0, q); rest = rest.slice(q + 3); q = rest.indexOf(" - ");
      if (q >= 0) name += " (" + titleCase(rest.slice(0, q)) + ")";
      return name;
    }
  }
  p = low.indexOf("van: "); if (p < 0) p = low.indexOf("naar: ");
  if (p >= 0) {
    let name = s.slice(p); const q = name.indexOf(" - "); if (q >= 0) name = name.slice(0, q);
    name = name.replace("Van: ", "Van ").replace("Naar: ", "Naar ");
    const m = low.indexOf("mededeling:");
    if (m >= 0) {
      let med = s.slice(m + 11).trim(); const r = med.toLowerCase().indexOf("persoonlijke info");
      if (r >= 0) med = med.slice(0, r).trim();
      if (med) name += " · " + med;
    }
    return name;
  }
  p = s.indexOf("(SEPA)");
  if (low.startsWith("domicili") && p >= 0) return "Domiciliëring " + s.slice(p + 6).replace(/Bericht als bijlage/i, "").trim();
  if (low.startsWith("kostenafrekening")) return "Bankkosten (kostenafrekening)";
  return s.slice(0, 120);
}

function categorize(text, rules) {
  const t = (text || "").toLowerCase();
  for (const r of rules) if (r.keyword && r.cat && t.includes(r.keyword.toLowerCase())) return r.cat;
  return UNCAT;
}

/* Herkenningssleutel voor een handelaar/tegenpartij: zonder stad, referenties en cijfers. */
function merchantKey(t) {
  let d = String(t.desc || "").replace(/\s*\([^)]*\)\s*$/, "").split(" · ")[0].split("*")[0];
  d = d.toLowerCase().replace(/[^a-z0-9à-ÿ&\s.'-]/g, " ").split(/\s+/).filter(w => w && !/\d/.test(w)).join(" ").trim();
  return d || String(t.desc || "").toLowerCase().trim();
}
/* Leert uit eerder gecategoriseerde transacties: sleutel -> meest recente categorie. */
function learnedMap(state) {
  const m = new Map();
  for (const t of budgetTx(state)) {           // gesorteerd nieuw -> oud, eerste wint
    if (t.cat && t.cat !== UNCAT) { const k = merchantKey(t); if (k && !m.has(k)) m.set(k, t.cat); }
  }
  return m;
}

/* Parseert een ING-CSV. Geeft {rows, error}. */
/* Parseert een bank-CSV van ING of Belfius (stap 8f). Geeft {rows, error, bank}.
   ING: kolomtitels op de eerste regel. Belfius: eerst enkele uitlegregels, dan de kolomtitels.
   De titelregel wordt gezocht: de eerste regel met "Boekingsdatum" én "Bedrag". */
function parseBankCsv(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) return { rows: [], error: "Het bestand bevat geen transacties.", bank: null };
  let hi = lines.findIndex((l, n) => n < 30 && /boekingsdatum/i.test(l) && /bedrag/i.test(l));
  if (hi < 0) hi = 0;
  const hl = lines[hi], sep = (hl.match(/;/g) || []).length >= (hl.match(/,/g) || []).length ? ";" : ",";
  const head = splitCsvLine(hl, sep).map(h => h.toLowerCase().replace(/^﻿/, "").trim());
  const col = (...names) => { for (const n of names) { const k = head.indexOf(n.toLowerCase()); if (k >= 0) return k; } return -1; };
  const belfius = col("Naam tegenpartij bevat") >= 0 || col("Rekeninguittrekselnummer", "Afschriftnummer") >= 0 || (col("Rekening") >= 0 && col("Transactie") >= 0 && col("Mededelingen") >= 0);
  const c = belfius ? {
    acc: col("Rekening"), stmt: col("Rekeninguittrekselnummer", "Afschriftnummer", "Uittrekselnummer"), txn: col("Transactienummer"),
    date: col("Boekingsdatum"), amount: col("Bedrag"), cp: col("Rekening tegenpartij"), name: col("Naam tegenpartij bevat", "Naam tegenpartij"),
    tx: col("Transactie", "Omschrijving"), msg: col("Mededelingen", "Mededeling"),
  } : {
    acc: col("Rekeningnummer"), omzet: col("Omzetnummer"), date: col("Boekingsdatum"), amount: col("Bedrag"),
    desc: col("Omschrijving"), cp: col("Rekening tegenpartij"), detail: col("Detail van de omzet"), msg: col("Bericht"),
  };
  if (!belfius && c.omzet < 0 && c.detail < 0) return { rows: [], error: "Geen ING-bestand.", bank: null, unknown: true };   // geen ING: koppeltool
  if (c.date < 0 || c.amount < 0 || (belfius ? c.tx < 0 && c.name < 0 : c.desc < 0))
    return { rows: [], error: "Dit lijkt geen export van ING of Belfius: de kolommen Boekingsdatum, Bedrag en Omschrijving (of Transactie) ontbreken.", bank: null, unknown: true };
  const rows = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const v = splitCsvLine(lines[i], sep); const g = k => (c[k] >= 0 ? v[c[k]] || "" : "");
    const date = parseDate(g("date")), amount = parseAmount(g("amount"));
    if (!date || amount === null) continue;
    if (belfius) {
      const stmt = g("stmt").trim(), txn = g("txn").trim();
      rows.push({ date, amount, account: g("acc"), omzet: stmt || txn ? `B${stmt}-${txn}` : "", counterparty: g("cp"),
        raw: [g("tx"), g("msg")].filter(Boolean).join(" · ").slice(0, 600), desc: belfiusDesc(g("name"), g("tx"), g("msg"), amount),
        search: [g("name"), g("tx"), g("msg"), g("cp")].join(" ") });
    } else {
      rows.push({ date, amount, account: g("acc"), omzet: g("omzet"), counterparty: g("cp"),
        raw: g("desc").slice(0, 600), search: [g("desc"), g("detail"), g("msg"), g("cp")].join(" ") });
    }
  }
  return { rows, error: null, bank: belfius ? "Belfius" : "ING" };
}
/* Leesbare omschrijving voor Belfius, in dezelfde stijl als bij ING: "Van/Naar naam · mededeling" of de winkelnaam. */
function belfiusDesc(name, tx, msg, amount) {
  name = (name || "").trim(); msg = (msg || "").replace(/\s+/g, " ").trim(); tx = (tx || "").replace(/\s+/g, " ").trim();
  if (name) return ((/overschrijving|storting|instantoverschrijving/i.test(tx) || !/betaling|aankoop|bancontact|maestro|domicili/i.test(tx)) ? (amount < 0 ? "Naar " : "Van ") : "") + name + (msg && msg.length < 60 ? " · " + msg : "");
  if (/betaling|aankoop|debetkaart|bancontact|maestro/i.test(tx)) {
    // Winkelnaam uit kaartbetalingen: vaste woorden, kaartnummer, datum en uur wegfilteren, stoppen bij de postcode.
    const shop = tx.replace(/\b(betaling|aankoop|met|debetkaart|kredietkaart|kaart|bancontact|maestro|contactloos|nummer|nr|via|om|op|uur)\b/gi, " ")
      .replace(/\b[\dX]{4}(\s+[\dX]{2,4}){1,3}\b/gi, " ").replace(/\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b/g, " ")
      .replace(/\b\d{1,2}[.:hu]\d{2}\b/gi, " ").replace(/^[\s\-:,]+/, "").replace(/^\s*-\s*/, "").split(/\s\d{4}\s|\s(BE|NL|FR|LU|DE)(\s|$)/)[0].replace(/\s+/g, " ").trim();
    if (shop.length >= 2) return shop.slice(0, 60);
  }
  return tx.slice(0, 120) || msg.slice(0, 120);
}

/* Omzetnummers van ING beginnen elk jaar opnieuw: datum hoort bij de sleutel. */
function txKey(t) { return t.omzet ? `${t.account}|${t.omzet}|${t.date}` : null; }

/* Voegt geparste rijen toe aan de state. Muteert state. */
function mergeRows(state, rows) {
  const seen = new Set(state.transactions.map(txKey).filter(Boolean));
  const learned = learnedMap(state);
  let added = 0, dup = 0, uncat = 0, auto = 0;
  for (const r of rows) {
    const k = r.omzet ? `${r.account}|${r.omzet}|${r.date}` : null;
    if (k && seen.has(k)) { dup++; continue; }
    const desc = r.desc || cleanDescription(r.raw);
    const sav = isSavAcc(state, r.account);
    const rg = sav ? null : refGoal(state, { search: r.search, raw: r.raw, desc });
    let cat = sav ? SAV_CAT : rg && state.categories.some(x => x.name === rg) ? rg : categorize(r.search, state.rules);
    if (!sav && cat === UNCAT) { const l = learned.get(merchantKey({ desc })); if (l) { cat = l; auto++; } }
    if (cat === UNCAT) uncat++;
    state.transactions.push({
      id: k || ("m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      date: r.date, desc, cat, amount: r.amount,
      account: r.account, omzet: r.omzet, counterparty: r.counterparty, raw: r.raw, search: r.search,
      ...(sav ? { goal: null, checked: false } : {}),
    });
    if (k) seen.add(k);
    added++;
  }
  sortTx(state);
  return { added, dup, uncat, auto };
}

function sortTx(state) {
  state.transactions.sort((a, b) => (b.date.localeCompare(a.date)) || ((+b.omzet || 0) - (+a.omzet || 0)));
}

function setTxCat(t, cat) {
  if (t.splits && t.splits.length) { for (const p of t.splits) if (p.cat === UNCAT) p.cat = cat; if (t.splitRule && (t.splitBase === UNCAT || !t.splitBase)) t.splitBase = cat; const big = t.splits.slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]; t.cat = big.cat; }
  else t.cat = cat;
}
function applyRules(state) {
  let n = 0; const learned = learnedMap(state);
  for (const t of budgetTx(state)) if (t.cat === UNCAT) {
    let c = categorize(t.search || (t.raw + " " + t.desc + " " + (t.counterparty || "")), state.rules);
    if (c === UNCAT) c = learned.get(merchantKey(t)) || UNCAT;
    if (c !== UNCAT) { setTxCat(t, c); n++; }
  }
  return n;
}
/* Te categoriseren transacties gegroepeerd per handelaar. */
function uncatGroups(state, ym) {
  const g = new Map();
  for (const t of budgetTx(state)) {
    if (t.cat !== UNCAT || (ym && !t.date.startsWith(ym))) continue;
    const k = merchantKey(t);
    if (!g.has(k)) g.set(k, { key: k, label: t.desc.replace(/\s*·.*$/, ""), count: 0, total: 0, ids: [], sample: t.desc });
    const amt = t.splits && t.splits.length ? t.splits.filter(p => p.cat === UNCAT).reduce((a, p) => a + p.amount, 0) : t.amount;
    const x = g.get(k); x.count++; x.total = Math.round((x.total + amt) * 100) / 100; x.ids.push(t.id);
  }
  return [...g.values()].sort((a, b) => b.count - a.count || Math.abs(b.total) - Math.abs(a.total));
}

/* Kennis van bekende Belgische bedrijven: [trefwoord, categorie, type].
   Wordt alleen gebruikt om regels VOOR TE STELLEN; de gebruiker keurt ze goed. */
const RULE_HINTS = [
  ["SalaryPayment", "Loon", "Inkomen"], ["Groeipakket", "Andere inkomsten", "Inkomen"], ["Kinderbijslag", "Andere inkomsten", "Inkomen"],
  ["Kostenafrekening", "Bankkosten", "Vaste kosten"],
  ["Cofidis", "Lening / krediet", "Vaste kosten"], ["Buy Way", "Lening / krediet", "Vaste kosten"], ["Alpha Credit", "Lening / krediet", "Vaste kosten"],
  ["Proximus", "Internet & gsm", "Vaste kosten"], ["Telenet", "Internet & gsm", "Vaste kosten"], ["Orange Belgium", "Internet & gsm", "Vaste kosten"], ["Mobile Vikings", "Internet & gsm", "Vaste kosten"], ["Scarlet", "Internet & gsm", "Vaste kosten"], ["VOO ", "Internet & gsm", "Vaste kosten"],
  ["Engie", "Energie & water", "Vaste kosten"], ["Luminus", "Energie & water", "Vaste kosten"], ["Eneco", "Energie & water", "Vaste kosten"], ["Fluvius", "Energie & water", "Vaste kosten"], ["Farys", "Energie & water", "Vaste kosten"], ["Watergroep", "Energie & water", "Vaste kosten"], ["Pidpa", "Energie & water", "Vaste kosten"], ["Water-link", "Energie & water", "Vaste kosten"],
  ["AG Insurance", "Verzekeringen", "Vaste kosten"], ["Ethias", "Verzekeringen", "Vaste kosten"], ["Baloise", "Verzekeringen", "Vaste kosten"], ["Allianz", "Verzekeringen", "Vaste kosten"], ["Vivium", "Verzekeringen", "Vaste kosten"], ["DVV ", "Verzekeringen", "Vaste kosten"], ["Mutualiteit", "Verzekeringen", "Vaste kosten"], ["Helan", "Verzekeringen", "Vaste kosten"], ["Solidaris", "Verzekeringen", "Vaste kosten"], ["Partenamut", "Verzekeringen", "Vaste kosten"],
  ["Netflix", "Abonnementen", "Vaste kosten"], ["Spotify", "Abonnementen", "Vaste kosten"], ["Disney", "Abonnementen", "Vaste kosten"], ["Prime Video", "Abonnementen", "Vaste kosten"], ["Streamz", "Abonnementen", "Vaste kosten"], ["Apple.com", "Abonnementen", "Vaste kosten"], ["YouTube", "Abonnementen", "Vaste kosten"],
  ["Delhaize", "Boodschappen", "Variabele kosten"], ["Colruyt", "Boodschappen", "Variabele kosten"], ["Aldi", "Boodschappen", "Variabele kosten"], ["Lidl", "Boodschappen", "Variabele kosten"], ["Carrefour", "Boodschappen", "Variabele kosten"], ["Albert Heijn", "Boodschappen", "Variabele kosten"], ["Jumbo", "Boodschappen", "Variabele kosten"], ["Intermarch", "Boodschappen", "Variabele kosten"], ["Okay ", "Boodschappen", "Variabele kosten"], ["Bio-Planet", "Boodschappen", "Variabele kosten"], ["Kruidvat", "Boodschappen", "Variabele kosten"],
  ["NMBS", "Vervoer", "Variabele kosten"], ["SNCB", "Vervoer", "Variabele kosten"], ["De Lijn", "Vervoer", "Variabele kosten"], ["STIB", "Vervoer", "Variabele kosten"], ["Shell", "Vervoer", "Variabele kosten"], ["TotalEnergies", "Vervoer", "Variabele kosten"], ["Esso", "Vervoer", "Variabele kosten"], ["Lukoil", "Vervoer", "Variabele kosten"], ["Texaco", "Vervoer", "Variabele kosten"], ["DATS 24", "Vervoer", "Variabele kosten"], ["Interparking", "Vervoer", "Variabele kosten"], ["Q-Park", "Vervoer", "Variabele kosten"],
  ["McDonald", "Lunch & uit eten", "Variabele kosten"], ["Burger King", "Lunch & uit eten", "Variabele kosten"], ["Starbucks", "Lunch & uit eten", "Variabele kosten"], ["Exki", "Lunch & uit eten", "Variabele kosten"], ["Panos", "Lunch & uit eten", "Variabele kosten"], ["Domino", "Lunch & uit eten", "Variabele kosten"], ["Deliveroo", "Lunch & uit eten", "Variabele kosten"], ["Takeaway", "Lunch & uit eten", "Variabele kosten"], ["Frituur", "Lunch & uit eten", "Variabele kosten"],
  ["Zara", "Kleding", "Variabele kosten"], ["H&M", "Kleding", "Variabele kosten"], ["Primark", "Kleding", "Variabele kosten"], ["C&A", "Kleding", "Variabele kosten"], ["JBC", "Kleding", "Variabele kosten"], ["Zalando", "Kleding", "Variabele kosten"], ["Zeeman", "Kleding", "Variabele kosten"],
  ["Apotheek", "Gezondheid", "Variabele kosten"], ["Pharmacie", "Gezondheid", "Variabele kosten"], ["Multipharma", "Gezondheid", "Variabele kosten"], ["Tandarts", "Gezondheid", "Variabele kosten"],
  ["Decathlon", "Vrije tijd & hobby", "Variabele kosten"], ["Kinepolis", "Vrije tijd & hobby", "Variabele kosten"], ["Fnac", "Vrije tijd & hobby", "Variabele kosten"], ["MediaMarkt", "Vrije tijd & hobby", "Variabele kosten"], ["Coolblue", "Vrije tijd & hobby", "Variabele kosten"], ["Steam", "Vrije tijd & hobby", "Variabele kosten"], ["PlayStation", "Vrije tijd & hobby", "Variabele kosten"],
  ["Bol.com", "Diversen", "Variabele kosten"], ["Amazon", "Diversen", "Variabele kosten"], ["IKEA", "Diversen", "Variabele kosten"], ["Action ", "Diversen", "Variabele kosten"], ["HEMA", "Diversen", "Variabele kosten"],
];

/* Zoektekst van een transactie zoals de regels hem zien (kleine letters). */
function ruleText(t) { return (t.search || ((t.raw || "") + " " + (t.desc || "") + " " + (t.counterparty || ""))).toLowerCase(); }

/* Woorden die niets zeggen over wie de tegenpartij is. */
const RULE_STOP = new Set(["van", "naar", "betaling", "bancontact", "maestro", "debit", "mastercard", "visa", "domiciliëring", "domiciliering", "europese", "overschrijving", "instantoverschrijving", "sepa", "nv", "bv", "bvba", "sa", "srl"]);

/* Zoekt een leesbaar trefwoord dat in ALLE gegeven transacties voorkomt. */
function ruleKeyword(txs) {
  const base = String(txs[0].desc || "").split(" · ")[0].replace(/\s*\([^)]*\)\s*$/, "");
  const words = base.split(/\s+/).filter(w => w && !/\d/.test(w) && !RULE_STOP.has(w.toLowerCase()));
  const texts = txs.map(ruleText);
  const fits = k => k.length >= 3 && texts.every(x => x.includes(k.toLowerCase()));
  for (let n = Math.min(words.length, 4); n >= 1; n--) {
    const k = words.slice(0, n).join(" ");
    if (fits(k)) return k;
  }
  const cp = txs[0].counterparty;                   // terugval: rekeningnummer van de tegenpartij
  if (cp && txs.every(t => t.counterparty === cp)) return cp;
  return null;
}

/* Analyseert de transacties en stelt nieuwe regels voor. Verandert niets aan de state.
   Geeft [{keyword, cat, type, isNew, source, count, total, example}] met source:
   "geleerd" (uit je eigen keuzes), "bekend" (bekend bedrijf), "terugkerend" (kies zelf een categorie). */
function suggestRules(state) {
  const cats = new Map(state.categories.map(c => [c.name, c.type]));
  const have = new Set(state.rules.map(r => (r.keyword || "").toLowerCase()).filter(Boolean));
  const free = budgetTx(state).filter(t => categorize(ruleText(t), state.rules) === UNCAT);   // nog door geen regel gevangen
  const out = [], taken = new Set();
  const add = (keyword, cat, type, source, txs) => {
    const k = keyword.toLowerCase(); if (have.has(k)) return;
    const prev = out.find(o => o.keyword.toLowerCase() === k); if (prev) return;
    txs.forEach(t => taken.add(t));
    out.push({ keyword, cat, type: cat ? (cats.get(cat) || type) : "", isNew: !!cat && !cats.has(cat), source,
      count: txs.length, total: Math.round(txs.reduce((a, t) => a + t.amount, 0) * 100) / 100, example: txs[0].desc });
  };
  const byKey = list => { const m = new Map(); for (const t of list) { const k = merchantKey(t); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return m; };
  // 1. geleerd: zelfde tegenpartij, minstens 2 keer, altijd dezelfde categorie
  for (const txs of byKey(free.filter(t => t.cat !== UNCAT && !(t.splits && t.splits.length))).values()) {
    if (txs.length < 2 || new Set(txs.map(t => t.cat)).size !== 1) continue;
    const kw = ruleKeyword(txs); if (kw) add(kw, txs[0].cat, "", "geleerd", txs);
  }
  // 2. bekende bedrijven
  const open = free.filter(t => t.cat === UNCAT && !taken.has(t));
  for (const [kw, cat, type] of RULE_HINTS) {
    const txs = open.filter(t => !taken.has(t) && ruleText(t).includes(kw.toLowerCase()));
    if (txs.length) add(kw.trim(), cat, type, "bekend", txs);
  }
  // 3. terugkerend maar onbekend: zelf een categorie kiezen
  for (const txs of byKey(open.filter(t => !taken.has(t))).values()) {
    if (txs.length < 2) continue;
    const kw = ruleKeyword(txs); if (kw) add(kw, "", "", "terugkerend", txs);
  }
  const rank = { geleerd: 0, bekend: 1, terugkerend: 2 };
  return out.sort((a, b) => rank[a.source] - rank[b.source] || b.count - a.count);
}

/* Controleert een back-up (geparste JSON) vóór hij teruggezet wordt. Verandert niets.
   Geeft { ok, error, warnings[], summary{...} }. Werkt voor back-ups uit de claude.ai-versie (v1.0) en uit de app. */
function checkBackup(data) {
  const fail = error => ({ ok: false, error, warnings: [], summary: null });
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail("Dit bestand bevat geen back-up van de Budgetplanner.");
  if (data.k && data.goals && data.tx && !data.transactions) return fail("Dit is de gsm-samenvatting (budgetplanner-mobiel), geen volledige back-up. Kies het bestand budgetplanner-backup….json.");
  if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) return fail("Dit bestand bevat geen back-up van de Budgetplanner: transacties of categorieën ontbreken.");
  const warnings = [];
  const okTx = data.transactions.filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date || "") && typeof t.amount === "number" && isFinite(t.amount));
  const bad = data.transactions.length - okTx.length;
  if (bad && bad > data.transactions.length * 0.05) return fail(`${bad} van de ${data.transactions.length} transacties zijn onleesbaar (geen geldige datum of bedrag). Het bestand is waarschijnlijk beschadigd.`);
  if (bad) warnings.push(`${bad} onleesbare transactie${bad === 1 ? "" : "s"} word${bad === 1 ? "t" : "en"} overgeslagen.`);
  const cats = new Set(data.categories.map(c => c && c.name).filter(Boolean));
  const unknownCats = [...new Set(okTx.map(t => t.cat).filter(c => c && c !== UNCAT && c !== SAV_CAT && !cats.has(c)))];
  if (unknownCats.length) warnings.push(`${unknownCats.length} categorie${unknownCats.length === 1 ? "" : "ën"} in transacties sta${unknownCats.length === 1 ? "at" : "an"} niet in de lijst (${unknownCats.slice(0, 3).join(", ")}${unknownCats.length > 3 ? "…" : ""}).`);
  const dates = okTx.map(t => t.date).sort();
  const accs = Object.values(data.accounts || {});
  const len = k => Array.isArray(data[k]) ? data[k].length : 0;
  const summary = {
    exportedAt: data.exportedAt || null,
    from: dates[0] || null, to: dates[dates.length - 1] || null,
    transactions: okTx.length, skipped: bad,
    uncat: okTx.filter(t => t.cat === UNCAT).length,
    categories: data.categories.length, rules: len("rules"), splitRules: len("splitRules"),
    goals: len("goals"), loans: len("loans"), credits: len("credits"), plans: len("plans"),
    accounts: accs.length, savingsAccounts: accs.filter(a => a && a.type === "spaar").length,
    pin: !!(data.pin && data.pin.hash),
    fromClaude: !!data.cloud,
  };
  return { ok: true, error: null, warnings, summary };
}
/* Maakt een back-up klaar om terug te zetten: onleesbare transacties eruit, oude claude.ai-instellingen weg. */
function cleanBackup(data) {
  const st = JSON.parse(JSON.stringify(data));
  st.transactions = st.transactions.filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date || "") && typeof t.amount === "number" && isFinite(t.amount));
  delete st.cloud;        // OneDrive via de Claude-koppeling bestaat niet in de app
  delete st.exportedAt;
  return st;
}

/* ---------- rekeningen (stap 8) ---------- */
const MAX_ZICHT = 5;
/* Zelfde rekening, met of zonder spaties/kleine letters → bestaande sleutel; anders de ruwe waarde. */
function accKey(state, raw) {
  const n = normIban(raw); if (!n) return raw;
  const hit = Object.keys(state.accounts || {}).find(k => normIban(k) === n);
  return hit || raw;
}
function zichtList(state) { return Object.keys(state.accounts || {}).filter(k => state.accounts[k].type === "zicht"); }
function spaarList(state) {
  const l = Object.keys(state.accounts || {}).filter(k => state.accounts[k].type === "spaar");
  const ib = state.savings && state.savings.iban;
  if (ib && !l.some(k => normIban(k) === normIban(ib))) l.push(ib);
  return l;
}
function fmtIban(a) { return normIban(a).replace(/(.{4})/g, "$1 ").trim(); }
function accName(state, acc) { const a = state.accounts && state.accounts[accKey(state, acc)]; return (a && a.name) || fmtIban(acc); }

/* ---------- overboekingen tussen eigen zichtrekeningen (stap 8c-1) ----------
   Een transactie waarvan de tegenpartij een van je eigen zichtrekeningen is, is geen inkomen of uitgave
   maar een verplaatsing. Geeft de sleutel van die andere rekening terug, of null. */
const OWN_CAT = "Eigen rekeningen";
function ownTransfer(state, t) {
  if (!t || !t.counterparty || !t.account) return null;
  const cp = normIban(t.counterparty); if (!cp || cp === normIban(t.account)) return null;
  return zichtList(state).find(k => normIban(k) === cp) || null;
}
/* Te categoriseren eigen overboekingen → categorie OWN_CAT (type Overboeking, wordt zo nodig aangemaakt).
   Overboekingen die de gebruiker zelf al een andere (niet-overboeking) categorie gaf, worden NIET veranderd. */
function applyOwnTransfers(state) {
  const own = budgetTx(state).filter(t => !(t.splits && t.splits.length) && ownTransfer(state, t));
  let set = 0;
  for (const t of own) if (t.cat === UNCAT) {
    if (!state.categories.some(x => x.name === OWN_CAT)) state.categories.push({ name: OWN_CAT, type: "Overboeking", budget: null });
    t.cat = OWN_CAT; set++;
  }
  return set;
}
/* ---------- kredietkaarten (stap 8c-4) ----------
   state.cards = [{ id, name, keyword, cat }]. De maandelijkse afrekening op een zichtrekening wordt herkend aan het
   trefwoord. Zolang de losse aankopen niet ingelezen worden, telt de afrekening als UITGAVE (categorie van de kaart),
   anders zouden die uitgaven uit het budget verdwijnen. Verdelen kan met Splitsen. */
function cardMatch(state, t) {
  if (!t || !(t.amount < 0)) return null;
  const x = ruleText(t);
  return (state.cards || []).find(k => k.keyword && x.includes(k.keyword.toLowerCase())) || null;
}
function applyCards(state) {
  let n = 0;
  for (const t of budgetTx(state)) if (t.cat === UNCAT && !(t.splits && t.splits.length)) { const k = cardMatch(state, t); if (k && k.cat) { t.cat = k.cat; n++; } }
  return n;
}
/* Stromen tussen eigen zichtrekeningen in een maand: [{from, to, total, count}] (stap 8c-2).
   Telt de uitgaande kant; een inkomende enkel als de verzendende rekening die maand niet ingelezen is. */
function transferFlows(state, ym) {
  const tx = budgetTx(state).filter(t => t.date.startsWith(ym)), seen = new Set(tx.map(t => normIban(t.account))), m = new Map();
  for (const t of tx) {
    const o = ownTransfer(state, t); if (!o) continue;
    let from, to;
    if (t.amount < 0) { from = accKey(state, t.account); to = o; }
    else { if (seen.has(normIban(o))) continue; from = o; to = accKey(state, t.account); }
    const k = from + ">" + to, x = m.get(k) || { from, to, total: 0, count: 0 };
    x.total += Math.abs(t.amount); x.count++; m.set(k, x);
  }
  return [...m.values()].map(x => Object.assign(x, { total: Math.round(x.total * 100) / 100 })).sort((a, b) => b.total - a.total);
}
/* Eigen overboekingen met een categorie die geen overboeking is (tellen dan dubbel). */
function ownConflicts(state) { return budgetTx(state).filter(t => ownTransfer(state, t) && t.cat !== UNCAT && typeOf(state, t.cat) !== "Overboeking" && !(t.splits && t.splits.length)); }

function typeOf(state, cat) {
  const c = state.categories.find(x => x.name === cat);
  return c ? c.type : "Onbekend";
}

function monthKey(d) { return d.slice(0, 7); }
/* Een gesplitste transactie telt als meerdere delen met elk hun categorie. */
function expandTx(list) { const out = []; for (const t of list) { if (t.splits && t.splits.length) for (const s of t.splits) out.push(Object.assign({}, t, { cat: s.cat, amount: s.amount })); else out.push(t); } return out; }

/* Samenvatting voor één maand ("YYYY-MM"). Uitgaven en sparen positief uitgedrukt. */
function monthSummary(state, ym) {
  const tx = expandTx(budgetTx(state).filter(t => monthKey(t.date) === ym));
  const s = { transfer: 0, income: 0, fixed: 0, variable: 0, saved: 0, uncat: 0, uncatCount: 0, net: 0, byCat: {}, byCatRaw: {}, count: tx.length };
  for (const t of tx) {
    const ty = typeOf(state, t.cat);
    s.net += t.amount;
    if (ty === "Inkomen") s.income += t.amount;
    else if (ty === "Vaste kosten") s.fixed -= t.amount;
    else if (ty === "Variabele kosten") s.variable -= t.amount;
    else if (ty === "Sparen") s.saved -= t.amount;
    else if (ty === "Overboeking") { s.transfer = (s.transfer || 0) + t.amount; }
    else { s.uncat += t.amount; s.uncatCount++; }
    const gk = groupOf(state, t.cat);
    s.byCat[gk] = (s.byCat[gk] || 0) + t.amount;
    s.byCatRaw[t.cat] = (s.byCatRaw[t.cat] || 0) + t.amount;
  }
  for (const k of ["income", "fixed", "variable", "saved", "uncat", "net"]) s[k] = Math.round(s[k] * 100) / 100;
  s.expenses = Math.round((s.fixed + s.variable) * 100) / 100;
  return s;
}

function goalProgress(state, g) { return withSav(state, goalSav(state, g), () => goalProgressOne(state, g)); }
function goalProgressOne(state, g) {
  const deposited = Math.round(savMoves(state).filter(m => m.goal === g.name).reduce((s, m) => s + m.effect, 0) * 100) / 100;
  const total = Math.round(((+g.start || 0) + deposited) * 100) / 100;
  const target = +g.target || 0;
  const left = target ? Math.max(0, target - total) : null;
  let months = null;
  if (g.deadline) { const now = new Date(), d = new Date(g.deadline); months = Math.max(1, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth()); }
  return { deposited, total, target, left, months, perMonth: left !== null && months ? left / months : null, pct: target ? Math.min(1, Math.max(0, total / target)) : null };
}

/* Saldo per rekening op het einde van een maand ("YYYY-MM").
   Startsaldo = saldo op het einde van de dag b.date; transacties daarna tellen mee. */
function endOfMonth(ym) { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m, 0).getDate(); return `${ym}-${String(d).padStart(2, "0")}`; }
function balanceAt(state, ym) {
  const end = endOfMonth(ym); const per = [];
  for (const b of (state.balances || [])) {
    if (isSavAcc(state, b.account)) continue;
    if (!b.date || b.amount === null || b.amount === undefined || b.amount === "") continue;
    const acc = state.transactions.filter(t => (t.account || "") === (b.account || ""));
    // na de saldodatum optellen, ervoor terugrekenen
    const fwd = acc.filter(t => t.date > b.date && t.date <= end).reduce((a, t) => a + t.amount, 0);
    const back = acc.filter(t => t.date > end && t.date <= b.date).reduce((a, t) => a + t.amount, 0);
    per.push({ account: b.account, value: Math.round((+b.amount + fwd - back) * 100) / 100, before: end < b.date });
  }
  return { set: per.length > 0, total: Math.round(per.reduce((a, p) => a + p.value, 0) * 100) / 100, per };
}
function accounts(state) { return [...new Set(state.transactions.map(t => t.account).filter(a => a && !isSavAcc(state, a)))]; }

/* ---------- budget meenemen (enveloppen) ---------- */
function rolls(c) { return c.rollover === undefined ? (c.type === "Variabele kosten" || +c.budgetYear > 0) : !!c.rollover; }
/* Maandbudget = budget per maand + budget per jaar / 12. Jaarbudget = budget per maand × 12 + budget per jaar. */
/* ---------- deelbudgetten (stap 8e) ----------
   Een categorie met group: true is een deelbudget (zoals een subsamenstelling): in het hoofdbudget één regel.
   Subcategorieën hebben parent: "<naam deelbudget>" en hetzelfde type. Hun uitgaven "rollen op" naar het deelbudget,
   hun eigen budget telt NIET apart mee in het hoofdbudget (anders dubbel). */
function catByName(state, name) { return state.categories.find(c => c.name === name) || null; }
function parentOf(state, name) { const c = catByName(state, name); return c && c.parent && catByName(state, c.parent) ? c.parent : null; }
function groupOf(state, name) { return parentOf(state, name) || name; }
function mainCats(state) { return state.categories.filter(c => !(c.parent && catByName(state, c.parent))); }
function subsOf(state, name) { return state.categories.filter(c => c.parent === name); }
function monthlyBudget(c) { return (+c.budget || 0) + (+c.budgetYear || 0) / 12; }
function yearlyBudget(c) { return (+c.budget || 0) * 12 + (+c.budgetYear || 0); }
function firstMonth(state) {
  const tx = budgetTx(state); if (!tx.length) return null;
  return tx.reduce((m, t) => (t.date < m ? t.date : m), "9999").slice(0, 7);
}
/* Vanaf welke maand overschotten/tekorten worden opgebouwd: de instelling, maar nooit vóór je eerste gegevens. */
function rolloverStart(state) {
  const f = firstMonth(state); if (!f) return null;
  const from = state.rolloverFrom || (new Date().getFullYear() + "-01");
  return from > f ? from : f;
}
function nextYm(ym) { let [y, m] = ym.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return y + "-" + String(m).padStart(2, "0"); }
function spentMap(state) {
  const m = new Map();
  for (const t of expandTx(budgetTx(state))) {
    const ym = t.date.slice(0, 7), k = groupOf(state, t.cat) + "|" + ym, r = "raw:" + t.cat + "|" + ym;
    m.set(k, (m.get(k) || 0) - t.amount); m.set(r, (m.get(r) || 0) - t.amount);
  }
  return m;
}
/* Per uitgavencategorie voor maand ym: budget, overgedragen (carryIn), beschikbaar, uitgegeven, over (carryOut). */
function envelopes(state, ym, _spent) {
  const spent = _spent || spentMap(state), start = rolloverStart(state), out = {};
  for (const c of state.categories) {
    if (c.type !== "Vaste kosten" && c.type !== "Variabele kosten") continue;
    const sk = c.parent && catByName(state, c.parent) ? "raw:" : "";
    const budget = Math.round(monthlyBudget(c) * 100) / 100, roll = rolls(c) && budget > 0;
    let carry = 0;
    if (roll && start && start < ym) for (let m = start; m < ym; m = nextYm(m)) carry = carry + budget - (spent.get(sk + c.name + "|" + m) || 0);
    carry = Math.round(carry * 100) / 100;
    const s = Math.round((spent.get(sk + c.name + "|" + ym) || 0) * 100) / 100;
    const available = Math.round((budget + carry) * 100) / 100;
    out[c.name] = { budget, roll, carryIn: carry, available, spent: s, carryOut: roll ? Math.round((available - s) * 100) / 100 : 0 };
  }
  return out;
}
function yearSummary(state, year) {
  const spent = spentMap(state), months = [], start = rolloverStart(state);
  for (let i = 1; i <= 12; i++) {
    const ym = year + "-" + String(i).padStart(2, "0");
    const s = monthSummary(state, ym), env = envelopes(state, ym, spent);
    const now = new Date(), cur = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const inRange = start && ym >= start && ym <= cur;
    const buffer = Object.values(env).filter(e => e.roll).reduce((a, e) => a + e.carryOut, 0);
    months.push({ ym, s, buffer: inRange ? Math.round(buffer * 100) / 100 : null, hasData: s.count > 0 });
  }
  const tot = { income: 0, expenses: 0, saved: 0, net: 0, uncat: 0 };
  for (const m of months) { tot.income += m.s.income; tot.expenses += m.s.expenses + Math.max(0, -m.s.uncat); tot.saved += m.s.saved; tot.net += m.s.net; tot.uncat += m.s.uncatCount; }
  for (const k in tot) tot[k] = Math.round(tot[k] * 100) / 100;
  return { months, tot, activeMonths: months.filter(m => m.hasData).length };
}

/* ---------- leningen ---------- */
function ymOf(d) { return d.slice(0, 7); }
function ymDiff(a, b) { const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number); return (yb - ya) * 12 + (mb - ma); }
function addMonths(ym, n) { let [y, m] = ym.split("-").map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return y + "-" + String(m).padStart(2, "0"); }
function kwList(s) { return String(s || "").split(/[,;]/).map(k => k.trim().toLowerCase()).filter(Boolean); }
function loanPayments(state, loan) {
  const ks = kwList(loan.keyword);
  if (!ks.length) return [];
  return state.transactions.filter(t => t.amount < 0 && ks.some(k => ((t.search || "") + " " + (t.raw || "") + " " + (t.desc || "")).toLowerCase().includes(k)))
    .sort((a, b) => a.date.localeCompare(b.date));
}
/* Rekent saldo vanaf het opgegeven saldo (op balanceDate) verder met de gekoppelde betalingen,
   en projecteert daarna met het maandbedrag tot afbetaling. */
function loanStatus(state, loan, todayStr) {
  const today = todayStr || new Date().toISOString().slice(0, 10);
  const r = loan.rate ? Math.pow(1 + loan.rate / 100, 1 / 12) - 1 : 0;
  const pays = loanPayments(state, loan);
  const res = { payments: pays, ok: false, current: null, paidSince: 0, interestSince: 0, payoffYm: null, monthsLeft: null, interestLeft: null, schedule: [], never: false, lastPayment: pays.length ? pays[pays.length - 1] : null, monthly: +loan.monthly || (pays.length ? -pays[pays.length - 1].amount : 0) };
  if (loan.balance === null || loan.balance === undefined || loan.balance === "" || !loan.balanceDate) return res;
  let B = +loan.balance; const startYm = ymOf(loan.balanceDate);
  res.schedule.push({ ym: startYm, balance: B, actual: true });
  let lastYm = startYm;
  for (const p of pays) {
    if (p.date <= loan.balanceDate) continue;
    const pm = ymOf(p.date), gap = Math.max(1, ymDiff(lastYm, pm));
    const interest = B * (Math.pow(1 + r, gap) - 1);
    B = B + interest + p.amount; res.interestSince += interest; res.paidSince += -p.amount;
    if (pm !== lastYm || res.schedule[res.schedule.length - 1].ym !== pm) res.schedule.push({ ym: pm, balance: Math.max(0, B), actual: true });
    else res.schedule[res.schedule.length - 1].balance = Math.max(0, B);
    lastYm = pm;
  }
  res.current = Math.max(0, Math.round(B * 100) / 100); res.ok = true;
  const curYm = ymOf(today);
  // projectie: eerste projectiemaand = maand na laatste werkelijke betaling (of na saldodatum)
  let ym = lastYm, P = Math.max(0, B), interestLeft = 0, n = 0;
  const pay = res.monthly;
  if (P <= 0.005) { res.payoffYm = lastYm; res.monthsLeft = 0; res.interestLeft = 0; return res; }
  if (!pay || P * r >= pay) { res.never = true; return res; }
  while (P > 0.005 && n < 600) {
    ym = addMonths(ym, 1); n++;
    const i = P * r; interestLeft += i; P = P + i - pay;
    res.schedule.push({ ym, balance: Math.max(0, P), actual: false });
  }
  res.payoffYm = ym; res.monthsLeft = Math.max(0, ymDiff(curYm, ym)); res.interestLeft = Math.round(interestLeft * 100) / 100;
  return res;
}
/* Rente afleiden uit ontleend bedrag, maandaflossing en looptijd (annuïteit). Geeft JKP in %. */
function impliedRate(principal, payment, months) {
  principal = +principal; payment = +payment; months = +months;
  if (!(principal > 0 && payment > 0 && months > 0)) return null;
  if (payment * months <= principal + 0.01) return 0;
  const pv = r => payment * (1 - Math.pow(1 + r, -months)) / r;
  let lo = 1e-9, hi = 0.2;
  if (pv(hi) > principal) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (pv(mid) > principal) lo = mid; else hi = mid; }
  return Math.round((Math.pow(1 + (lo + hi) / 2, 12) - 1) * 10000) / 100;
}
function txRefKey(t) {
  const s = (t.search || t.raw || "");
  let key = (s.match(/Mededeling:\s*([A-Za-z0-9][A-Za-z0-9 \/+.-]{2,40}?)(?:\s{2,}|\s*$|\s+Persoonlijke)/i) || [])[1];
  if (!key) key = (s.match(/Mandaat:\s*(\d{6,})/i) || [])[1];
  if (!key) key = merchantKey(t);
  return key.trim();
}
/* Stelt leningen voor op basis van terugkerende betalingen in een lening-categorie. */
function detectLoans(state) {
  const loanCats = new Set(state.categories.filter(c => /lening|krediet|hypothe/i.test(c.name)).map(c => c.name));
  const groups = new Map();
  for (const t of budgetTx(state)) {
    if (t.amount >= 0 || !loanCats.has(t.cat)) continue;
    const key = txRefKey(t);
    if (!groups.has(key)) groups.set(key, { keyword: key, name: t.desc.replace(/^Domicili[eë]ring\s+/i, "").replace(/\s*·.*$/, ""), count: 0, last: t, ids: [], text: "" });
    const g = groups.get(key); g.count++; g.ids.push(t.id); g.text += " " + (t.search || t.raw || "") + " " + t.desc; if (t.date > g.last.date) g.last = t;
  }
  const used = new Set([...(state.loans || []).flatMap(l => kwList(l.keyword)), ...(state.credits || []).flatMap(creditKeywords)]);
  const linked = new Set([...(state.loans || []).flatMap(l => loanPayments(state, l).map(t => t.id)), ...(state.credits || []).flatMap(cr => creditBankTx(state, cr).map(t => t.id))]);
  const nums = s => (String(s).match(/\d{6,}/g) || []);
  const owners = [...(state.credits || []).map((cr, i) => ({ kind: "credit", i, name: cr.name, kws: creditKeywords(cr) })), ...(state.loans || []).map((l, i) => ({ kind: "loan", i, name: l.name, kws: kwList(l.keyword) }))];
  return [...groups.values()].filter(g => !used.has(g.keyword.toLowerCase()) && !g.ids.every(id => linked.has(id))).map(g => {
    const n = new Set([...nums(g.keyword), ...nums(g.text)]);
    const sug = owners.find(o => o.kws.some(k => nums(k).some(x => n.has(x) || [...n].some(y => y.includes(x) || x.includes(y)))));
    return { ...g, monthly: -g.last.amount, suggest: sug || null };
  });
}

/* ---------- kredieten (potje met limiet, manuele ingaven) ---------- */
const CREDIT_TYPES = {
  opname: { label: "Opname", sign: +1, hint: "Geld uit het krediet gehaald" },
  aflossing: { label: "Aflossing", sign: -1, hint: "Maandelijkse aflossing" },
  storting: { label: "Extra storting", sign: -1, hint: "Zelf bijgestort" },
  rente: { label: "Rente / kosten", sign: +1, hint: "Aangerekende rente of kosten" },
};
function creditKeywords(cr) { return String(cr.keywords || cr.keyword || "").split(/[,;]/).map(k => k.trim().toLowerCase()).filter(Boolean); }
function creditBankTx(state, cr) {
  const kws = creditKeywords(cr); if (!kws.length) return [];
  return state.transactions.filter(t => { const s = ((t.search || "") + " " + (t.raw || "") + " " + (t.desc || "")).toLowerCase(); return kws.some(k => s.includes(k)); });
}
/* Bewegingen: effect = verandering van het opgenomen bedrag (+ meer schuld, − minder schuld). */
function creditMovements(state, cr) {
  const mv = creditBankTx(state, cr).map(t => ({ date: t.date, effect: t.amount, kind: t.amount < 0 ? "aflossing" : "opname", source: "bank", tx: t, desc: t.desc }));
  for (const e of (cr.entries || [])) {
    if (e.txId) continue;                       // oude manuele koppelingen: nu automatisch
    const T = CREDIT_TYPES[e.type]; if (!T) continue;
    mv.push({ date: e.date, effect: T.sign * (+e.amount || 0), kind: e.type, source: "manueel", entry: e, desc: e.note || T.label });
  }
  return mv.sort((a, b) => a.date.localeCompare(b.date) || ((a.entry && a.entry.created) || 0) - ((b.entry && b.entry.created) || 0));
}
function creditStatus(state, cr) {
  const mv = creditMovements(state, cr);
  const limit = +cr.limit || 0;
  const ok = cr.anchorUsed !== null && cr.anchorUsed !== undefined && cr.anchorUsed !== "" && !!cr.anchorDate;
  const now = new Date(), y = String(now.getFullYear()), ym = now.toISOString().slice(0, 7);
  const sum = (pred) => Math.round(mv.filter(pred).reduce((a, m) => a + Math.abs(m.effect), 0) * 100) / 100;
  const res = {
    ok, limit, movements: mv, timeline: [], used: null, available: null, pct: null,
    paidMonth: sum(m => m.effect < 0 && m.date.startsWith(ym)), paidYear: sum(m => m.effect < 0 && m.date.startsWith(y)),
    takenYear: sum(m => m.kind === "opname" && m.date.startsWith(y)), costYear: sum(m => m.kind === "rente" && m.date.startsWith(y)),
    last: mv.length ? mv[mv.length - 1] : null, bankCount: mv.filter(m => m.source === "bank").length, interestEst: null,
  };
  if (!ok) return res;
  const A = +cr.anchorUsed, beforeAnchor = mv.filter(m => m.date <= cr.anchorDate).reduce((a, m) => a + m.effect, 0);
  let cum = 0;
  const first = mv.length ? mv[0].date : cr.anchorDate;
  res.timeline.push({ date: first < cr.anchorDate ? first : cr.anchorDate, used: Math.round((A - beforeAnchor) * 100) / 100, start: true });
  for (const m of mv) { cum += m.effect; res.timeline.push({ date: m.date, used: Math.round((A + cum - beforeAnchor) * 100) / 100, m }); }
  res.timeline.push({ date: cr.anchorDate, used: Math.round((A + mv.filter(m => m.date <= cr.anchorDate).reduce((a, x) => a + x.effect, 0) - beforeAnchor) * 100) / 100, anchor: true });
  res.timeline.sort((a, b) => a.date.localeCompare(b.date) || (a.start ? -1 : 0));
  res.used = Math.round((A + mv.filter(m => m.date > cr.anchorDate).reduce((a, m) => a + m.effect, 0)) * 100) / 100;
  if (limit) { res.available = Math.round((limit - res.used) * 100) / 100; res.pct = Math.min(1, Math.max(0, res.used / limit)); }
  const r = cr.rate ? Math.pow(1 + cr.rate / 100, 1 / 12) - 1 : 0;
  res.interestEst = r ? Math.round(Math.max(0, res.used) * r * 100) / 100 : null;
  return res;
}

/* ---------- spaarrekening (afgeleid uit de zichtrekening) ---------- */
/* ---------- meerdere spaarrekeningen (stap 8d) ----------
   state.savings = de eerste spaarrekening (zoals altijd), state.savingsMore = de andere, elk { iban, anchor, entries, pending, transfers }.
   De spaarfuncties hieronder rekenen telkens voor ÉÉN "actieve" spaarrekening (SAV_ACTIVE = rekeningnummer zonder spaties).
   withSav() zet die tijdelijk; savAll() telt alle spaarrekeningen samen. Een doel hoort bij g.sav (leeg = de eerste). */
let SAV_ACTIVE = "";
function emptySav(iban) { return { iban: iban || "", anchor: null, entries: [], pending: [], transfers: [] }; }
function fixSav(s) { s.entries = s.entries || []; s.pending = s.pending || []; s.transfers = s.transfers || []; return s; }
function syncSavConfs(state) {
  if (!state.savings) state.savings = emptySav(); fixSav(state.savings);
  state.savingsMore = (state.savingsMore || []).map(fixSav);
  const have = () => [state.savings.iban, ...state.savingsMore.map(x => x.iban)].map(normIban).filter(Boolean);
  // een spaarrekening die enkel als rekeningnummer op het tabblad Spaar stond, krijgt ook een plaats in de rekeningenlijst (naam aanpasbaar in Profiel)
  state.accounts = state.accounts || {};
  for (const sc of [state.savings, ...state.savingsMore]) { const n = normIban(sc.iban); if (n && !Object.keys(state.accounts).some(k => normIban(k) === n)) state.accounts[fmtIban(n)] = { type: "spaar", name: "Spaarrekening" }; }
  for (const k of Object.keys(state.accounts || {})) {
    if (state.accounts[k].type !== "spaar" || have().includes(normIban(k))) continue;
    if (!normIban(state.savings.iban)) state.savings.iban = k; else state.savingsMore.push(emptySav(k));
  }
}
function savKeys(state) { syncSavConfs(state); return [normIban(state.savings.iban), ...state.savingsMore.map(x => normIban(x.iban))]; }
function activeSav(state) { const keys = savKeys(state); return keys.includes(SAV_ACTIVE) ? SAV_ACTIVE : keys[0]; }
function setSav(key) { SAV_ACTIVE = normIban(key); }
function withSav(state, key, fn) { const keep = SAV_ACTIVE; SAV_ACTIVE = normIban(key); try { return fn(); } finally { SAV_ACTIVE = keep; } }
function goalSav(state, g) { const keys = savKeys(state), k = normIban(g && g.sav); return k && keys.includes(k) ? k : keys[0]; }
function savGoals(state) { const k = activeSav(state); return state.goals.filter(g => goalSav(state, g) === k); }
function savConf(state) {
  syncSavConfs(state); const k = activeSav(state);
  if (k === normIban(state.savings.iban)) return state.savings;
  return state.savingsMore.find(x => normIban(x.iban) === k) || state.savings;
}
function normIban(x) { return String(x || "").replace(/\s/g, "").toUpperCase(); }
function makeRef(name, taken) {
  let base = "SP-" + String(name || "DOEL").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "").slice(0, 12);
  let ref = base, i = 2; while (taken.has(ref)) ref = base + i++;
  return ref;
}
function ensureGoalRefs(state) { const taken = new Set(state.goals.map(g => g.ref).filter(Boolean)); for (const g of state.goals) if (!g.ref) { g.ref = makeRef(g.name, taken); taken.add(g.ref); } }
function txText(t) { return ((t.search || "") + " " + (t.raw || "") + " " + (t.desc || "")).toUpperCase(); }
function refGoal(state, t) { const s = txText(t); const g = state.goals.find(g => g.ref && s.includes(g.ref.toUpperCase())); return g ? g.name : null; }
function isSavMove(state, t) {
  const sc = savConf(state), ib = normIban(sc.iban);
  if (ib && normIban(t.counterparty) === ib) return true;
  if (ib && txText(t).replace(/\s/g, "").includes(ib)) return true;
  const gs = savGoals(state), s = txText(t);
  if (gs.some(g => g.ref && s.includes(g.ref.toUpperCase()))) return true;
  return gs.some(g => g.name === t.cat);
}
function moveGoal(state, t) {
  if (t.goal !== undefined && t.goal !== null && t.goal !== "") return t.goal;
  if (t.goal === "") return null;               // bewust niet toegewezen
  const gs = savGoals(state), s = txText(t), r = gs.find(g => g.ref && s.includes(g.ref.toUpperCase()));
  return r ? r.name : gs.some(g => g.name === t.cat) ? t.cat : null;
}
/* Alle bewegingen op de spaarrekening: uit je zichtrekening (effect = −bedrag) en manuele ingaven (rente, premies, correcties). */
function savMoves(state) {
  const sc = savConf(state);
  const bank = budgetTx(state).filter(t => isSavMove(state, t)).map(t => ({ date: t.date, effect: -t.amount, goal: moveGoal(state, t), src: "bank", t, checked: !!t.savChecked, auto: !(t.goal) }));
  const man = sc.entries.map(e => ({ date: e.date, effect: +e.amount, goal: e.goal || null, src: "manueel", e, checked: true, auto: false }));
  // verplaatsingen tussen spaardoelen: twee delen die samen 0 zijn, het saldo verandert niet
  const tr = sc.transfers.flatMap(x => [{ date: x.date, effect: -x.amount, goal: x.from, src: "transfer", leg: "out", e: x, checked: true, auto: false }, { date: x.date, effect: +x.amount, goal: x.to, src: "transfer", leg: "in", e: x, checked: true, auto: false }]);
  return [...bank, ...man, ...tr].sort((a, b) => b.date.localeCompare(a.date));
}
function hasSavingsOne(state) { const sc = savConf(state); return !!(sc.iban || sc.anchor || sc.entries.length || savMoves(state).length); }
function hasSavings(state) { return savKeys(state).some(k => withSav(state, k, () => hasSavingsOne(state))); }
function moveId(m) { return m.src === "bank" ? m.t.id : m.src === "transfer" ? m.e.id + "|" + m.leg : m.e.id; }
/* Telt een beweging al mee in het afgestemde saldo? Vóór de afstemdatum: ja. Op dezelfde dag: alleen als ze al bekend was
   toen je afstemde (anders is ze daarna gebeurd of later geïmporteerd). */
function inAnchor(anchor, m) {
  if (m.date < anchor.date) return true;
  if (m.date > anchor.date) return false;
  return !!(anchor.included && anchor.included.includes(moveId(m)));
}
function savingsBalance(state) {
  const sc = savConf(state), mv = savMoves(state).slice().reverse();     // oud -> nieuw
  const set = !!(sc.anchor && sc.anchor.date && sc.anchor.amount !== null && sc.anchor.amount !== undefined && sc.anchor.amount !== "");
  if (!set) return { set: false, total: null, history: [] };
  const an = sc.anchor, A = +an.amount;
  const before = mv.filter(m => inAnchor(an, m)).reduce((s, m) => s + m.effect, 0);
  const total = Math.round((A + mv.filter(m => !inAnchor(an, m)).reduce((s, m) => s + m.effect, 0)) * 100) / 100;
  let run = A - before; const hist = [{ date: mv.length && mv[0].date <= an.date ? addDays(mv[0].date, -1) : an.date, value: Math.round(run * 100) / 100 }];
  // eerst alles wat in het afgestemde saldo zit, dan de rest (op dezelfde dag in die volgorde)
  const ordered = mv.slice().sort((x, y) => x.date.localeCompare(y.date) || (inAnchor(an, y) - inAnchor(an, x)));
  for (const m of ordered) { run += m.effect; const v = Math.round(run * 100) / 100; const last = hist[hist.length - 1]; if (last.date === m.date) last.value = v; else hist.push({ date: m.date, value: v }); }
  return { set, total, history: hist };
}
function savingsSummary(state) {
  const bal = savingsBalance(state), mv = savMoves(state);
  const goals = savGoals(state).map(g => ({ g, p: goalProgress(state, g) }));
  const allocated = Math.round(goals.reduce((s, x) => s + x.p.total, 0) * 100) / 100;
  const y = String(new Date().getFullYear());
  return { bal, goals, moves: mv, allocated, unallocated: bal.set ? Math.round((bal.total - allocated) * 100) / 100 : null,
    open: mv.filter(m => !m.goal && !m.checked).length, toCheck: mv.filter(m => !m.checked).length,
    inYear: mv.filter(m => m.src !== "transfer" && m.date.startsWith(y) && m.effect > 0).reduce((s, m) => s + m.effect, 0),
    outYear: mv.filter(m => m.src !== "transfer" && m.date.startsWith(y) && m.effect < 0).reduce((s, m) => s - m.effect, 0) };
}
/* Alle spaarrekeningen samen (Overzicht, Vermogen, gsm). parts = per spaarrekening { key, s } met s = savingsSummary. */
function savAll(state) {
  const parts = savKeys(state).map(k => ({ key: k, s: withSav(state, k, () => savingsSummary(state)) }));
  const setParts = parts.filter(x => x.s.bal.set), sum = f => Math.round(parts.reduce((a, x) => a + f(x.s), 0) * 100) / 100;
  return { parts,
    bal: { set: setParts.length > 0, total: setParts.length ? Math.round(setParts.reduce((a, x) => a + x.s.bal.total, 0) * 100) / 100 : null },
    goals: parts.flatMap(x => x.s.goals), moves: parts.flatMap(x => x.s.moves.map(m => Object.assign({ sav: x.key }, m))).sort((a, b) => b.date.localeCompare(a.date)),
    allocated: sum(s => s.allocated), unallocated: parts.every(x => x.s.bal.set) ? sum(s => s.unallocated || 0) : null,
    toCheck: sum(s => s.toCheck), open: sum(s => s.open), inYear: sum(s => s.inYear), outYear: sum(s => s.outYear) };
}
/* Geplande opnames/stortingen die intussen in je bankafschrift staan, worden afgevinkt. */
function resolvePending(state) { return savKeys(state).reduce((n, k) => n + withSav(state, k, () => resolvePendingOne(state)), 0); }
function resolvePendingOne(state) {
  const sc = savConf(state), mv = savMoves(state).filter(m => m.src === "bank"); let n = 0;
  sc.pending = sc.pending.filter(p => {
    const hit = mv.find(m => m.goal === p.goal && Math.abs(Math.abs(m.effect) - p.amount) < 0.005 && Math.sign(m.effect) === (p.type === "opname" ? -1 : 1) && m.date >= addDays(p.date, -5));
    if (hit) { n++; return false; } return true;
  });
  return n;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }

/* ---------- planner ---------- */
const REPEATS = { none: "Eenmalig", week: "Wekelijks", month: "Maandelijks", quarter: "Per kwartaal", year: "Jaarlijks" };
function ds(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function pd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
/* n-de herhaling vanaf de startdatum (maanddag blijft behouden, ingekort tot het einde van de maand). */
function stepDate(start, repeat, n) {
  const d = pd(start);
  if (repeat === "week") { d.setDate(d.getDate() + 7 * n); return ds(d); }
  const months = repeat === "month" ? n : repeat === "quarter" ? 3 * n : repeat === "year" ? 12 * n : 0;
  const day = d.getDate(), t = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last)); return ds(t);
}
function planOccurrences(plan, from, to) {
  const out = []; if (!plan.date) return out;
  // onbekende herhaling (bv. uit een vreemde back-up) telt als eenmalig, anders zou ze elke dag terugkomen
  if (!plan.repeat || plan.repeat === "none" || !(plan.repeat in REPEATS)) { if (plan.date >= from && plan.date <= to) out.push(plan.date); return out; }
  for (let n = 0; n < 2000; n++) {
    const d = stepDate(plan.date, plan.repeat, n);
    if (plan.until && d > plan.until) break;
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}
/* Is deze planning op datum d al betaald? Handmatig afgevinkt, of een passende transactie gevonden. */
function occStatus(state, plan, d) {
  const key = plan.id + "|" + d;
  if (plan.done && plan.done[d]) return { paid: true, manual: true, skipped: plan.done[d] === "skip" };
  const lo = ds(new Date(pd(d).getTime() - 6 * 864e5)), hi = ds(new Date(pd(d).getTime() + 8 * 864e5));
  const want = +plan.amount || 0, sign = plan.kind === "inkomst" ? 1 : -1, kw = (plan.match || "").toLowerCase().trim();
  const tx = budgetTx(state).find(t => t.date >= lo && t.date <= hi && Math.sign(t.amount) === sign &&
    (kw ? ((t.search || "") + " " + (t.raw || "") + " " + (t.desc || "")).toLowerCase().includes(kw) || merchantKey(t) === kw : plan.cat ? t.cat === plan.cat : false) &&
    (!want || Math.abs(Math.abs(t.amount) - want) <= Math.max(2, want * 0.15)));
  return tx ? { paid: true, tx } : { paid: false };
}
/* Herkent terugkerende uitgaven (en inkomsten) in je transacties. */
function detectRecurring(state) {
  const groups = new Map();
  for (const t of budgetTx(state)) {
    if (!t.amount || t.cat === "Opname krediet") continue;
    const mandate = ((t.search || "").match(/Mandaat:\s*(\d{6,})/i) || [])[1];
    const k = mandate || merchantKey(t); if (!k) continue;
    const key = k + "|" + (t.amount < 0 ? "-" : "+");
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(t);
  }
  const planned = new Set((state.plans || []).map(p => (p.match || "").toLowerCase()));
  const ignored = new Set(state.ignoredRecurring || []);
  const today = ds(new Date()), out = [];
  for (const [key, list] of groups) {
    if (list.length < 3 || ignored.has(key)) continue;
    const k = key.slice(0, -2); if (planned.has(k)) continue;
    // per maand maar één keer tellen (bv. twee kaartbetalingen dezelfde dag)
    const byDate = [...new Map(list.map(t => [t.date, t])).values()].sort((a, b) => a.date.localeCompare(b.date));
    if (byDate.length < 3) continue;
    const gaps = []; for (let i = 1; i < byDate.length; i++) gaps.push((pd(byDate[i].date) - pd(byDate[i - 1].date)) / 864e5);
    const recent = gaps.slice(-6).sort((a, b) => a - b), med = recent[Math.floor(recent.length / 2)];
    let repeat = null, tol = 4;
    if (med >= 6 && med <= 8) repeat = "week", tol = 2; else if (med >= 26 && med <= 35) repeat = "month", tol = 5; else if (med >= 84 && med <= 98) repeat = "quarter", tol = 10; else if (med >= 350 && med <= 380) repeat = "year", tol = 20;
    if (!repeat) continue;
    const ok = recent.filter(g => Math.abs(g - med) <= tol).length / recent.length;
    if (ok < 0.6) continue;
    const last = byDate[byDate.length - 1];
    const ageDays = (pd(today) - pd(last.date)) / 864e5;
    if (ageDays > med * 2 + tol) continue;          // gestopt
    const amts = byDate.slice(-3).map(t => Math.abs(t.amount)).sort((a, b) => a - b);
    let next = stepDate(last.date, repeat, 1); let n = 1; while (next < today && n < 24) next = stepDate(last.date, repeat, ++n);
    out.push({ key, match: k, account: last.account, title: last.desc.replace(/\s*\(.*$/, "").replace(/\s*·.*$/, "").replace(/^Domicili[eë]ring\s+/i, ""), cat: last.cat, kind: last.amount < 0 ? "uitgave" : "inkomst", amount: Math.round(amts[1] * 100) / 100, repeat, last: last.date, next, count: byDate.length, varies: amts[2] - amts[0] > Math.max(2, amts[1] * 0.1) });
  }
  return out.sort((a, b) => a.next.localeCompare(b.next));
}
/* Alle planner-items tussen from en to: eigen planningen + (optioneel) herkende terugkerende betalingen. */
function agenda(state, from, to, withDetected) {
  const items = [];
  for (const p of (state.plans || [])) for (const d of planOccurrences(p, from, to)) items.push({ date: d, plan: p, ...occStatus(state, p, d) });
  if (withDetected) for (const r of detectRecurring(state)) {
    const pseudo = { id: "auto:" + r.key, title: r.title, amount: r.amount, kind: r.kind, repeat: r.repeat, date: r.next, match: r.match, cat: r.cat, account: r.account, auto: true };
    for (const d of planOccurrences(pseudo, from, to)) items.push({ date: d, plan: pseudo, detected: r, paid: false });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.plan.title || "").localeCompare(b.plan.title || ""));
}
/* Prijsstijgingen bij terugkerende betalingen (abonnementen, domiciliëringen). */
function priceChanges(state) {
  const groups = new Map();
  for (const t of budgetTx(state)) {
    if (t.amount >= 0) continue;
    const mandate = ((t.search || "").match(/Mandaat:\s*(\d{6,})/i) || [])[1];
    const k = mandate || merchantKey(t); if (!k) continue;
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
  }
  const ign = new Set(state.ignoredPrice || []), today = ds(new Date()), out = [];
  for (const [k, list] of groups) {
    const byDate = [...new Map(list.map(t => [t.date, t])).values()].sort((a, b) => a.date.localeCompare(b.date));
    if (byDate.length < 4) continue;
    const gaps = []; for (let i = 1; i < byDate.length; i++) gaps.push((pd(byDate[i].date) - pd(byDate[i - 1].date)) / 864e5);
    const g = gaps.slice(-4).sort((a, b) => a - b)[1];
    if (!(g >= 6 && g <= 35) && !(g >= 84 && g <= 380)) continue;            // alleen echt terugkerend
    const last = byDate[byDate.length - 1], prev = byDate.slice(-4, -1).map(t => -t.amount).sort((a, b) => a - b)[1];
    const now = -last.amount;
    if ((pd(today) - pd(last.date)) / 864e5 > 75) continue;
    if (now > prev * 1.02 && now - prev >= 0.5 && now - prev < prev * 3) {
      const key = k + "|" + now.toFixed(2);
      if (ign.has(key)) continue;
      out.push({ key, title: last.desc.replace(/\s*\(.*$/, "").replace(/\s*·.*$/, "").replace(/^Domicili[eë]ring\s+/i, ""), old: prev, now, date: last.date, pct: Math.round((now / prev - 1) * 100) });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
/* ---------- splitsregels ----------
   Bevat de omschrijving het trefwoord en is de uitgave minstens `min`, dan gaat `amount` naar `cat`
   en de rest naar `restCat` (of blijft in de huidige categorie). Handmatige splitsingen blijven ongemoeid. */
function splitRuleMatches(state, r) {
  const kw = (r.keyword || "").toLowerCase().trim(); if (!kw || !(+r.amount > 0)) return [];
  const min = +r.min || +r.amount;
  return budgetTx(state).filter(t => t.amount < 0 && Math.abs(t.amount) + 0.005 >= min &&
    ((t.search || "") + " " + (t.raw || "") + " " + (t.desc || "")).toLowerCase().includes(kw) &&
    !(t.splits && t.splits.length && t.splitRule !== r.id));
}
function applySplitRule(state, r) {
  let split = 0, full = 0;
  for (const t of splitRuleMatches(state, r)) {
    const total = Math.round(-t.amount * 100) / 100, part = Math.min(+r.amount, total);
    const base = t.splitRule === r.id ? (t.splitBase || t.cat) : t.cat;
    const rest = r.restCat || (base === r.cat ? UNCAT : base);
    if (total - part < 0.005) { if (t.splitRule === r.id) delete t.splits; t.cat = r.cat; t.splitRule = r.id; t.splitBase = base; full++; continue; }
    t.splits = [{ cat: r.cat, amount: -part }, { cat: rest, amount: -Math.round((total - part) * 100) / 100 }];
    t.splitRule = r.id; t.splitBase = base;
    t.cat = rest === UNCAT ? UNCAT : part >= total - part ? r.cat : rest;
    split++;
  }
  return { split, full };
}
function undoSplitRule(state, r) {
  let n = 0;
  for (const t of state.transactions) if (t.splitRule === r.id) { t.cat = t.splitBase || t.cat; delete t.splits; delete t.splitRule; delete t.splitBase; n++; }
  return n;
}
function applyAllSplitRules(state) { let n = 0; for (const r of (state.splitRules || [])) { const x = applySplitRule(state, r); n += x.split + x.full; } return n; }

function icsEscape(s) { return String(s || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n"); }
function plansToIcs(state) {
  const rr = { week: "FREQ=WEEKLY", month: "FREQ=MONTHLY", quarter: "FREQ=MONTHLY;INTERVAL=3", year: "FREQ=YEARLY" };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Budgetplanner//NL", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Budgetplanner"];
  for (const p of (state.plans || [])) {
    if (!p.date) continue;
    const d = p.date.replace(/-/g, ""), end = ds(new Date(pd(p.date).getTime() + 864e5)).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", "UID:" + p.id + "@budgetplanner", "DTSTAMP:" + stamp, "DTSTART;VALUE=DATE:" + d, "DTEND;VALUE=DATE:" + end,
      "SUMMARY:" + icsEscape((p.kind === "inkomst" ? "↓ " : "€ ") + p.title + (p.amount ? " (€ " + (+p.amount).toFixed(2).replace(".", ",") + ")" : "")),
      "DESCRIPTION:" + icsEscape("Uit je budgetplanner" + (p.note ? " — " + p.note : "")));
    if (p.repeat && p.repeat !== "none") lines.push("RRULE:" + rr[p.repeat] + (p.until ? ";UNTIL=" + p.until.replace(/-/g, "") : ""));
    const rd = p.remind === undefined || p.remind === null ? 3 : +p.remind;
    if (rd >= 0) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape("Binnenkort te betalen: " + p.title), rd === 0 ? "TRIGGER:-PT0M" : "TRIGGER:-P" + rd + "D", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function toCsv(state, list) {
  const esc = v => { v = String(v ?? ""); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ["Datum", "Omschrijving", "Categorie", "Type", "Bedrag", "Rekening", "Omzetnummer", "Tegenpartij", "Bankomschrijving"];
  const lines = [head.join(";")];
  for (const t of list || state.transactions) {
    const [y, m, d] = t.date.split("-");
    lines.push([`${d}/${m}/${y}`, t.desc, t.cat, typeOf(state, t.cat), t.amount.toFixed(2).replace(".", ","), t.account, t.omzet, t.counterparty, t.raw].map(esc).join(";"));
  }
  return "﻿" + lines.join("\r\n");
}

/* ---------- maandafsluiting (stap 13a) ----------
   Samenvatting van één maand: vergelijking met het gemiddelde van de 6 maanden ervoor (met gegevens)
   en met dezelfde maand vorig jaar, grootste uitgaven, opvallende categorieën, budget overschreden,
   prijsstijgingen, sparen per doel en wat nog te doen is. Pure rekenwerk, geen opmaak. */
const COST_TYPES = ["Vaste kosten", "Variabele kosten"];
function monthClose(state, ym) {
  const r2 = x => Math.round(x * 100) / 100;
  const s = monthSummary(state, ym), prevs = [];
  for (let i = 1; i <= 6; i++) { const m = addMonths(ym, -i), x = monthSummary(state, m); if (x.count) prevs.push(x); }
  const ly = monthSummary(state, addMonths(ym, -12));
  const avg = f => prevs.length ? r2(prevs.reduce((a, p) => a + f(p), 0) / prevs.length) : null;
  // "gespaard" = wat echt naar de spaarrekening(en) ging (zoals het Gespaard-kader op het Overzicht), anders de categorieën van het type Sparen
  const sm = hasSavings(state) ? savAll(state) : null;
  const savedIn = (m, x) => sm ? r2(sm.moves.filter(v => v.date.startsWith(m) && v.src !== "transfer").reduce((a, v) => a + v.effect, 0)) : x.saved;
  const prevYms = []; for (let i = 1; i <= 6; i++) { const m = addMonths(ym, -i); if (monthSummary(state, m).count) prevYms.push(m); }
  const cmp = {};
  for (const k of ["income", "expenses", "net"]) cmp[k] = { now: s[k], avg: avg(p => p[k]), lastYear: ly.count ? ly[k] : null };
  cmp.saved = { now: savedIn(ym, s), avg: prevYms.length ? r2(prevYms.reduce((a, m) => a + savedIn(m, monthSummary(state, m)), 0) / prevYms.length) : null, lastYear: ly.count ? savedIn(addMonths(ym, -12), ly) : null };
  const toSav = t => savKeys(state).some(k => withSav(state, k, () => isSavMove(state, t)));
  // grootste uitgaven (geen sparen, overboekingen of inkomsten)
  const top = expandTx(budgetTx(state).filter(t => t.date.startsWith(ym)))
    .filter(t => t.amount < 0 && !["Sparen", "Overboeking", "Inkomen"].includes(typeOf(state, t.cat)) && !toSav(t))
    .sort((a, b) => a.amount - b.amount).slice(0, 5)
    .map(t => ({ id: t.id, date: t.date, desc: t.desc, cat: t.cat, amount: t.amount }));
  // categorieën die duidelijk afwijken van hun gemiddelde (min. € 25 én 20 %)
  const cats = [];
  if (prevs.length >= 2) for (const c of mainCats(state).filter(c => COST_TYPES.includes(c.type))) {
    const now = r2(-(s.byCat[c.name] || 0)), av = avg(p => -(p.byCat[c.name] || 0)), diff = r2(now - av);
    if (Math.abs(diff) >= 25 && (av <= 0 || Math.abs(diff) / av >= 0.2)) cats.push({ cat: c.name, now, avg: av, diff, pct: av > 0 ? Math.round(diff / av * 100) : null });
  }
  cats.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  // budget overschreden
  const env = envelopes(state, ym), over = [];
  for (const c of mainCats(state)) { const e = env[c.name]; if (e && e.available > 0 && e.spent > e.available + 0.005) over.push({ cat: c.name, spent: e.spent, available: e.available, over: r2(e.spent - e.available) }); }
  over.sort((a, b) => b.over - a.over);
  // prijsstijgingen die deze maand voor het eerst gezien werden
  const prices = priceChanges(state).filter(p => p.date.startsWith(ym));
  // sparen per doel (stortingen en opnames, geen verplaatsingen tussen doelen)
  let sav = null;
  if (sm) {
    const moves = sm.moves.filter(m => m.date.startsWith(ym) && m.src !== "transfer"), per = new Map();
    for (const m of moves) per.set(m.goal || "Vrij sparen", r2((per.get(m.goal || "Vrij sparen") || 0) + m.effect));
    sav = { total: r2(moves.reduce((a, m) => a + m.effect, 0)), goals: [...per].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v) };
  }
  return { ym, summary: s, count: s.count, prevMonths: prevs.length, cmp, top, cats: cats.slice(0, 6), over, prices, sav,
    uncat: s.uncatCount, rate: s.income > 0 ? Math.round(s.net / s.income * 100) : null };
}

/* ---------- abonnementen en vaste betalingen (stap 13b) ----------
   Alle terugkerende uitgaven (ook die al in de planner staan), met ritme, huidig bedrag, kost per jaar,
   prijsevolutie t.o.v. ±een jaar geleden en wat je de voorbije 12 maanden echt betaalde.
   Wat de gebruiker erover zegt (nodig / twijfel / opzeggen / geen abonnement) staat in state.subs[key].review. */
const PER_YEAR = { week: 52, month: 12, quarter: 4, year: 1 };
function subscriptions(state, todayStr) {
  const today = todayStr || ds(new Date()), groups = new Map(), r2 = x => Math.round(x * 100) / 100;
  for (const t of budgetTx(state)) {
    if (t.amount >= 0 || t.cat === "Opname krediet" || ["Sparen", "Overboeking"].includes(typeOf(state, t.cat))) continue;
    if (savKeys(state).some(k => withSav(state, k, () => isSavMove(state, t)))) continue;   // stortingen naar de spaarrekening zijn geen kost
    const mandate = ((t.search || "").match(/Mandaat:\s*(\d{6,})/i) || [])[1];
    const k = mandate || merchantKey(t); if (!k) continue;
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
  }
  const subs = state.subs || {}, out = [];
  for (const [key, list] of groups) {
    // per dag maar één keer tellen (bv. twee kaartbetalingen dezelfde dag)
    const byDate = [...list.reduce((m, t) => m.set(t.date, (m.get(t.date) || 0) + t.amount), new Map())].map(([date, amount]) => ({ date, amount: -amount })).sort((a, b) => a.date.localeCompare(b.date));
    if (byDate.length < 3) continue;
    const gaps = []; for (let i = 1; i < byDate.length; i++) gaps.push((pd(byDate[i].date) - pd(byDate[i - 1].date)) / 864e5);
    const recent = gaps.slice(-6).sort((a, b) => a - b), med = recent[Math.floor(recent.length / 2)];
    let repeat = null, tol = 4;
    if (med >= 6 && med <= 8) repeat = "week", tol = 2; else if (med >= 26 && med <= 35) repeat = "month", tol = 5; else if (med >= 84 && med <= 98) repeat = "quarter", tol = 10; else if (med >= 350 && med <= 380) repeat = "year", tol = 20;
    if (!repeat || recent.filter(g => Math.abs(g - med) <= tol).length / recent.length < 0.6) continue;
    const last = byDate[byDate.length - 1], lastTx = list.filter(t => t.date === last.date).pop();
    const active = (pd(today) - pd(last.date)) / 864e5 <= med * 2 + tol;
    // bedrag ±een jaar geleden (de betaling die het dichtst bij "een jaar voor de laatste" ligt)
    const yearAgo = ds(new Date(pd(last.date).getTime() - 365 * 864e5)), cands = byDate.filter(x => x.date <= addD0(yearAgo, 45));
    const then = cands.length ? cands.reduce((b, x) => Math.abs(pd(x.date) - pd(yearAgo)) < Math.abs(pd(b.date) - pd(yearAgo)) ? x : b) : byDate[0];
    const from12 = ds(new Date(pd(today).getTime() - 365 * 864e5));
    out.push({ key, title: lastTx.desc.replace(/\s*\(.*$/, "").replace(/\s*·.*$/, "").replace(/^Domicili[eë]ring\s+/i, "").replace(/^Betaling\s+(Bancontact\s+|Maestro\s+|met debetkaart\s+)?/i, ""), cat: lastTx.cat, account: lastTx.account,
      repeat, amount: r2(last.amount), perYear: r2(last.amount * PER_YEAR[repeat]), perMonth: r2(last.amount * PER_YEAR[repeat] / 12),
      first: byDate[0].date, last: last.date, count: byDate.length, active,
      was: then !== last ? r2(then.amount) : null, wasDate: then !== last ? then.date : null, pct: then !== last && then.amount > 0 ? Math.round((last.amount / then.amount - 1) * 100) : null,
      paid12: r2(byDate.filter(x => x.date > from12).reduce((a, x) => a + x.amount, 0)),
      review: (subs[key] && subs[key].review) || "" });
  }
  return out.sort((a, b) => b.perYear - a.perYear);
}
function addD0(d, n) { const x = pd(d); x.setDate(x.getDate() + n); return ds(x); }

/* ---------- slimme filters (stap 13c) ----------
   f = { dir: ""|"uit"|"in", min, max (bedrag zonder teken), from, to (JJJJ-MM-DD), cats: [..], noXfer: bool, q: zoektekst }.
   Zoektekst die een bedrag is (bv. "17,99" of "-17.99") zoekt ook op dat bedrag. */
function parseAmt(v) { if (v === null || v === undefined || v === "") return null; const n = parseFloat(String(v).trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return isNaN(n) ? null : n; }
function filterTx(state, list, f) {
  f = f || {}; const min = parseAmt(f.min), max = parseAmt(f.max), cats = f.cats && f.cats.length ? new Set(f.cats) : null;
  const q = (f.q || "").trim().toLowerCase(), qAmt = /^[-+]?\s*€?\s*\d+([.,]\d{1,2})?$/.test(q) ? Math.abs(parseAmt(q.replace(/[€+\s]/g, ""))) : null;
  return list.filter(t => {
    if (f.dir === "uit" && t.amount >= 0) return false;
    if (f.dir === "in" && t.amount <= 0) return false;
    const a = Math.abs(t.amount);
    if (min !== null && a < min - 0.005) return false;
    if (max !== null && a > max + 0.005) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (cats && !cats.has(t.cat) && !(t.splits || []).some(x => cats.has(x.cat))) return false;
    if (f.noXfer && ownTransfer(state, t)) return false;
    if (q) { const txt = (t.desc + " " + t.raw + " " + t.cat + " " + (t.tags || []).map(g => "#" + g).join(" ")).toLowerCase();
      if (!txt.includes(q) && !(qAmt !== null && Math.abs(a - qAmt) < 0.005)) return false; }
    return true;
  });
}
const filterActive = f => !!(f && (f.dir || parseAmt(f.min) !== null || parseAmt(f.max) !== null || f.from || f.to || (f.cats && f.cats.length) || f.noXfer));

/* ---------- demo-modus (stap 14) ----------
   Een volledig verzonnen planner: Luna (27), QA-tester bij een gamestudio in Gent, streamt op Twitch, kat Pixel.
   Altijd dezelfde gegevens (vast zaadgetal), 2 jaar tot vandaag, alle bedragen afgerond op hele euro's.
   Rekeningnummers en firma's zijn verzonnen (testnummers 0000). Wordt nooit bewaard. */
function demoState(todayStr) {
  const today = todayStr || ds(new Date()), st = newState();
  let seed = 20260117;
  const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const between = (a, b) => Math.round(a + rnd() * (b - a)), pick = l => l[Math.floor(rnd() * l.length)];
  const ZICHT = "BE68 0000 0000 0420", SPAAR = "BE41 0000 0000 1337", HUISBAAS = "BE12 0000 0000 7777";
  st.profile = { name: "Luna" };
  st.accounts = { [ZICHT]: { type: "zicht", name: "Zichtrekening", color: 1 }, [SPAAR]: { type: "spaar", name: "Spaarrekening" } };
  const C = (name, type, budget, extra) => Object.assign({ name, type, budget }, extra || {});
  st.categories = [
    C("Loon", "Inkomen", 2200), C("Twitch", "Inkomen", 80),
    C("Huur", "Vaste kosten", 785), C("Energie", "Vaste kosten", 95), C("Internet & gsm", "Vaste kosten", 75), C("Verzekering", "Vaste kosten", 25), C("Abonnementen", "Vaste kosten", 60),
    C("Boodschappen", "Variabele kosten", 290), C("Games", "Variabele kosten", 100), C("Eten & drinken", "Variabele kosten", 120), C("Kat Pixel", "Variabele kosten", 45),
    C("Kleding & cosplay", "Variabele kosten", 70), C("Sport", "Vaste kosten", 30), C("Uitstapjes", "Variabele kosten", 60), C("Hardware", "Variabele kosten", null, { budgetYear: 600 }),
    C("Gaming-pc", "Sparen", 165), C("Japan-reis", "Sparen", 250), C("Noodfonds", "Sparen", 215),
  ];
  st.rules = [["pixelforge", "Loon"], ["twitch", "Twitch"], ["immo de kat", "Huur"], ["luminus", "Energie"], ["proximus", "Internet & gsm"], ["mobile vikings", "Internet & gsm"],
    ["ethias", "Verzekering"], ["netflix", "Abonnementen"], ["spotify", "Abonnementen"], ["game pass", "Abonnementen"], ["discord", "Abonnementen"],
    ["colruyt", "Boodschappen"], ["delhaize", "Boodschappen"], ["steam", "Games"], ["playstation", "Games"], ["nintendo", "Games"],
    ["deliveroo", "Eten & drinken"], ["takeaway", "Eten & drinken"], ["zooplus", "Kat Pixel"], ["dierenarts", "Kat Pixel"], ["zalando", "Kleding & cosplay"], ["cosplay", "Kleding & cosplay"], ["anime figures", "Kleding & cosplay"], ["basic-fit", "Sport"],
    ["nmbs", "Uitstapjes"], ["kinepolis", "Uitstapjes"], ["facts", "Uitstapjes"], ["coolblue", "Hardware"], ["alternate", "Hardware"]].map(([keyword, cat]) => ({ keyword, cat }));
  const end = today.slice(0, 7), start = addMonths(end, -23), first = start + "-01";
  st.goals = [{ name: "Gaming-pc", target: 4500, start: 0, deadline: addMonths(end, 4) + "-01" }, { name: "Japan-reis", target: 9000, start: 0, deadline: addMonths(end, 14) + "-01" }, { name: "Noodfonds", target: 8000, start: 0, deadline: "" }];
  ensureGoalRefs(st);
  let n = 0;
  const tx = (date, amount, desc, cp, extra) => { if (date > today) return; n++; st.transactions.push(Object.assign({ id: `${ZICHT}|${n}|${date}`, date, desc, cat: UNCAT, amount: Math.round(amount), account: ZICHT, omzet: String(n), counterparty: cp || "", raw: desc, search: desc + (cp ? " " + cp : "") }, extra || {})); };
  for (let ym = start, i = 0; ym <= end; ym = addMonths(ym, 1), i++) {
    const last = +endOfMonth(ym).slice(8), d = day => `${ym}-${String(Math.min(day, last)).padStart(2, "0")}`, y2 = i >= 12, m = ym.slice(5);
    tx(d(25), y2 ? 2250 : 2150, "PIXELFORGE STUDIOS NV · loon");
    tx(d(between(8, 12)), between(40, 120), "TWITCH INTERACTIVE · payout");
    if (m === "05") tx(d(28), 1450, "PIXELFORGE STUDIOS NV · vakantiegeld");
    if (m === "12") tx(d(20), 1100, "PIXELFORGE STUDIOS NV · eindejaarspremie");
    tx(d(1), y2 ? -785 : -760, "Naar IMMO DE KAT · huur", HUISBAAS);
    tx(d(5), -between(84, 104), "Domiciliëring LUMINUS energie");
    tx(d(6), -60, "Domiciliëring PROXIMUS internet");
    tx(d(7), -15, "Domiciliëring MOBILE VIKINGS");
    tx(d(15), -25, "Domiciliëring ETHIAS verzekering");
    tx(d(9), i >= 16 ? -18 : -15, "NETFLIX.COM");
    tx(d(10), -12, "SPOTIFY");
    tx(d(11), y2 ? -18 : -15, "XBOX GAME PASS ULTIMATE");
    tx(d(14), -10, "DISCORD NITRO");
    for (const day of [3, 10, 17, 24]) tx(d(day + between(0, 2)), -between(45, 95), pick(["Betaling Bancontact COLRUYT GENT", "Betaling Bancontact DELHAIZE GENT"]));
    for (let k = between(2, 3); k > 0; k--) tx(d(between(2, 27)), -between(15, 60), pick(["STEAM PURCHASE", "PLAYSTATION STORE", "NINTENDO ESHOP"]));
    for (let k = between(3, 5); k > 0; k--) tx(d(between(2, 28)), -between(17, 34), pick(["DELIVEROO", "TAKEAWAY.COM"]));
    for (let k = between(2, 3); k > 0; k--) tx(d(between(2, 28)), -between(5, 8), "Betaling Bancontact BUBBLE TEA GENT");   // geen regel: te categoriseren
    tx(d(between(4, 20)), -between(32, 46), "ZOOPLUS · kattenvoer Pixel");
    tx(d(between(5, 25)), -between(25, 95), pick(["ZALANDO", "COSPLAY SHOP ANTWERPEN"]));
    tx(d(2), -30, "Domiciliëring BASIC-FIT");
    if (i % 2 === 1) tx(d(between(5, 25)), -between(35, 80), "ANIME FIGURES SHOP · figuurtje");
    if (i % 3 === 1) tx(d(between(5, 25)), -between(12, 48), pick(["KINEPOLIS GENT", "FACTS GENT · tickets", "NMBS · treinticket"]));
    if (i === 8) tx(d(18), -649, "COOLBLUE · grafische kaart");
    if (i === 19) tx(d(12), -119, "ALTERNATE · gaming headset");
    if (i === 14) tx(d(9), -85, "DIERENARTS DE POOT · Pixel");
    // sparen: elke maand naar de spaarrekening, met de referentie van een doel
    const g = st.goals[i % 3];
    tx(d(26), -(g.name === "Noodfonds" ? 400 : 500), `Naar Spaarrekening ${g.ref}`, SPAAR, { goal: g.name, savChecked: true });
    if (m === "12") tx(d(22), -1000, `Naar Spaarrekening ${st.goals[2].ref} · premie`, SPAAR, { goal: st.goals[2].name, savChecked: true });
    if (m === "06") tx(d(2), -1000, `Naar Spaarrekening ${st.goals[1].ref} · vakantiegeld`, SPAAR, { goal: st.goals[1].name, savChecked: true });
  }
  st.transactions.sort((a, b) => b.date.localeCompare(a.date));
  applyRules(st);
  for (const t of st.transactions) if (t.goal) t.cat = t.goal;
  // bubble tea van vóór deze maand al ingedeeld (zoals een gebruiker zou doen); die van deze maand blijven te categoriseren
  for (const t of st.transactions) if (t.cat === UNCAT && t.date.slice(0, 7) < end) t.cat = "Eten & drinken";
  // startsaldo: het saldo van vandaag (de app rekent zelf terug)
  // zo gekozen dat het laagste saldo ooit ±€ 400 is (nooit in het rood)
  let run = 0, low = 0; for (const t of [...st.transactions].reverse()) if (t.account === ZICHT) { run += t.amount; low = Math.min(low, run); }
  st.balances = [{ account: ZICHT, date: today, amount: Math.round((400 - low + run) / 10) * 10 }];
  st.savings = { iban: SPAAR, anchor: { date: addD0(first, -1), amount: 1500, included: [] }, entries: [], transfers: [], pending: [] };
  st.plans = [
    { id: "demo1", title: "FACTS Gent – tickets", amount: 45, kind: "uitgave", date: addD0(today, 12), repeat: "none", account: ZICHT, cat: "Uitstapjes", remind: 3 },
    { id: "demo2", title: "Verjaardag Milan (cadeau)", amount: 40, kind: "uitgave", date: addD0(today, 6), repeat: "none", account: ZICHT, cat: "Uitstapjes", remind: 3 },
    { id: "demo3", title: "Nieuwe controller", amount: 70, kind: "uitgave", date: addD0(today, 30), repeat: "none", account: ZICHT, cat: "Games", remind: 3 },
  ];
  st.rolloverFrom = addMonths(end, -5);
  st.lastBackup = today + "T08:00:00.000Z";
  // enkel echte prijsstijgingen tonen (huur, Netflix, Game Pass), niet de wisselende winkelbedragen
  const real = /IMMO DE KAT|NETFLIX|GAME PASS/i;
  st.ignoredPrice = priceChanges(st).filter(x => !real.test(x.title)).map(x => x.key);
  // in het abonnementenoverzicht enkel echte vaste betalingen; winkels en webshops als "geen abonnement"
  st.subs = {}; for (const x of subscriptions(st, today)) if (!/IMMO|LUMINUS|PROXIMUS|VIKINGS|ETHIAS|NETFLIX|SPOTIFY|GAME PASS|DISCORD|BASIC-FIT/i.test(x.title)) st.subs[x.key] = { review: "geen" };
  st.demo = true;
  return st;
}

/* ---------- bankprofielen: kolommen koppelen (stap 15) ----------
   Voor elke bank behalve ING: de gebruiker duidt één keer aan welke kolom wat is; dat profiel wordt bewaard in
   state.bankProfiles en herkend aan de kopregel (sig). Profiel: { id, name, sig, sep, head (rij-index kopregel),
   map: { date, amount, amountIn, amountOut, desc: [..], name, cp, account, ref }, twoCols, dateFmt ("dmy"|"ymd"|"mdy"), fixedAccount }. */
function csvLines(text) { return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== ""); }
// scheidingsteken en kopregel raden: de eerste regel (bij de eerste 30) met de meeste velden die geen getal of datum zijn
function sniffCsv(text) {
  const lines = csvLines(text).slice(0, 60);
  const count = (l, c) => splitCsvLine(l, c).length;
  const sep = [";", ",", "\t", "|"].map(c => ({ c, n: lines.slice(0, 20).reduce((a, l) => a + (count(l, c) > 1 ? count(l, c) : 0), 0) })).sort((a, b) => b.n - a.n)[0].c;
  const rows = lines.map(l => splitCsvLine(l, sep).map(v => v.trim()));
  const width = Math.max(...rows.map(r => r.length));
  let head = 0, best = -1;
  rows.slice(0, 30).forEach((r, i) => { const text = r.filter(v => v && !/^[-+]?[\d.,\s€]+$/.test(v) && !/^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}$/.test(v)).length; const sc = text + (r.length >= width - 1 ? 2 : 0); if (sc > best && r.filter(Boolean).length >= 3) { best = sc; head = i; } });
  return { sep, head, rows };
}
const headerSig = h => h.map(x => String(x || "").toLowerCase().replace(/\s+/g, " ").trim()).join("|");
function parseDateFmt(v, fmt) {
  v = String(v || "").trim().slice(0, 10); let m;
  if ((m = v.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (!(m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/))) return null;
  let [, a, b, y] = m; if (y.length === 2) y = "20" + y;
  const [d, mo] = fmt === "mdy" ? [b, a] : [a, b];
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
// bedrag met komma of punt als decimaalteken, met of zonder duizendtallen, valuta, of min achteraan
function parseAnyAmount(v) {
  let x = String(v || "").replace(/[€\s ]|EUR/gi, ""); if (!x) return null;
  let neg = false; if (/^\(.*\)$/.test(x)) { neg = true; x = x.slice(1, -1); } if (/-$/.test(x)) { neg = true; x = x.slice(0, -1); }
  const lc = x.lastIndexOf(","), ld = x.lastIndexOf(".");
  if (lc > ld) x = x.replace(/\./g, "").replace(",", "."); else if (ld > lc && lc >= 0) x = x.replace(/,/g, "");
  else if (lc < 0 && ld >= 0 && /^\-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");
  const n = parseFloat(x); if (isNaN(n)) return null;
  return Math.round((neg ? -Math.abs(n) : n) * 100) / 100;
}
// kolommen raden aan de hand van de namen (NL/FR/EN) en de inhoud; dient als voorstel in de koppeltool
function guessMap(head, sample) {
  const h = head.map(x => String(x || "").toLowerCase());
  const find = (...re) => { for (const r of re) { const i = h.findIndex(x => r.test(x)); if (i >= 0) return i; } return -1; };
  const colVals = i => sample.map(r => r[i] || "").filter(Boolean);
  const isDateCol = i => colVals(i).length && colVals(i).every(v => parseDateFmt(v, "dmy") || parseDateFmt(v, "mdy"));
  const isAmtCol = i => colVals(i).length && colVals(i).every(v => parseAnyAmount(v) !== null && /\d/.test(v) && !/^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}$/.test(v));
  const m = { date: find(/boekingsdatum|date de comptabilisation|^datum$|^date$|uitvoeringsdatum|transactiedatum|date d.ex|booking date/), amount: find(/^bedrag$|^montant$|^amount$|bedrag \(eur\)|montant \(eur\)/),
    amountIn: find(/^credit|^bij$|ontvangen|crédit|^in$|^inkomsten?$/), amountOut: find(/^debet|^debit|^af$|uitgegeven|débit|^out$|^uitgaven?$/),
    desc: [find(/omschrijving|^transactie$|libell|description|mededeling|communication|bericht|^details?$/)].filter(i => i >= 0),
    name: find(/naam tegenpartij|nom de la contrepartie|tegenpartij naam|contrepartie|counterparty name|^naam$|^nom$|begunstigde/), cp: find(/rekening tegenpartij|compte contrepartie|compte de la contrepartie|iban tegenpartij|counterparty account|tegenrekening/),
    account: find(/^rekening$|rekeningnummer|^compte$|numéro de compte|^iban$|eigen rekening|^account/), ref: find(/transactienummer|referentie|référence|^ref|volgnummer|numéro de transaction|^id$/) };
  if (m.date < 0) m.date = h.findIndex((_, i) => isDateCol(i));
  if (m.amount < 0 && !(m.amountIn >= 0 && m.amountOut >= 0)) m.amount = h.findIndex((_, i) => i !== m.date && isAmtCol(i) && !/saldo|solde|balance/.test(h[i]));
  const msg = find(/mededeling|communication|bericht|message/); if (msg >= 0 && !m.desc.includes(msg)) m.desc.push(msg);
  if (!m.desc.length) { const i = h.findIndex((_, k) => ![m.date, m.amount, m.account, m.cp].includes(k) && colVals(k).some(v => /[a-z]{3,}/i.test(v))); if (i >= 0) m.desc.push(i); }
  const vals = m.date >= 0 ? colVals(m.date) : [];
  const dateFmt = vals.some(v => /^\d{4}/.test(v)) ? "ymd" : vals.some(v => { const x = v.match(/^(\d{1,2})[\/.-](\d{1,2})/); return x && +x[2] > 12; }) ? "mdy" : "dmy";
  return { map: m, twoCols: m.amount < 0 && m.amountIn >= 0 && m.amountOut >= 0, dateFmt };
}
// rijen lezen met een profiel → zelfde vorm als parseBankCsv (date, amount, account, omzet, counterparty, raw, desc, search)
function parseWithProfile(text, pr) {
  const rows = csvLines(text).map(l => splitCsvLine(l, pr.sep).map(v => v.trim())), m = pr.map, out = [], seen = new Map(); let bad = 0;
  const g = (r, i) => (i >= 0 && i !== undefined && i !== null ? r[i] || "" : "");
  for (const r of rows.slice((pr.head || 0) + 1)) {
    if (r.every(v => !v)) continue;
    const date = parseDateFmt(g(r, m.date), pr.dateFmt);
    let amount = null;
    if (pr.twoCols) { const a = parseAnyAmount(g(r, m.amountIn)), b = parseAnyAmount(g(r, m.amountOut)); if (a !== null || b !== null) amount = Math.round(((a || 0) - Math.abs(b || 0)) * 100) / 100; }
    else amount = parseAnyAmount(g(r, m.amount));
    if (!date || amount === null) { bad++; continue; }
    const name = g(r, m.name), descs = (m.desc || []).map(i => g(r, i)).filter(Boolean), cp = g(r, m.cp);
    // leesbaar zoals bij ING: "Naar/Van naam · mededeling", of de winkelnaam uit een kaartbetaling
    const desc = (belfiusDesc(name, descs[0] || "", descs.slice(1).join(" "), amount) || "(geen omschrijving)").slice(0, 200);
    const account = (pr.fixedAccount || g(r, m.account) || "").trim();
    // uniek nummer: liefst uit het bestand; anders datum+bedrag+omschrijving (+ volgnummer bij identieke regels op dezelfde dag)
    let omzet = g(r, m.ref);
    if (omzet) omzet = "P" + omzet; else { const k = `${date}|${amount}|${desc}`; const n = (seen.get(k) || 0) + 1; seen.set(k, n); let hsh = 0; for (const ch of k) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0; omzet = "H" + (hsh >>> 0).toString(36) + (n > 1 ? "-" + n : ""); }
    out.push({ date, amount, account, omzet, counterparty: cp, raw: descs.join(" · ").slice(0, 600) || desc, desc, search: [name, ...descs, cp].join(" ") });
  }
  return { rows: out, bad };
}
function findProfile(state, text) {
  const sn = sniffCsv(text);
  for (const p of state.bankProfiles || []) { const r = sn.rows[p.head || 0]; if (r && headerSig(splitCsvLine(csvLines(text)[p.head || 0] || "", p.sep).map(v => v.trim())) === p.sig) return p; }
  return null;
}

if (typeof module !== "undefined") module.exports = { sniffCsv, headerSig, parseDateFmt, parseAnyAmount, guessMap, parseWithProfile, findProfile, csvLines, demoState, filterTx, filterActive, parseAmt, subscriptions, PER_YEAR, monthClose, belfiusDesc, catByName, parentOf, groupOf, mainCats, subsOf, savKeys, activeSav, setSav, withSav, goalSav, savGoals, savAll, syncSavConfs, cardMatch, applyCards, transferFlows, OWN_CAT, ownTransfer, applyOwnTransfers, ownConflicts, MAX_ZICHT, accKey, zichtList, spaarList, fmtIban, accName, checkBackup, cleanBackup, suggestRules, ruleKeyword, RULE_HINTS, setTxCat, splitRuleMatches, applySplitRule, undoSplitRule, applyAllSplitRules, inAnchor, expandTx, priceChanges, REPEATS, stepDate, planOccurrences, occStatus, detectRecurring, agenda, plansToIcs, monthlyBudget, yearlyBudget, rolloverStart, savingsBalance, savingsSummary, savMoves, savConf, ensureGoalRefs, resolvePending, isSavMove, hasSavings, isSav, budgetTx, txKey, txRefKey, creditMovements, creditKeywords, creditStatus, CREDIT_TYPES, impliedRate, loanStatus, loanPayments, detectLoans, addMonths, envelopes, yearSummary, rolls, firstMonth, merchantKey, learnedMap, uncatGroups, balanceAt, accounts, endOfMonth, newState, decodeBytes, parseBankCsv, mergeRows, applyRules, monthSummary, goalProgress, cleanDescription, toCsv, UNCAT };
