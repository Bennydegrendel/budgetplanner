/* ---------- Kernlogica: CSV-import, categoriseren, berekeningen ---------- */
const DEFAULT_CATEGORIES = [
  { name: "Loon", type: "Inkomen", budget: null },
  { name: "Andere inkomsten", type: "Inkomen", budget: null },
  { name: "Huur", type: "Vaste kosten", budget: null },
  { name: "Lening / krediet", type: "Vaste kosten", budget: null },
  { name: "Energie & water", type: "Vaste kosten", budget: null },
  { name: "Internet & gsm", type: "Vaste kosten", budget: null },
  { name: "Verzekeringen", type: "Vaste kosten", budget: null },
  { name: "Abonnementen", type: "Vaste kosten", budget: null },
  { name: "Bankkosten", type: "Vaste kosten", budget: null },
  { name: "Boodschappen", type: "Variabele kosten", budget: null },
  { name: "Vervoer", type: "Variabele kosten", budget: null },
  { name: "Lunch & uit eten", type: "Variabele kosten", budget: null },
  { name: "Vrije tijd & hobby", type: "Variabele kosten", budget: null },
  { name: "Kleding", type: "Variabele kosten", budget: null },
  { name: "Gezondheid", type: "Variabele kosten", budget: null },
  { name: "Cadeaus & giften", type: "Variabele kosten", budget: null },
  { name: "Diversen", type: "Variabele kosten", budget: null },
  { name: "Noodfonds", type: "Sparen", budget: null },
  { name: "Vakantie", type: "Sparen", budget: null },
  { name: "Opname krediet", type: "Overboeking", budget: null },
];
const DEFAULT_RULES = [
  ["SalaryPayment", "Loon"], ["Kostenafrekening", "Bankkosten"],
  ["NMBS", "Vervoer"], ["DE LIJN", "Vervoer"],
  ["DELHAIZE", "Boodschappen"], ["COLRUYT", "Boodschappen"], ["ALDI", "Boodschappen"],
  ["LIDL", "Boodschappen"], ["CARREFOUR", "Boodschappen"], ["ALBERT HEIJN", "Boodschappen"],
  ["Prime Video", "Abonnementen"],
  ["NETFLIX", "Abonnementen"], ["SPOTIFY", "Abonnementen"], ["DISNEY", "Abonnementen"],
].map(([keyword, cat]) => ({ keyword, cat }));
const DEFAULT_GOALS = [
  { name: "Noodfonds", target: null, start: 0, deadline: "" },
  { name: "Vakantie", target: null, start: 0, deadline: "" },
];
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
function parseBankCsv(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) return { rows: [], error: "Het bestand bevat geen transacties." };
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const head = splitCsvLine(lines[0], sep).map(h => h.toLowerCase());
  const col = n => head.indexOf(n.toLowerCase());
  const c = {
    acc: col("Rekeningnummer"), omzet: col("Omzetnummer"), date: col("Boekingsdatum"), amount: col("Bedrag"),
    desc: col("Omschrijving"), cp: col("Rekening tegenpartij"), detail: col("Detail van de omzet"), msg: col("Bericht"),
  };
  if (c.date < 0 || c.amount < 0 || c.desc < 0)
    return { rows: [], error: "Dit lijkt geen ING-export: de kolommen Boekingsdatum, Bedrag en Omschrijving ontbreken." };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const v = splitCsvLine(lines[i], sep); const g = k => (c[k] >= 0 ? v[c[k]] || "" : "");
    const date = parseDate(g("date")), amount = parseAmount(g("amount"));
    if (!date || amount === null) continue;
    rows.push({
      date, amount, account: g("acc"), omzet: g("omzet"), counterparty: g("cp"),
      raw: g("desc").slice(0, 600), search: [g("desc"), g("detail"), g("msg"), g("cp")].join(" "),
    });
  }
  return { rows, error: null };
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
    const desc = cleanDescription(r.raw);
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
  const s = { transfer: 0, income: 0, fixed: 0, variable: 0, saved: 0, uncat: 0, uncatCount: 0, net: 0, byCat: {}, count: tx.length };
  for (const t of tx) {
    const ty = typeOf(state, t.cat);
    s.net += t.amount;
    if (ty === "Inkomen") s.income += t.amount;
    else if (ty === "Vaste kosten") s.fixed -= t.amount;
    else if (ty === "Variabele kosten") s.variable -= t.amount;
    else if (ty === "Sparen") s.saved -= t.amount;
    else if (ty === "Overboeking") { s.transfer = (s.transfer || 0) + t.amount; }
    else { s.uncat += t.amount; s.uncatCount++; }
    s.byCat[t.cat] = (s.byCat[t.cat] || 0) + t.amount;
  }
  for (const k of ["income", "fixed", "variable", "saved", "uncat", "net"]) s[k] = Math.round(s[k] * 100) / 100;
  s.expenses = Math.round((s.fixed + s.variable) * 100) / 100;
  return s;
}

