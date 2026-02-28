// history.js (fixed image resolving + better column mapping)
// - loads ALL trades
// - images: supports either full URL in before_url/after_url OR storage path like trades/xxx.jpg

const TABLE_NAME = "trades";

const COLUMN_MAP = {
  id: ["id"],
  // Prefer created_at; fallback to date
  created_at: ["created_at", "date"],

  pair: ["pair", "symbol", "market"],
  bias: ["htf_bias", "bias", "direction", "side", "type"],
  result: ["result", "outcome", "status"],

  sl: ["sl", "stop", "stop_loss"],
  tp: ["tp", "take_profit"],
  r: ["rr", "r", "r_multiple", "rmultiple"],
  profit: ["pnl", "profit", "net", "amount"],
  notes: ["notes", "comment"],

  before_img: ["before_url", "before_img", "before_path"],
  after_img: ["after_url", "after_img", "after_path"],
};

let allTrades = [];
let chart;

/* ---------- Helpers ---------- */
function getClient() {
  const candidates = [window.supabaseClient, window.sb, window.client, window.supabase];
  for (const c of candidates) if (c && typeof c.from === "function") return c;
  return null;
}

function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return null;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  if (!v) return null;
  // if it's a pure date like 2026-02-28, Date() works fine
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d) return "—";
  // If stored value was just date, show date only
  return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit" });
}

function fmtNum(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
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
  if (b.includes("BULL") || b.includes("BUY") || b === "LONG") return { text:"BULL", cls:"good" };
  if (b.includes("BEAR") || b.includes("SELL") || b === "SHORT") return { text:"BEAR", cls:"bad" };
  return { text: b || "—", cls:"" };
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* Resolve image:
   - if it's already a URL -> use it
   - if it's a path like trades/xxx.jpg -> convert to public url
*/
function resolveImg(maybeUrlOrPath) {
  if (!maybeUrlOrPath) return null;
  const s = String(maybeUrlOrPath);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  // treat as path in the bucket
  try {
    const { data } = sb.storage.from("trade-images").getPublicUrl(s);
    return data.publicUrl;
  } catch {
    return null;
  }
}

function normalizeTrade(row) {
  const createdRaw = pick(row, COLUMN_MAP.created_at);

  const resultRaw = (pick(row, COLUMN_MAP.result) ?? "").toString().toLowerCase();
  let result = resultRaw;
  if (result.includes("break")) result = "be";
  if (result === "tp") result = "win";
  if (result === "sl") result = "loss";
  if (!["win","loss","be"].includes(result)) result = "";

  const d = parseDate(createdRaw);

  const t = {
    raw: row,
    id: pick(row, COLUMN_MAP.id) ?? crypto.randomUUID(),
    created_at: createdRaw,
    pair: (pick(row, COLUMN_MAP.pair) ?? "—").toString().toUpperCase(),
    bias: (pick(row, COLUMN_MAP.bias) ?? "").toString(),
    result,
    sl: pick(row, COLUMN_MAP.sl),
    tp: pick(row, COLUMN_MAP.tp),
    r: toNum(pick(row, COLUMN_MAP.r)),
    profit: toNum(pick(row, COLUMN_MAP.profit)),
    notes: (pick(row, COLUMN_MAP.notes) ?? "").toString(),
    before_img: resolveImg(pick(row, COLUMN_MAP.before_img)),
    after_img: resolveImg(pick(row, COLUMN_MAP.after_img)),
    dateObj: d,
    monthKey: d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` : "unknown",
  };

  return t;
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
      No Supabase client found. Make sure <code>supabase.js</code> sets <code>window.sb</code>.
    </div>`;
    return [];
  }

  historyContainer.innerHTML = `<div class="state">Loading trades…</div>`;

  const { data, error } = await client
    .from(TABLE_NAME)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    historyContainer.innerHTML = `<div class="state">
      <b>Could not load trades.</b><br>${escapeHtml(error.message)}
    </div>`;
    return [];
  }

  lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
  return (data || []).map(normalizeTrade);
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

  const winRate = total ? (wins / total) * 100 : 0;
  const net = trades.reduce((s,t)=> s + (t.profit ?? 0), 0);
  const avgR = total ? (trades.reduce((s,t)=> s + (t.r ?? 0), 0) / total) : 0;

  return { total, wins, losses, bes, winRate, net, avgR };
}

