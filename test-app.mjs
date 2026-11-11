// Accounting test harness.
//   npm i jsdom pdfjs-dist@3.11.174
//   node test-app.mjs index.html [statement.pdf ...]
// Loads the real index.html in jsdom, then checks the parser, the numbers,
// the payday split, merging, the UI, and the Family Worker (with a fake KV).
import fs from "fs";
import { JSDOM } from "jsdom";

const file = process.argv[2] || "index.html";
const pdfs = process.argv.slice(3);
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name); } }
const near = (a, b) => Math.abs(a - b) < 0.006;

const errors = [];
const dom = new JSDOM(fs.readFileSync(file, "utf8"), {
  runScripts: "dangerously", url: "https://dustin12342986-hue.github.io/Accounting/", pretendToBeVisual: true,
  beforeParse(w) { w.fetch = () => Promise.reject(new Error("no network in tests")); w.addEventListener("error", (e) => errors.push(e.message)); },
});
const w = dom.window;
const E = (s) => w.eval(s);
await new Promise((r) => setTimeout(r, 50));

console.log("Load");
ok(errors.length === 0, "loads with no script errors " + errors.join("; "));
ok(w.document.querySelector(".nav-tab.active"), "renders the tabs");
ok(/Start here/.test(w.document.body.textContent), "empty state shows Start here");

console.log("Payday split");
let r = E("computePayday(10000, 2000, { taxPct: 25, operatingPct: 10, sCorp: true, owners: [{name:'A',share:50,jointPct:50,salary:1000},{name:'B',share:50,jointPct:50,salary:0}] })");
ok(r.tax === 2500 && r.operating === 1000 && r.pool === 4500, "tax, operating and owner pool");
ok(r.people[0].pay === 2250 && r.people[1].pay === 2250, "owner pay split 50/50");
ok(r.people[0].joint === 1125 && r.people[0].personal === 1125, "joint and personal 50/50");
ok(r.people[0].salary === 1000 && r.people[0].distribution === 1250, "S-Corp salary and distribution");
ok(near(r.tax + r.crew + r.operating + r.people[0].pay + r.people[1].pay, 10000), "every dollar accounted for");
r = E("computePayday(1000.01, 900, { taxPct: 25, operatingPct: 10, owners: [{name:'A',share:60,jointPct:50},{name:'B',share:40,jointPct:100}] })");
ok(r.pool === 0 && r.short > 0, "short payment: owners get 0, shortfall shown");
r = E("computePayday(999.99, 0, { taxPct: 0, operatingPct: 0, owners: [{name:'A',share:1,jointPct:50},{name:'B',share:2,jointPct:50}] })");
ok(near(r.people[0].pay + r.people[1].pay, 999.99), "uneven shares still add up to the cent");

console.log("CSV import");
const csv = 'Date,Description,Withdrawals,Deposits,Balance\n10/01/2026,"KLARNA* KLARNA",45.00,,100\n10/02/2026,MOBILE DEPOSIT,,1200.00,1300\n10/03/2026,"TST* VELVET TACO, GRAPEVINE",15.16,,1284.84\n';
const pc = E("parseCsvStatement(" + JSON.stringify(csv) + ")");
ok(pc && pc.txns.length === 3, "reads 3 rows");
ok(pc.txns[0].amount === -45 && pc.txns[1].amount === 1200, "withdrawals negative, deposits positive");
ok(pc.txns[2].desc.includes("VELVET TACO, GRAPEVINE"), "quoted commas kept");
const csv2 = "Posting Date,Details,Amount\n2026-10-05,ATM WITHDRAWAL,(60.00)\n2026-10-06,PAYROLL DEPOSIT,500.00\n";
const pc2 = E("parseCsvStatement(" + JSON.stringify(csv2) + ")");
ok(pc2 && pc2.txns[0].amount === -60 && pc2.txns[1].amount === 500, "single amount column with parentheses");

console.log("Categories");
const cat = (desc, amt) => E("autoCategory(" + JSON.stringify({ desc, amount: amt }) + ")");
ok(cat("9673 Debit Card Purchase Klarna* Klarna", -40) === "Buy now, pay later", "Klarna");
ok(cat("9673 Debit Card Purchase Sp+aff * Joah Brown", -180) === "Buy now, pay later", "Shop Pay Installments");
ok(cat("9673 Debit Card Purchase B&H Photo 800-606-6969", -7134) === "Business equipment", "B&H");
ok(cat("Overdraft Item Fee", -36) === "Overdraft & bank fees", "overdraft");
ok(cat("Online Transfer From XXXXX1367", 1500) === "Transfers in", "transfer in");
ok(cat("Mobile Deposit", 2200) === "Client payments", "client deposit");
ok(cat("1017 Recurring Debit Card Waxing The City", -68) === "Beauty, skin & supplements", "recurring line is not mistaken for Ring");

