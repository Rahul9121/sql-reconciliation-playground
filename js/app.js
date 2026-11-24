/**
 * SQL Reconciliation Playground
 * DuckDB-WASM in the browser. All queries stay local.
 */
import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";

const DUCKDB_VERSION = "1.29.0";
const MAX_DISPLAY_ROWS = 500;

const el = {
  editor: document.getElementById("editor"),
  status: document.getElementById("status-line"),
  engine: document.getElementById("engine-badge"),
  run: document.getElementById("btn-run"),
  check: document.getElementById("btn-check"),
  solution: document.getElementById("btn-solution"),
  reset: document.getElementById("btn-reset"),
  resultMeta: document.getElementById("result-meta"),
  thead: document.querySelector("#result-table thead"),
  tbody: document.querySelector("#result-table tbody"),
  checkResult: document.getElementById("check-result"),
  challengeList: document.getElementById("challenge-list"),
  challengeCount: document.getElementById("challenge-count"),
  challengeDetail: document.getElementById("challenge-detail"),
  chTitle: document.getElementById("ch-title"),
  chDiff: document.getElementById("ch-diff"),
  chScenario: document.getElementById("ch-scenario"),
  chTopics: document.getElementById("ch-topics"),
  chHint: document.getElementById("ch-hint"),
  hintBox: document.getElementById("hint-box"),
  schema: document.getElementById("schema-browser"),
  modeChallenge: document.getElementById("mode-challenge"),
  modeFree: document.getElementById("mode-free"),
  challengePanel: document.getElementById("challenge-panel"),
};

let db = null;
let conn = null;
let challenges = [];
let currentChallenge = null;
let mode = "challenge";
let lastResult = null;
let expectedCache = new Map();

function setStatus(msg) {
  el.status.textContent = msg;
}

function basePath() {
  // Support project pages under /sql-reconciliation-playground/
  const path = window.location.pathname;
  if (path.endsWith(".html")) {
    return path.replace(/[^/]+$/, "");
  }
  return path.endsWith("/") ? path : path + "/";
}