function groupByMonth(trades) {
  const map = new Map();
  for (const t of trades) {
    const key = t.monthKey;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  const rows = [...map.entries()]
    .map(([month, list]) => {
      const s = calcStats(list);
      return { month, ...s };
    })
    .sort((a,b)=> a.month.localeCompare(b.month));
  return rows;
}

/* ---------- Render ---------- */
function renderKpis(trades) {
  const s = calcStats(trades);

  kpiTrades.textContent = s.total;
  kpiWins.textContent = s.wins;
  kpiLosses.textContent = s.losses;
  kpiBE.textContent = s.bes;

  kpiWinRate.textContent = `${s.winRate.toFixed(1)}%`;
  kpiProfit.textContent = fmtNum(s.net, 2);
  kpiAvgR.textContent = fmtNum(s.avgR, 2);
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
        <div class="field"><b>SL</b><span>${t.sl ?? "—"}</span></div>
        <div class="field"><b>TP</b><span>${t.tp ?? "—"}</span></div>
        <div class="field"><b>Month</b><span>${escapeHtml(t.monthKey)}</span></div>
        <div class="field"><b>Result</b><span class="${resultCls}">${chipLabel(t.result)}</span></div>
        <div class="field"><b>ID</b><span>${escapeHtml(String(t.id).slice(0,8))}</span></div>
      </div>

      <div class="tradeImages">
        ${t.before_img ? `
          <div class="thumb" data-src="${escapeHtml(t.before_img)}" data-title="${escapeHtml(t.pair)} • Before">
            <img src="${escapeHtml(t.before_img)}" alt="Before" loading="lazy"/>
            <div class="thumbTitle">Before</div>
          </div>` : ""}
        ${t.after_img ? `
          <div class="thumb" data-src="${escapeHtml(t.after_img)}" data-title="${escapeHtml(t.pair)} • After">
            <img src="${escapeHtml(t.after_img)}" alt="After" loading="lazy"/>
            <div class="thumbTitle">After</div>
          </div>` : ""}
      </div>
    `;

    card.querySelectorAll(".thumb").forEach(th => {
      th.addEventListener("click", () => openModal(th.dataset.src, th.dataset.title));
    });

    historyContainer.appendChild(card);
  }
}

function renderMonthly(rows) {
  // Month dropdown
  monthFilter.innerHTML = `<option value="">All months</option>` + rows.map(r =>
    `<option value="${r.month}">${r.month}</option>`
  ).join("");

  // Table
  if (!rows.length) {
    monthlyTable.innerHTML = `<tr><td colspan="6" class="state">No data yet.</td></tr>`;
    return;
  }

  monthlyTable.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.month)}</td>
      <td class="num">${r.total}</td>
      <td class="num">${r.wins}</td>
      <td class="num">${r.total ? (r.winRate.toFixed(1) + "%") : "—"}</td>
      <td class="num">${fmtNum(r.net, 2)}</td>
      <td class="num">${fmtNum(r.avgR, 2)}</td>
    </tr>
  `).join("");

  monthSummary.textContent = `${rows.length} month(s)`;
}

/* ---------- Filters wiring ---------- */
function populatePairFilter(trades) {
  const pairs = [...new Set(trades.map(t => t.pair).filter(Boolean))].sort();
  pairFilter.innerHTML = `<option value="">All pairs</option>` + pairs.map(p => `<option value="${p}">${p}</option>`).join("");
}

function rerender() {
  const filtered = applyFilters(allTrades);
  renderKpis(filtered);
  renderTrades(filtered);
  renderMonthly(groupByMonth(filtered));
}

async function init() {
  allTrades = await fetchTrades();
  populatePairFilter(allTrades);
  rerender();
}

refreshBtn.addEventListener("click", init);
[searchInput, resultFilter, monthFilter, pairFilter].forEach(x => x.addEventListener("input", rerender));
[searchInput, resultFilter, monthFilter, pairFilter].forEach(x => x.addEventListener("change", rerender));

// CSV export (simple)
exportBtn.addEventListener("click", () => {
  const rows = applyFilters(allTrades).map(t => ({
    id: t.id,
    date: t.created_at,
    pair: t.pair,
    bias: t.bias,
    result: t.result,
    rr: t.r,
    pnl: t.profit,
    notes: t.notes,
    before_img: t.before_img,
    after_img: t.after_img,
  }));

  const headers = Object.keys(rows[0] || { id: "" });
  const csv = [headers.join(",")].concat(
    rows.map(r => headers.map(h => `"${String(r[h] ?? "").replaceAll('"','""')}"`).join(","))
  ).join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kingfx_trades.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

init();