if (pdfs.length) {
  console.log("PNC statements");
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.js")).default;
  const lib = { getDocument: (o) => pdfjs.getDocument(Object.assign({ disableWorker: true }, o)) };
  let total = 0;
  for (const p of pdfs) {
    const lines = await w.pdfToLines(lib, new Uint8Array(fs.readFileSync(p)));
    const parsed = w.parsePncStatement(lines);
    const rec = w.reconcile(parsed);
    ok(parsed && rec && rec.ok, p.split("/").pop() + ": " + (parsed ? parsed.txns.length : 0) + " txns, totals match the bank");
    if (!E("accountFor('" + parsed.last4 + "')")) E("STATE.items.push(newItem('account', { last4: '" + parsed.last4 + "', label: 'Business checking', type: 'business' }))");
    w.__p = parsed; E("saveStatement(window.__p, window.__p.last4, 'test.pdf')");
    total += parsed.txns.length;
  }
  ok(E("items('txn').length") === total, "all transactions saved (" + total + ")");
  const months = E("monthsWithData()");
  ok(months.length === pdfs.length, "one month per statement: " + months.join(", "));
  if (months.includes("2026-10")) {
    const s = E("monthSummary('2026-10','all')");
    ok(near(s.installments, 2583.04), "Oct installments " + s.installments);
    ok(near(s.clientIn, 5500), "Oct client payments " + s.clientIn);
    ok(near(s.transfersIn, 16062), "Oct transfers in " + s.transfersIn);
    ok(s.personalInBusiness > 5000, "Oct household spending in business flagged " + s.personalInBusiness);
  }
  if (months.includes("2026-09")) ok(near(E("monthSummary('2026-09','all')").fees, 1263.03), "Sep fees");
  ok(E("items('txn').filter(t => t.category === 'Uncategorized').length") / total < 0.03, "under 3% left uncategorized (" + E("items('txn').filter(t => t.category === 'Uncategorized').length") + ")");

  // Re-import keeps a hand-set category and doesn't duplicate.
  const firstLines = await w.pdfToLines(lib, new Uint8Array(fs.readFileSync(pdfs[0])));
  const firstMonth = w.parsePncStatement(firstLines).end.slice(0, 7);
  const t0 = E("items('txn').find(t => t.merchant === 'Klarna' && t.date.startsWith('" + firstMonth + "'))");
  if (t0) {
    E("(function(){ const t = STATE.items.find(x => x.id === '" + t0.id + "'); t.category = 'Shopping (other)'; t.catSet = true; })()");
    const lines = await w.pdfToLines(lib, new Uint8Array(fs.readFileSync(pdfs[0])));
    w.__p = w.parsePncStatement(lines); E("saveStatement(window.__p, window.__p.last4, 'again.pdf')");
    ok(E("items('txn').length") === total, "re-import replaces instead of duplicating");
    ok(E("STATE.items.find(x => x.id === '" + t0.id + "').category") === "Shopping (other)", "re-import keeps a hand-set category");
  }

  console.log("UI with data");
  for (const tab of ["overview", "payday", "months", "installments", "txns"]) {
    w.document.querySelector('[data-id="' + tab + '"]').click();
    ok(w.document.querySelector(".nav-tab.active").dataset.id === tab && errors.length === 0, "tab " + tab + " renders");
  }
  // Tap a transaction, set "always" for its merchant.
  const row = w.document.querySelector(".txn[data-action=edit-txn]");
  const id = row.dataset.id; const merch = E("STATE.items.find(x => x.id === '" + id + "').merchant");
  row.click();
  w.document.getElementById("txCat").value = "Business software & services";
  w.document.getElementById("txAll").checked = true;
  w.document.getElementById("txSave").click();
  const same = E("items('txn').filter(t => t.merchant === " + JSON.stringify(merch) + " && t.amount < 0)");
  ok(same.length > 0 && same.every((t) => t.category === "Business software & services"), "'always' rule applies to every " + merch + " transaction");
}