async function fetchText(rel) {
  const url = new URL(rel, window.location.origin + basePath());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${rel}: ${res.status}`);
  return res.text();
}

async function fetchJson(rel) {
  const text = await fetchText(rel);
  return JSON.parse(text);
}

async function initDuckDB() {
  setStatus("Loading DuckDB-WASM bundles…");
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR);
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  conn = await db.connect();
  el.engine.textContent = `Engine: DuckDB-WASM ${DUCKDB_VERSION}`;
  setStatus("Loading synthetic CSV data…");
}

async function loadData() {
  const files = [
    ["trades.csv", "trades"],
    ["ledger_entries.csv", "ledger_entries"],
    ["accounts.csv", "accounts"],
  ];
  for (const [file, table] of files) {
    const text = await fetchText(`data/${file}`);
    await db.registerFileText(file, text);
    await conn.query(
      `CREATE OR REPLACE TABLE ${table} AS SELECT * FROM read_csv_auto('${file}', header=true, sample_size=-1);`
    );
  }
  const counts = await conn.query(
    `SELECT
      (SELECT COUNT(*) FROM trades) AS trades,
      (SELECT COUNT(*) FROM ledger_entries) AS ledger,
      (SELECT COUNT(*) FROM accounts) AS accounts`
  );
  const row = counts.toArray()[0];
  setStatus(`Ready · trades ${row.trades} · ledger ${row.ledger} · accounts ${row.accounts}`);
  el.schema.textContent = await buildSchemaText();
}

async function buildSchemaText() {
  const tables = ["trades", "ledger_entries", "accounts"];
  const parts = ["SYNTHETIC DATA — not real.\n"];
  for (const t of tables) {
    const desc = await conn.query(`DESCRIBE SELECT * FROM ${t}`);
    const rows = desc.toArray();
    const cnt = (await conn.query(`SELECT COUNT(*) AS c FROM ${t}`)).toArray()[0].c;
    parts.push(`${t}  (${cnt} rows)`);
    for (const r of rows) {
      parts.push(`  - ${r.column_name}: ${r.column_type}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

function materialize(table) {
  const cols = table.schema.fields.map((f) => f.name);
  const rows = table.toArray().map((r) => {
    const obj = {};
    for (const c of cols) {
      let v = r[c];
      if (typeof v === "bigint") v = Number(v);
      obj[c] = v;
    }
    return obj;
  });
  return { columns: cols, rows };
}

async function runSql(sql) {
  const started = performance.now();
  const table = await conn.query(sql);
  const ms = performance.now() - started;
  const result = materialize(table);
  result.ms = ms;
  return result;
}

function renderResult(result) {
  lastResult = result;
  const { columns, rows, ms } = result;
  const shown = rows.slice(0, MAX_DISPLAY_ROWS);
  el.thead.innerHTML = "";
  el.tbody.innerHTML = "";
  const trh = document.createElement("tr");
  for (const c of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = c;
    trh.appendChild(th);
  }
  el.thead.appendChild(trh);
  for (const row of shown) {
    const tr = document.createElement("tr");
    for (const c of columns) {
      const td = document.createElement("td");
      const v = row[c];
      td.textContent = v === null || v === undefined ? "NULL" : String(v);
      tr.appendChild(td);
    }
    el.tbody.appendChild(tr);
  }
  const trunc = rows.length > MAX_DISPLAY_ROWS ? ` (showing first ${MAX_DISPLAY_ROWS})` : "";
  el.resultMeta.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${ms.toFixed(1)} ms${trunc}`;
}

function normalizeValue(v, tolerance) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (tolerance != null) return Number(v.toFixed(6));
    return v;
  }
  if (typeof v === "bigint") return Number(v);
  const s = String(v);
  if (s !== "" && !Number.isNaN(Number(s)) && /^-?\d+(\.\d+)?$/.test(s.trim())) {
    const n = Number(s);
    if (tolerance != null) return Number(n.toFixed(6));
    return n;
  }
  return s;
}

function rowKey(row, columns, tolerance) {
  return columns.map((c) => JSON.stringify(normalizeValue(row[c], tolerance))).join("|");
}

function compareResults(actual, expected, orderMatters, tolerance) {
  if (actual.columns.length !== expected.columns.length) {
    return {
      ok: false,
      message: `Column count differs. Yours: ${actual.columns.length}, expected: ${expected.columns.length}.`,
    };
  }
  // Compare by name case-insensitive positionally? Prefer exact names ignoring case.
  const aCols = actual.columns.map((c) => c.toLowerCase());
  const eCols = expected.columns.map((c) => c.toLowerCase());
  for (let i = 0; i < eCols.length; i++) {
    if (aCols[i] !== eCols[i]) {
      return {
        ok: false,
        message: `Column mismatch at position ${i + 1}: got "${actual.columns[i]}", expected "${expected.columns[i]}".`,
      };
    }
  }
  if (actual.rows.length !== expected.rows.length) {
    return {
      ok: false,
      message: `Row count differs. Yours: ${actual.rows.length}, expected: ${expected.rows.length}.`,
    };
  }

  const cols = expected.columns;
  if (orderMatters) {
    for (let i = 0; i < expected.rows.length; i++) {
      for (let j = 0; j < cols.length; j++) {
        const ac = actual.columns[j];
        const ec = cols[j];
        const av = normalizeValue(actual.rows[i][ac], tolerance);
        const ev = normalizeValue(expected.rows[i][ec], tolerance);
        if (!valuesEqual(av, ev, tolerance)) {
          return {
            ok: false,
            message: `Mismatch at row ${i + 1}, column ${ec}: got ${fmt(av)}, expected ${fmt(ev)}.`,
          };
        }
      }
    }
    return { ok: true, message: "Match. Row order and values look correct." };
  }

  const expKeys = expected.rows.map((r) => rowKey(r, cols, tolerance)).sort();
  const actKeys = actual.rows
    .map((r) => {
      const mapped = {};
      cols.forEach((c, idx) => {
        mapped[c] = r[actual.columns[idx]];
      });
      return rowKey(mapped, cols, tolerance);
    })
    .sort();
  for (let i = 0; i < expKeys.length; i++) {
    if (expKeys[i] !== actKeys[i]) {
      return { ok: false, message: "Row multiset differs (order ignored). Check values and duplicates." };
    }
  }
  return { ok: true, message: "Match. Values look correct (row order ignored)." };
}

function valuesEqual(a, b, tolerance) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (typeof a === "number" && typeof b === "number") {
    if (tolerance != null) return Math.abs(a - b) <= tolerance;
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  return a === b;
}

function fmt(v) {
  return v === null ? "NULL" : JSON.stringify(v);
}

async function getExpected(challenge) {
  if (expectedCache.has(challenge.id)) return expectedCache.get(challenge.id);
  const result = await runSql(challenge.solution_sql);
  expectedCache.set(challenge.id, result);
  return result;
}

function showCheck(ok, message) {
  el.checkResult.hidden = false;
  el.checkResult.className = "check-result " + (ok ? "ok" : "bad");
  el.checkResult.textContent = message;
}

async function onRun() {
  el.checkResult.hidden = true;
  const sql = el.editor.value.trim();
  if (!sql) {
    setStatus("Write a SQL statement first.");
    return;
  }
  el.run.disabled = true;
  try {
    setStatus("Running…");
    const result = await runSql(sql);
    renderResult(result);
    setStatus("Done.");
  } catch (err) {
    el.thead.innerHTML = "";
    el.tbody.innerHTML = "";
    el.resultMeta.textContent = "Error";
    showCheck(false, String(err.message || err));
    setStatus("Query error.");
  } finally {
    el.run.disabled = false;
  }
}

async function onCheck() {
  if (!currentChallenge) return;
  try {
    setStatus("Checking…");
    const actual = await runSql(el.editor.value.trim());
    renderResult(actual);
    const expected = await getExpected(currentChallenge);
    const cmp = compareResults(
      actual,
      expected,
      !!currentChallenge.order_matters,
      currentChallenge.tolerance
    );
    showCheck(cmp.ok, cmp.message);
    setStatus(cmp.ok ? "Passed." : "Not a match yet.");
  } catch (err) {
    showCheck(false, String(err.message || err));
    setStatus("Check failed with an error.");
  }
}

function onSolution() {
  if (!currentChallenge) return;
  el.editor.value = currentChallenge.solution_sql;
  setStatus("Solution loaded into the editor. Run it or check it.");
}

function onReset() {
  if (!currentChallenge) return;
  el.editor.value = currentChallenge.starter_sql;
  el.checkResult.hidden = true;
  setStatus("Starter SQL restored.");
}

function selectChallenge(ch, button) {
  currentChallenge = ch;
  el.challengeDetail.hidden = false;
  el.chTitle.textContent = ch.title;
  el.chDiff.textContent = ch.difficulty;
  el.chDiff.className = "pill " + ch.difficulty;
  el.chScenario.textContent = ch.scenario;
  el.chTopics.textContent = "Topics: " + (ch.topics || []).join(", ");
  el.chHint.textContent = ch.hint;
  el.hintBox.open = false;
  el.editor.value = ch.starter_sql;
  el.check.hidden = false;
  el.solution.hidden = false;
  el.reset.hidden = false;
  el.checkResult.hidden = true;
  for (const btn of el.challengeList.querySelectorAll("button")) {
    btn.classList.toggle("active", btn === button);
  }
  setStatus(`Loaded: ${ch.title}`);
}

function renderChallengeList() {
  el.challengeList.innerHTML = "";
  el.challengeCount.textContent = `(${challenges.length})`;
  challenges.forEach((ch, idx) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span class="title">${idx + 1}. ${escapeHtml(ch.title)}</span><span class="meta">${escapeHtml(ch.difficulty)} · ${escapeHtml((ch.topics || []).slice(0, 2).join(", "))}</span>`;
    btn.addEventListener("click", () => selectChallenge(ch, btn));
    li.appendChild(btn);
    el.challengeList.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setMode(next) {
  mode = next;
  const isChallenge = mode === "challenge";
  el.modeChallenge.classList.toggle("active", isChallenge);
  el.modeFree.classList.toggle("active", !isChallenge);
  el.modeChallenge.setAttribute("aria-pressed", String(isChallenge));
  el.modeFree.setAttribute("aria-pressed", String(!isChallenge));
  el.challengePanel.hidden = !isChallenge;
  el.challengeDetail.hidden = !isChallenge || !currentChallenge;
  el.check.hidden = !isChallenge || !currentChallenge;
  el.solution.hidden = !isChallenge || !currentChallenge;
  el.reset.hidden = !isChallenge || !currentChallenge;
  if (!isChallenge) {
    el.editor.value =
      "-- Free query mode\n-- Tables: trades, ledger_entries, accounts\nSELECT * FROM trades LIMIT 10;";
    el.checkResult.hidden = true;
    setStatus("Free query mode.");
  } else if (currentChallenge) {
    setStatus(`Challenge mode · ${currentChallenge.title}`);
  } else {
    setStatus("Pick a challenge.");
  }
}

function wireEditor() {
  el.editor.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onRun();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const start = el.editor.selectionStart;
      const end = el.editor.selectionEnd;
      const v = el.editor.value;
      el.editor.value = v.slice(0, start) + "  " + v.slice(end);
      el.editor.selectionStart = el.editor.selectionEnd = start + 2;
    }
  });
  el.run.addEventListener("click", onRun);
  el.check.addEventListener("click", onCheck);
  el.solution.addEventListener("click", onSolution);
  el.reset.addEventListener("click", onReset);
  el.modeChallenge.addEventListener("click", () => setMode("challenge"));
  el.modeFree.addEventListener("click", () => setMode("free"));
}

