/* KìñgFX History & Analytics
   - Win rate auto-calculation
   - Monthly profit breakdown (chart + table)
   - Filterable trade cards
   - CSV export

   IMPORTANT:
   This script tries to find an existing Supabase client from your supabase.js.
   Common patterns it supports:
     window.supabase
     window.sb
     window.client
     window.supabaseClient

   Then it fetches from a table (default: "trades").

   === YOU MAY NEED TO MAP YOUR COLUMN NAMES ===
   Edit the COLUMN_MAP below to match your DB schema.
*/

const TABLE_NAME = "trades";

/** Map your database columns to the fields used in this UI */
const COLUMN_MAP = {
  id: ["id"],
  created_at: ["created_at", "date", "time"],

  // Your table (make sure you actually have a pair column)
  pair: ["pair", "symbol", "market"],

  bias: ["bias", "direction", "side", "type", "htf_bias"],

  // Your table uses these
  result: ["result", "outcome", "status"],
  entry: ["entry", "entry_price"],
  sl: ["sl", "stop", "stop_loss"],
  tp: ["tp", "take_profit"],

  // IMPORTANT: your RR column is "rr"
  r: ["rr", "r", "r_multiple", "rmultiple"],

  // IMPORTANT: your profit column is "pnl"
  profit: ["pnl", "profit", "net", "amount"],

  notes: ["notes", "comment", "model", "reason", "emotions"],

  // IMPORTANT: your image columns are before_url / after_url
  before_img: ["before_url", "before_img", "before", "before_url", "img_before"],
  after_img: ["after_url", "after_img", "after", "after_url", "img_after"],
};
let allTrades = [];
let chart;

/* ---------- Helpers ---------- */
function getClient() {
  return window.supabase || window.sb || window.client || window.supabaseClient || null;
}

function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return null;
}

function normalizeTrade(row) {
  // Normalize raw DB row into a consistent object
  const t = {
    raw: row,
    id: pick(row, COLUMN_MAP.id) ?? crypto.randomUUID(),
    created_at: pick(row, COLUMN_MAP.created_at),
    pair: (pick(row, COLUMN_MAP.pair) ?? "—").toString().toUpperCase(),
    bias: (pick(row, COLUMN_MAP.bias) ?? "").toString().toUpperCase(),
    result: (pick(row, COLUMN_MAP.result) ?? "").toString().toLowerCase(),
    entry: pick(row, COLUMN_MAP.entry),
    sl: pick(row, COLUMN_MAP.sl),
    tp: pick(row, COLUMN_MAP.tp),
    r: toNum(pick(row, COLUMN_MAP.r)),
    profit: toNum(pick(row, COLUMN_MAP.profit)),
    notes: (pick(row, COLUMN_MAP.notes) ?? "").toString(),
    before_img: pick(row, COLUMN_MAP.before_img),
    after_img: pick(row, COLUMN_MAP.after_img),
  };

  // Normalize result labels
  // Accept "win/loss/be", also "breakeven", "break even", "tp", "sl"
  if (t.result.includes("break")) t.result = "be";
  if (t.result === "tp") t.result = "win";
  if (t.result === "sl") t.result = "loss";
  if (!["win","loss","be"].includes(t.result)) t.result = "";

  // Parse date
  t.dateObj = parseDate(t.created_at);
  t.monthKey = t.dateObj ? `${t.dateObj.getFullYear()}-${String(t.dateObj.getMonth()+1).padStart(2,"0")}` : "unknown";

  return t;
}