console.log("Payday UI");
w.document.querySelector('[data-id="payday"]').click();
const amt = w.document.getElementById("pdAmount");
amt.value = "4000"; amt.dispatchEvent(new w.Event("input", { bubbles: true }));
ok(/Move the money/.test(w.document.body.textContent), "shows the moves after typing an amount");
ok(w.document.activeElement && w.document.activeElement.id === "pdAmount", "keeps focus in the amount box while typing");
w.document.querySelector('[data-action="save-payday"]').click();
ok(E("items('payday').length") === 1, "payday saved");

console.log("Installment plans");
ok(E("planEnds({ next: '2026-11-10', every: 'biweekly', left: 3 })") === "2026-12-08", "biweekly end date");
ok(E("planEnds({ next: '2026-11-10', every: 'monthly', left: 3 })") === "2027-01-10", "monthly end date");
ok(near(E("planMonthly({ payment: 50, every: 'biweekly', status: 'in progress' })"), 108.33), "biweekly per month");
E("STATE.items.push(newItem('plan', { provider: 'Affirm', payment: 58.86, every: 'monthly', left: 1, next: '2026-11-20', status: 'in progress' }))");
const pid = E("items('plan')[0].id");
E("markPlanPaid('" + pid + "')");
ok(E("items('plan')[0].status") === "done" && E("items('plan')[0].left") === 0, "last payment marks the plan done");

console.log("Merging (family)");
const m = E(`(function(){
  const a = { items: [{id:'x',kind:'plan',updatedAt:5,v:'a'},{id:'y',kind:'plan',updatedAt:5}], deleted: [], updatedAt: 10 };
  const b = { items: [{id:'x',kind:'plan',updatedAt:9,v:'b'},{id:'z',kind:'plan',updatedAt:3}], deleted: [{id:'y',at:7}], updatedAt: 9 };
  return mergeStates(a, b);
})()`);
ok(m.items.find((i) => i.id === "x").v === "b", "newest edit wins");
ok(!m.items.find((i) => i.id === "y"), "a delete on one side sticks");
ok(m.items.find((i) => i.id === "z"), "items from both sides kept");

console.log("Guardrails");
const html = fs.readFileSync(file, "utf8");
ok(!/\b(overdue|behind|late fee|failed)\b/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, "")), "no guilt words in the page");
ok(!/sk-ant-/.test(html), "no API key in the page");
ok(/SAFETY RAIL/.test(html), "safety rail present");

console.log("Family Worker");
const kv = new Map();
const env = { FAMILY_KV: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, put: async (k, v) => { kv.set(k, v); } } };
const users = { tokA: "dusty@example.com", tokB: "partner@example.com", tokC: "stranger@example.com" };
globalThis.fetch = async (url, o) => {
  const tok = (o.headers.Authorization || "").replace("Bearer ", "");
  return users[tok] ? new Response(JSON.stringify({ email: users[tok], email_verified: true })) : new Response("{}", { status: 401 });
};
const worker = (await import("./accounting-family-worker.js")).default;
const call = async (tok, method, path, body) => {
  const res = await worker.fetch(new Request("https://w.example" + path, { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, data: await res.json() };
};
const fam = (await call("tokA", "POST", "/families", { name: "Brown household" })).data;
ok(fam.id && fam.members[0] === "dusty@example.com", "create family");
ok((await call("tokB", "GET", "/families/" + fam.id + "/state")).status === 403, "non-member can't read");
await call("tokA", "POST", "/families/" + fam.id + "/members", { email: "Partner@Example.com" });
ok((await call("tokB", "GET", "/families")).data.families.length === 1, "partner sees the family after being added");
let put = await call("tokA", "PUT", "/families/" + fam.id + "/state", { state: { items: [{ id: "1" }] }, baseVersion: 0 });
ok(put.status === 200 && put.data.version === 1, "first save");
put = await call("tokB", "PUT", "/families/" + fam.id + "/state", { state: { items: [{ id: "2" }] }, baseVersion: 0 });
ok(put.status === 409 && put.data.version === 1, "stale save is refused with the current copy");
put = await call("tokB", "PUT", "/families/" + fam.id + "/state", { state: { items: [] }, baseVersion: 1 });
ok(put.status === 409, "empty copy can't replace one with data");
ok((await call("tokC", "GET", "/families/" + fam.id + "/state")).status === 403, "stranger refused");
ok((await call("bad", "GET", "/families")).status === 401, "bad token refused");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