function showWelcome() {
  const overlay = document.getElementById("welcome-overlay");
  const startBtn = document.getElementById("welcome-start");
  if (!overlay || !startBtn) return;

  const previouslyFocused = document.activeElement;

  function onKeydown(e) {
    if (overlay.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeWelcome();
    } else if (e.key === "Tab") {
      e.preventDefault();
      startBtn.focus();
    }
  }

  function onOverlayClick(e) {
    if (e.target === overlay) closeWelcome();
  }

  function closeWelcome() {
    overlay.hidden = true;
    document.body.classList.remove("welcome-open");
    document.removeEventListener("keydown", onKeydown, true);
    overlay.removeEventListener("click", onOverlayClick);
    startBtn.removeEventListener("click", closeWelcome);
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    } else {
      el.editor.focus();
    }
  }

  overlay.hidden = false;
  document.body.classList.add("welcome-open");
  startBtn.addEventListener("click", closeWelcome);
  overlay.addEventListener("click", onOverlayClick);
  document.addEventListener("keydown", onKeydown, true);
  startBtn.focus();
}

async function main() {
  wireEditor();
  showWelcome();
  el.run.disabled = true;
  try {
    await initDuckDB();
    await loadData();
    challenges = await fetchJson("data/challenges.json");
    renderChallengeList();
    if (challenges.length) {
      const firstBtn = el.challengeList.querySelector("button");
      selectChallenge(challenges[0], firstBtn);
    }
    el.run.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus("Failed to start: " + (err.message || err));
    el.engine.textContent = "Engine: failed to load";
    showCheck(false, String(err.message || err));
  }
}

main();