function goalProgress(state, g) {
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
  for (const t of expandTx(budgetTx(state))) { const k = t.cat + "|" + t.date.slice(0, 7); m.set(k, (m.get(k) || 0) - t.amount); }
  return m;
}
/* Per uitgavencategorie voor maand ym: budget, overgedragen (carryIn), beschikbaar, uitgegeven, over (carryOut). */
function envelopes(state, ym, _spent) {
  const spent = _spent || spentMap(state), start = rolloverStart(state), out = {};
  for (const c of state.categories) {
    if (c.type !== "Vaste kosten" && c.type !== "Variabele kosten") continue;
    const budget = Math.round(monthlyBudget(c) * 100) / 100, roll = rolls(c) && budget > 0;
    let carry = 0;
    if (roll && start && start < ym) for (let m = start; m < ym; m = nextYm(m)) carry = carry + budget - (spent.get(c.name + "|" + m) || 0);
    carry = Math.round(carry * 100) / 100;
    const s = Math.round((spent.get(c.name + "|" + ym) || 0) * 100) / 100;
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
function savConf(state) { if (!state.savings) state.savings = { iban: "", anchor: null, entries: [], pending: [], transfers: [] }; const s = state.savings; s.entries = s.entries || []; s.pending = s.pending || []; s.transfers = s.transfers || []; return s; }
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
  if (refGoal(state, t)) return true;
  return state.goals.some(g => g.name === t.cat);
}
function moveGoal(state, t) {
  if (t.goal !== undefined && t.goal !== null && t.goal !== "") return t.goal;
  if (t.goal === "") return null;               // bewust niet toegewezen
  return refGoal(state, t) || (state.goals.some(g => g.name === t.cat) ? t.cat : null);
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
function hasSavings(state) { const sc = savConf(state); return !!(sc.iban || sc.anchor || sc.entries.length || savMoves(state).length); }
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
  const goals = state.goals.map(g => ({ g, p: goalProgress(state, g) }));
  const allocated = Math.round(goals.reduce((s, x) => s + x.p.total, 0) * 100) / 100;
  const y = String(new Date().getFullYear());
  return { bal, goals, moves: mv, allocated, unallocated: bal.set ? Math.round((bal.total - allocated) * 100) / 100 : null,
    open: mv.filter(m => !m.goal && !m.checked).length, toCheck: mv.filter(m => !m.checked).length,
    inYear: mv.filter(m => m.src !== "transfer" && m.date.startsWith(y) && m.effect > 0).reduce((s, m) => s + m.effect, 0),
    outYear: mv.filter(m => m.src !== "transfer" && m.date.startsWith(y) && m.effect < 0).reduce((s, m) => s - m.effect, 0) };
}
/* Geplande opnames/stortingen die intussen in je bankafschrift staan, worden afgevinkt. */
function resolvePending(state) {
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
  if (!plan.repeat || plan.repeat === "none") { if (plan.date >= from && plan.date <= to) out.push(plan.date); return out; }
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
    out.push({ key, match: k, title: last.desc.replace(/\s*\(.*$/, "").replace(/\s*·.*$/, "").replace(/^Domicili[eë]ring\s+/i, ""), cat: last.cat, kind: last.amount < 0 ? "uitgave" : "inkomst", amount: Math.round(amts[1] * 100) / 100, repeat, last: last.date, next, count: byDate.length, varies: amts[2] - amts[0] > Math.max(2, amts[1] * 0.1) });
  }
  return out.sort((a, b) => a.next.localeCompare(b.next));
}
/* Alle planner-items tussen from en to: eigen planningen + (optioneel) herkende terugkerende betalingen. */
function agenda(state, from, to, withDetected) {
  const items = [];
  for (const p of (state.plans || [])) for (const d of planOccurrences(p, from, to)) items.push({ date: d, plan: p, ...occStatus(state, p, d) });
  if (withDetected) for (const r of detectRecurring(state)) {
    const pseudo = { id: "auto:" + r.key, title: r.title, amount: r.amount, kind: r.kind, repeat: r.repeat, date: r.next, match: r.match, cat: r.cat, auto: true };
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

function toCsv(state) {
  const esc = v => { v = String(v ?? ""); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ["Datum", "Omschrijving", "Categorie", "Type", "Bedrag", "Rekening", "Omzetnummer", "Tegenpartij", "Bankomschrijving"];
  const lines = [head.join(";")];
  for (const t of state.transactions) {
    const [y, m, d] = t.date.split("-");
    lines.push([`${d}/${m}/${y}`, t.desc, t.cat, typeOf(state, t.cat), t.amount.toFixed(2).replace(".", ","), t.account, t.omzet, t.counterparty, t.raw].map(esc).join(";"));
  }
  return "﻿" + lines.join("\r\n");
}

if (typeof module !== "undefined") module.exports = { setTxCat, splitRuleMatches, applySplitRule, undoSplitRule, applyAllSplitRules, inAnchor, expandTx, priceChanges, REPEATS, stepDate, planOccurrences, occStatus, detectRecurring, agenda, plansToIcs, monthlyBudget, yearlyBudget, rolloverStart, savingsBalance, savingsSummary, savMoves, savConf, ensureGoalRefs, resolvePending, isSavMove, hasSavings, isSav, budgetTx, txKey, txRefKey, creditMovements, creditKeywords, creditStatus, CREDIT_TYPES, impliedRate, loanStatus, loanPayments, detectLoans, addMonths, envelopes, yearSummary, rolls, firstMonth, merchantKey, learnedMap, uncatGroups, balanceAt, accounts, endOfMonth, newState, decodeBytes, parseBankCsv, mergeRows, applyRules, monthSummary, goalProgress, cleanDescription, toCsv, UNCAT };