function parseDate(v) {
  if (!v) return null;
  // Supabase often returns ISO strings
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function fmtDate(d) {
  if (!d) return "—";
  return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(n, dp=2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  // Keep it generic (could be $ or ₦); you can change the currency code below.
  try {
    return new Intl.NumberFormat(undefined, { style:"currency", currency:"USD", maximumFractionDigits: 2 }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

function clsResult(r) {
  if (r === "win") return "good";
  if (r === "loss") return "bad";
  if (r === "be") return "warn";
  return "";
}

function chipLabel(r) {
  if (r === "win") return "WIN";
  if (r === "loss") return "LOSS";
  if (r === "be") return "BE";
  return "—";
}

function biasChip(bias) {
  const b = (bias || "").toUpperCase();
  if (b.includes("BUY") || b === "LONG") return { text:"BUY", cls:"good" };
  if (b.includes("SELL") || b === "SHORT") return { text:"SELL", cls:"bad" };
  return { text: b || "—", cls:"" };
}

/* ---------- DOM ---------- */
const el = (id) => document.getElementById(id);

const historyContainer = el("historyContainer");
const refreshBtn = el("refreshBtn");
const exportBtn = el("exportBtn");
const searchInput = el("searchInput");
const resultFilter = el("resultFilter");
const monthFilter = el("monthFilter");
const pairFilter = el("pairFilter");
const tradeCountLabel = el("tradeCountLabel");
const lastUpdated = el("lastUpdated");

const kpiTrades = el("kpiTrades");
const kpiWinRate = el("kpiWinRate");
const kpiWins = el("kpiWins");
const kpiLosses = el("kpiLosses");
const kpiBE = el("kpiBE");
const kpiProfit = el("kpiProfit");
const kpiAvgR = el("kpiAvgR");

const monthSummary = el("monthSummary");
const monthlyTable = el("monthlyTable").querySelector("tbody");

const imgModal = el("imgModal");
const modalTitle = el("modalTitle");
const modalImg = el("modalImg");
const closeModalBtn = el("closeModalBtn");

/* ---------- Modal ---------- */
function openModal(src, title) {
  if (!src) return;
  modalImg.src = src;
  modalTitle.textContent = title || "Preview";
  imgModal.classList.add("show");
}
function closeModal(){
  imgModal.classList.remove("show");
  modalImg.src = "";
}
imgModal.addEventListener("click", (e) => { if (e.target === imgModal) closeModal(); });
closeModalBtn.addEventListener("click", closeModal);

/* ---------- Fetch Trades ---------- */
async function fetchTrades() {
  const client = getClient();
  if (!client) {
    historyContainer.innerHTML = `<div class="state">
      I couldn't find your Supabase client. Make sure <b>supabase.js</b> sets one of these globals:
      <code>window.supabase</code>, <code>window.sb</code>, <code>window.client</code>, or <code>window.supabaseClient</code>.
      <br><br>Then refresh.
    </div>`;
    return [];
  }

  historyContainer.innerHTML = `<div class="state">Loading trades…</div>`;

  // Fetch all rows. If you have many trades, add pagination or date range.
  const { data, error } = await client
    .from(TABLE_NAME)
    .select("*")
    .order(pickOrderColumn(), { ascending: false });

  if (error) {
    historyContainer.innerHTML = `<div class="state">
      <b>Could not load trades.</b><br>
      ${escapeHtml(error.message)}<br><br>
      Check TABLE_NAME (<code>${TABLE_NAME}</code>) and your Supabase permissions (RLS).
    </div>`;
    return [];
  }

  const normalized = (data || []).map(normalizeTrade);

  lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
  return normalized;
}

function pickOrderColumn() {
  // Prefer created_at if it exists
  return "created_at";
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ---------- Filters ---------- */
function applyFilters(trades) {
  const q = (searchInput.value || "").trim().toLowerCase();
  const rf = resultFilter.value;
  const mf = monthFilter.value;
  const pf = pairFilter.value;

  return trades.filter(t => {
    if (rf && t.result !== rf) return false;
    if (mf && t.monthKey !== mf) return false;
    if (pf && t.pair !== pf) return false;
    if (q) {
      const hay = `${t.pair} ${t.bias} ${t.result} ${t.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- Analytics ---------- */
function calcStats(trades) {
  const total = trades.length;
  const wins = trades.filter(t => t.result === "win").length;
  const losses = trades.filter(t => t.result === "loss").length;
  const bes = trades.filter(t => t.result === "be").length;

  const denom = (wins + losses); // usually BE excluded from win rate
  const winRate = denom > 0 ? (wins / denom) * 100 : 0;

  const profitSum = trades.reduce((acc,t) => acc + (t.profit ?? 0), 0);

  const rValues = trades.map(t => t.r).filter(v => Number.isFinite(v));
  const avgR = rValues.length ? (rValues.reduce((a,b)=>a+b,0) / rValues.length) : null;

  return { total, wins, losses, bes, winRate, profitSum, avgR };
}

function groupByMonth(trades) {
  const map = new Map();
  for (const t of trades) {
    const key = t.monthKey || "unknown";
    if (!map.has(key)) map.set(key, { monthKey:key, trades:0, wins:0, losses:0, bes:0, profit:0, rSum:0, rCount:0 });
    const m = map.get(key);
    m.trades += 1;
    if (t.result === "win") m.wins += 1;
    if (t.result === "loss") m.losses += 1;
    if (t.result === "be") m.bes += 1;
    m.profit += (t.profit ?? 0);
    if (Number.isFinite(t.r)) { m.rSum += t.r; m.rCount += 1; }
  }

  // Sort by monthKey ascending (unknown last)
  const rows = Array.from(map.values()).sort((a,b)=>{
    if (a.monthKey === "unknown") return 1;
    if (b.monthKey === "unknown") return -1;
    return a.monthKey.localeCompare(b.monthKey);
  });

  for (const r of rows) {
    const denom = r.wins + r.losses;
    r.winRate = denom ? (r.wins/denom)*100 : 0;
    r.avgR = r.rCount ? (r.rSum/r.rCount) : null;
  }
  return rows;
}

/* ---------- Rendering ---------- */
function renderKPIs(stats) {
  kpiTrades.textContent = stats.total.toString();
  kpiWins.textContent = stats.wins.toString();
  kpiLosses.textContent = stats.losses.toString();
  kpiBE.textContent = stats.bes.toString();

  kpiWinRate.textContent = `${stats.winRate.toFixed(1)}%`;
  kpiProfit.textContent = fmtMoney(stats.profitSum);
  kpiAvgR.textContent = stats.avgR === null ? "—" : stats.avgR.toFixed(2);

  // Add color hint to win rate
  kpiWinRate.classList.remove("good","bad","warn");
  if (stats.winRate >= 55) kpiWinRate.classList.add("good");
  else if (stats.winRate >= 45) kpiWinRate.classList.add("warn");
  else kpiWinRate.classList.add("bad");
}

function renderTrades(trades) {
  tradeCountLabel.textContent = `${trades.length} trade(s) shown`;

  if (!trades.length) {
    historyContainer.innerHTML = `<div class="state">No trades match your filter.</div>`;
    return;
  }

  historyContainer.innerHTML = "";
  for (const t of trades) {
    const card = document.createElement("div");
    card.className = "tradeCard";

    const resultCls = clsResult(t.result);
    const bias = biasChip(t.bias);

    card.innerHTML = `
      <div class="tradeTop">
        <div>
          <div class="pair">${escapeHtml(t.pair)}</div>
          <div class="meta">${escapeHtml(fmtDate(t.dateObj))}${t.notes ? " • " + escapeHtml(t.notes) : ""}</div>
        </div>
        <div class="chips">
          <span class="chip ${bias.cls}">${escapeHtml(bias.text)}</span>
          <span class="chip ${resultCls}">${chipLabel(t.result)}</span>
          <span class="chip">${t.r === null ? "R: —" : "R: " + fmtNum(t.r,2)}</span>
          <span class="chip">${t.profit === null ? "P: —" : "P: " + fmtNum(t.profit,2)}</span>
        </div>
      </div>

      <div class="tradeInfo">
        <div class="field"><b>Entry</b><span>${t.entry ?? "—"}</span></div>
        <div class="field"><b>SL</b><span>${t.sl ?? "—"}</span></div>
        <div class="field"><b>TP</b><span>${t.tp ?? "—"}</span></div>
        <div class="field"><b>Month</b><span>${escapeHtml(t.monthKey)}</span></div>
        <div class="field"><b>Result</b><span class="${resultCls}">${chipLabel(t.result)}</span></div>
        <div class="field"><b>ID</b><span>${escapeHtml(String(t.id).slice(0,8))}</span></div>
      </div>

      <div class="tradeImages">
        ${t.before_img ? `
          <div class="thumb" data-src="${escapeHtml(t.before_img)}" data-title="${escapeHtml(t.pair)} • Before">
            <img src="${escapeHtml(t.before_img)}" alt="Before"/>
            <div class="thumbTitle">Before</div>
          </div>` : ""}
        ${t.after_img ? `
          <div class="thumb" data-src="${escapeHtml(t.after_img)}" data-title="${escapeHtml(t.pair)} • After">
            <img src="${escapeHtml(t.after_img)}" alt="After"/>
            <div class="thumbTitle">After</div>
          </div>` : ""}
      </div>
    `;

    // Click handlers for images
    card.querySelectorAll(".thumb").forEach(th => {
      th.addEventListener("click", () => openModal(th.dataset.src, th.dataset.title));
    });

    historyContainer.appendChild(card);
  }
}

function renderMonthly(rows) {
  // Summary (best/worst month)
  const known = rows.filter(r => r.monthKey !== "unknown");
  if (!known.length) {
    monthSummary.textContent = "—";
  } else {
    const best = [...known].sort((a,b)=>b.profit-a.profit)[0];
    const worst = [...known].sort((a,b)=>a.profit-b.profit)[0];
    monthSummary.textContent = `Best: ${best.monthKey} (${fmtNum(best.profit,2)}) • Worst: ${worst.monthKey} (${fmtNum(worst.profit,2)})`;
  }

  // Table
  monthlyTable.innerHTML = "";
  for (const r of rows.slice().reverse()) { // latest first in table
    const tr = document.createElement("tr");
    const profitCls = r.profit >= 0 ? "good" : "bad";
    tr.innerHTML = `
      <td>${escapeHtml(r.monthKey)}</td>
      <td class="num">${r.trades}</td>
      <td class="num">${r.wins}</td>
      <td class="num">${r.winRate.toFixed(1)}%</td>
      <td class="num ${profitCls}">${fmtNum(r.profit,2)}</td>
      <td class="num">${r.avgR === null ? "—" : r.avgR.toFixed(2)}</td>
    `;
    monthlyTable.appendChild(tr);
  }

  // Chart
  const labels = known.map(r => r.monthKey);
  const values = known.map(r => r.profit);

  const ctx = document.getElementById("monthlyChart");
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Monthly Profit",
        data: values,
        backgroundColor: "rgba(255, 26, 26, 0.55)",
        borderColor: "rgba(255, 26, 26, 0.95)",
        borderWidth: 1.5,
        borderRadius: 8,
      }]
      },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { mode: "index", intersect: false }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(255, 26, 26, 0.10)" } }
      }
    }
  });
}

/* ---------- Select options ---------- */
function buildFilters(trades) {
  // Month options
  const months = Array.from(new Set(trades.map(t => t.monthKey))).filter(m => m !== "unknown").sort();
  monthFilter.innerHTML = `<option value="">All months</option>` + months.map(m => `<option value="${m}">${m}</option>`).join("");

  // Pair options
  const pairs = Array.from(new Set(trades.map(t => t.pair))).sort();
  pairFilter.innerHTML = `<option value="">All pairs</option>` + pairs.map(p => `<option value="${p}">${p}</option>`).join("");
}

/* ---------- CSV Export ---------- */
function exportCSV(trades) {
  const cols = ["created_at","pair","bias","result","entry","sl","tp","r","profit","notes","before_img","after_img"];
  const lines = [
    cols.join(","),
    ...trades.map(t => cols.map(c => csvCell(t[c] ?? (c==="created_at" ? (t.created_at ?? "") : ""))).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kingfx_history_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replaceAll('"','""')}"`;
  return s;
}

/* ---------- Main render pipeline ---------- */
function rerender() {
  const filtered = applyFilters(allTrades);
  const stats = calcStats(filtered);

  renderKPIs(stats);
  renderTrades(filtered);

  const monthly = groupByMonth(filtered);
  renderMonthly(monthly);
}

async function load() {
  allTrades = await fetchTrades();
  buildFilters(allTrades);
  rerender();
}

/* ---------- Events ---------- */
[searchInput, resultFilter, monthFilter, pairFilter].forEach(x => x.addEventListener("input", rerender));
refreshBtn.addEventListener("click", load);
exportBtn.addEventListener("click", () => exportCSV(applyFilters(allTrades)));

/* Init */
load();
