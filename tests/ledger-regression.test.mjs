import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute the REAL ledger functions from app.js. Do not copy the algorithm into tests.
const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const functionNames = [
  "currencyDigits", "toMinor", "fromMinor", "addNet", "rateFor",
  "renderDebts", "calculateApproxTlDebts",
  "latestExpensesFromVersions", "latestSettlementsFromVersions"
];
function extract(name) {
  const needle = "  function " + name + "(";
  const start = source.indexOf(needle);
  assert.notEqual(start, -1, "Missing production function: " + name);
  const end = source.indexOf("\n  }", start);
  assert.notEqual(end, -1, "Cannot isolate production function: " + name);
  return source.slice(start, end + "\n  }".length);
}
const actualFunctions = functionNames.map(extract).join("\n\n");

function harness({ rates = {}, base = "TL" } = {}) {
  const nodes = {
    debtEmpty: { classList: { toggle() {} } },
    debtBody: { innerHTML: "" }
  };
  const sandbox = {
    $: (id) => nodes[id],
    profileName: (id) => id,
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
    formatAmount: (value, currency) => Number(value).toFixed(currency === "JPY" ? 0 : 2),
    baseCurrency: () => base,
    displayRates: rates
  };
  vm.createContext(sandbox);
  vm.runInContext(actualFunctions, sandbox);
  return {
    sandbox,
    nodes,
    exact: (expenses, settlements = []) => {
      sandbox.renderDebts(expenses, settlements);
      const cells = [...nodes.debtBody.innerHTML.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map((match) => match[1].trim());
      assert.equal(cells.length % 5, 0, "Unexpected debt table structure");
      const rows = [];
      for (let i = 0; i < cells.length; i += 5) {
        rows.push({
          from: cells[i], to: cells[i + 1], amount: cells[i + 2],
          currency: cells[i + 3], status: cells[i + 4]
        });
      }
      return rows;
    },
    approx: (expenses, settlements = []) => sandbox.calculateApproxTlDebts(expenses, settlements)
  };
}
const expense = (amount, currency, payer = "A", people = ["A", "B"]) => ({
  amount, currency, payer_id: payer, participant_ids: people,
  payment_type: "Cash", card_tl_amount: null, status: "active"
});
const payment = (amount, currency, from = "B", to = "A") => ({
  amount, currency, from_user_id: from, to_user_id: to, status: "active"
});

test("equal TL split correctly leaves one debtor", () => {
  assert.deepEqual(harness().exact([expense(100, "TL")]), [
    { from: "B", to: "A", amount: "50.00", currency: "TL", status: "Kesin" }
  ]);
});

test("three-way remainder is allocated exactly once", () => {
  const rows = harness().exact([expense(100, "TL", "A", ["C", "B", "A"])]);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0), 6666);
  assert.deepEqual(rows.map(r => r.from).sort(), ["B", "C"]);
});

test("settlement closes a debt without creating another expense", () => {
  assert.deepEqual(harness().exact([expense(100, "TL")], [payment(50, "TL")]), []);
});

test("overpayment reverses the remaining debt", () => {
  assert.deepEqual(harness().exact([expense(100, "TL")], [payment(70, "TL")]), [
    { from: "A", to: "B", amount: "20.00", currency: "TL", status: "Kesin" }
  ]);
});

test("different currencies are never netted in exact debts", () => {
  const rows = harness().exact([expense(100, "TL"), expense(10, "EUR", "B")]);
  assert.deepEqual(rows, [
    { from: "B", to: "A", amount: "50.00", currency: "TL", status: "Kesin" },
    { from: "A", to: "B", amount: "5.00", currency: "EUR", status: "Kesin" }
  ]);
});

test("foreign card payment with actual TL amount settles in TL", () => {
  const row = { ...expense(10, "EUR"), payment_type: "Kart", card_tl_amount: 400 };
  assert.deepEqual(harness().exact([row]), [
    { from: "B", to: "A", amount: "200.00", currency: "TL", status: "Kesin" }
  ]);
});

test("foreign card payment without TL amount is visibly provisional", () => {
  const row = { ...expense(10, "EUR"), payment_type: "Kart" };
  assert.deepEqual(harness().exact([row]), [
    { from: "B", to: "A", amount: "5.00", currency: "EUR", status: "Geçici" }
  ]);
});

test("zero-decimal currencies split in whole units", () => {
  const rows = harness().exact([expense(101, "JPY")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currency, "JPY");
  assert.equal(rows[0].amount, "50");
});

test("revision uses latest version and voided entry is excluded", () => {
  const ctx = harness();
  const original = {
    ...expense(100, "TL"), expense_id: "e1", version_no: 1,
    spent_on: "2026-11-01", created_at: "2026-11-01T12:00:00Z"
  };
  const revised = { ...original, amount: 60, version_no: 2, created_at: "2026-11-02T12:00:00Z" };
  const voided = {
    ...expense(999, "TL"), expense_id: "e2", status: "voided",
    version_no: 2, spent_on: "2026-11-02", created_at: "2026-11-02T12:00:00Z"
  };
  const latest = ctx.sandbox.latestExpensesFromVersions([original, revised, voided]);
  const active = latest.filter(e => e.status === "active");
  assert.deepEqual(ctx.exact(active), [
    { from: "B", to: "A", amount: "30.00", currency: "TL", status: "Kesin" }
  ]);
});

test("voided settlement does not settle any debt", () => {
  const ctx = harness();
  const old = { ...payment(50, "TL"), settlement_id: "s1", version_no: 1,
    spent_on: "2026-11-01", created_at: "2026-11-01T12:00:00Z" };
  const voided = { ...old, version_no: 2, status: "voided", created_at: "2026-11-02T12:00:00Z" };
  const active = ctx.sandbox.latestSettlementsFromVersions([old, voided])
    .filter(s => s.status === "active");
  assert.equal(active.length, 0);
  assert.equal(ctx.exact([expense(100, "TL")], active)[0].amount, "50.00");
});

test("approximate view reports missing exchange rates, not false zero debt", () => {
  const result = harness().approx([expense(10, "EUR")]);
  assert.equal(result.debts.length, 0);
  assert.equal(result.missing.has("EUR"), true);
});

test("approximate view converts at stated rate and applies settlement", () => {
  const h = harness({ rates: { EUR: 40 } });
  const result = h.approx([expense(10, "EUR")], [payment(5, "EUR")]);
  assert.equal(result.missing.size, 0);
  assert.equal(result.debts.length, 0);
  // Once settlement is absent, a 5 EUR debt is represented as 200 TRY.
  const owing = h.approx([expense(10, "EUR")]);
  assert.equal(owing.debts.length, 1);
  assert.equal(owing.debts[0].minor, 20000);
});
