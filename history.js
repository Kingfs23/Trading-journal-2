const LOCAL_KEY = "kingfx_trades";
const DELETED_KEY = "kingfx_deleted_trades";
const REMOTE_TIMEOUT_MS = 8000;

let allTrades = [];
let remoteRowsCache = [];
let loadToken = 0;

const el = (id) => document.getElementById(id);
const historyContainer = el("historyContainer");
const refreshBtn = el("refreshBtn");
const exportBtn = el("exportBtn");
const searchInput = el("searchInput");
const resultFilter = el("resultFilter");
const pairFilter = el("pairFilter");
const tradeCountLabel = el("tradeCountLabel");
const lastUpdated = el("lastUpdated");
const monthlyTable = el("monthlyTable");
const pairStatsTable = el("pairStatsTable");

const kpiTrades = el("kpiTrades");
const kpiWinRate = el("kpiWinRate");
const kpiWins = el("kpiWins");
const kpiLosses = el("kpiLosses");
const kpiBE = el("kpiBE");
const kpiProfit = el("kpiProfit");
const kpiAvgR = el("kpiAvgR");

const imgModal = el("imgModal");
const modalTitle = el("modalTitle");
const modalImg = el("modalImg");
const closeModalBtn = el("closeModalBtn");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readLocalTrades() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function readImportedTrades() {
  return Array.isArray(window.KINGFX_IMPORTED_TRADES) ? window.KINGFX_IMPORTED_TRADES : [];
}

function saveLocalTrades(trades) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trades));
  } catch (error) {
    console.warn("Could not save local trades:", error.message);
  }
}

function readDeletedTradeKeys() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveDeletedTradeKeys(keys) {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...keys]));
  } catch (error) {
    console.warn("Could not remember deleted trades:", error.message);
  }
}

function pick(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null && row?.[name] !== "") return row[name];
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRMultiple(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  if (!text) return null;

  if (text.includes(":")) {
    const [risk, reward] = text.split(":").map((part) => Number(part.trim()));
    if (risk > 0 && Number.isFinite(reward)) return reward / risk;
  }

  const parsed = Number(text.replace(/[rR]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeResult(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "win" || raw === "won" || raw === "tp" || raw.includes("profit")) return "win";
  if (raw === "loss" || raw === "lost" || raw === "sl" || raw.includes("stop")) return "loss";
  if (raw === "be" || raw.includes("break")) return "be";
  return "";
}

function parseTradeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const text = String(value).trim();
  const slashDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDate) {
    const [, day, month, year] = slashDate;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function deriveActualR(plannedR, pnl, risk, result) {
  if (Number.isFinite(pnl) && Number.isFinite(risk) && risk > 0) return pnl / risk;
  if (result === "be") return 0;
  if (result === "loss" && Number.isFinite(plannedR)) return -1;
  if (result === "win" && Number.isFinite(plannedR)) return plannedR;
  return Number.isFinite(plannedR) ? plannedR : null;
}

function resolveImage(value) {
  if (!value) return null;
  const text = String(value);
  if (text.startsWith("data:image/") || text.startsWith("http://") || text.startsWith("https://")) return text;

  try {
    return window.sb?.storage?.from("trade-images").getPublicUrl(text).data.publicUrl || null;
  } catch {
    return null;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeTrade(row) {
  const rawId = pick(row, ["id"]);
  const localId = pick(row, ["local_id"]);
  const importId = pick(row, ["import_id"]);
  const dateRaw = pick(row, ["date", "created_at", "entry_date"]);
  const date = parseTradeDate(dateRaw);
  const pnl = toNumber(pick(row, ["pnl", "profit", "net", "amount"]));
  const risk = toNumber(pick(row, ["risk"]));
  let result = normalizeResult(pick(row, ["result", "outcome", "status"]));
  if (!result && Number.isFinite(pnl)) {
    result = pnl > 0 ? "win" : (pnl < 0 ? "loss" : "be");
  }
  const plannedR = parseRMultiple(pick(row, ["r_multiple", "rr", "r", "r_multiple_result"]));
  const rMultiple = deriveActualR(plannedR, pnl, risk, result);
  const monthKey = date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    : "Unknown";

  return {
    id: rawId || localId || importId || safeId(),
    remote_id: isUuid(rawId) ? rawId : "",
    local_id: localId || "",
    import_id: importId || "",
    created_at: pick(row, ["created_at"]) || dateRaw || "",
    dateRaw,
    date,
    monthKey,
    pair: String(pick(row, ["pair", "symbol", "market"]) || "Unknown").toUpperCase(),
    bias: String(pick(row, ["htf_bias", "bias", "direction"]) || "Neutral"),
    poi: pick(row, ["poi"]) || "",
    inducement: pick(row, ["inducement"]) || "",
    sl: pick(row, ["sl", "stop", "stop_loss"]) || "",
    tp: pick(row, ["tp", "take_profit"]) || "",
    rr: pick(row, ["rr", "r"]) || "",
    risk,
    rMultiple,
    pnl,
    result,
    notes: pick(row, ["notes", "comment"]) || "",
    emotions: pick(row, ["emotions"]) || "",
    improve_win: pick(row, ["improve_win"]) || "",
    improve_loss: pick(row, ["improve_loss"]) || "",
    improve_be: pick(row, ["improve_be"]) || "",
    source: pick(row, ["source", "import_source"]) || "",
    before_url: resolveImage(pick(row, ["before_local_url", "before_url", "before_img", "before_path"])),
    after_url: resolveImage(pick(row, ["after_local_url", "after_url", "after_img", "after_path"])),
    sync_status: row.sync_status || (importId ? "imported" : (row.local_id ? "local" : "synced")),
  };
}

function tradeSignature(trade) {
  return [
    trade.dateRaw || "",
    trade.pair || "",
    trade.result || "",
    trade.pnl ?? "",
    trade.risk ?? "",
    trade.rr || "",
    trade.notes || "",
  ].join("|").toLowerCase();
}

function tradeDeleteKeys(trade) {
  return [
    trade.remote_id,
    trade.local_id,
    trade.import_id,
    trade.id,
    tradeSignature(trade),
  ].filter(Boolean).map(String);
}

function tradeDeleteKey(trade) {
  return trade.remote_id || trade.local_id || trade.import_id || trade.id || tradeSignature(trade);
}

function bestImage(first, second) {
  if (String(first || "").startsWith("data:image/")) return first;
  if (String(second || "").startsWith("data:image/")) return second;
  return first || second || null;
}

function mergeSyncStatus(existing, incoming) {
  const statuses = [existing?.sync_status, incoming?.sync_status];
  if (statuses.includes("synced")) return "synced";
  if (statuses.includes("local")) return "local";
  if (statuses.includes("imported")) return "imported";
  return "";
}

function mergeTradeData(existing, incoming) {
  if (!existing) return incoming;

  return {
    ...existing,
    ...incoming,
    id: existing.id || incoming.id,
    remote_id: existing.remote_id || incoming.remote_id,
    local_id: existing.local_id || incoming.local_id,
    import_id: existing.import_id || incoming.import_id,
    created_at: existing.created_at || incoming.created_at,
    source: existing.source || incoming.source,
    before_url: bestImage(existing.before_url, incoming.before_url),
    after_url: bestImage(existing.after_url, incoming.after_url),
    sync_status: mergeSyncStatus(existing, incoming),
  };
}

function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

async function fetchRemoteTradesFromSupabase() {
  if (!window.sb?.from) return [];

  let { data, error } = await window.sb
    .from("trades")
    .select("*")
    .order("date", { ascending: false });

  if (error) {
    const fallback = await window.sb
      .from("trades")
      .select("*")
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.warn("Could not load Supabase trades:", error.message);
    return [];
  }

  return data || [];
}

async function fetchRemoteTrades() {
  try {
    return await withTimeout(fetchRemoteTradesFromSupabase(), REMOTE_TIMEOUT_MS, "Supabase trade load");
  } catch (error) {
    console.warn("Could not load Supabase trades:", error.message);
    return [];
  }
}

function mergeTrades(localRows, remoteRows, importedRows = []) {
  const merged = new Map();
  const signatureToKey = new Map();
  const deletedKeys = readDeletedTradeKeys();

  [...remoteRows, ...importedRows, ...localRows].forEach((row) => {
    const normalized = normalizeTrade(row);
    const directKeys = tradeDeleteKeys(normalized);
    const signature = tradeSignature(normalized);
    if (directKeys.some((key) => deletedKeys.has(key)) || deletedKeys.has(signature)) return;

    const directKey = normalized.remote_id || normalized.local_id || normalized.import_id || "";
    const finalKey = directKey
      ? String(directKey)
      : (signatureToKey.get(signature) || signature);

    merged.set(finalKey, mergeTradeData(merged.get(finalKey), normalized));
    if (!directKey && signature) signatureToKey.set(signature, finalKey);
  });

  return [...merged.values()].map((trade) => ({
    ...trade,
    delete_key: tradeDeleteKey(trade),
  })).sort((a, b) => {
    const aTime = a.date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : 0;
    const bTime = b.date && !Number.isNaN(b.date.getTime()) ? b.date.getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}

function money(value) {
  const amount = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function moneyOrNA(value) {
  return Number.isFinite(value) ? money(value) : "N/A";
}

function fmtDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function resultLabel(result) {
  if (result === "win") return "Win";
  if (result === "loss") return "Loss";
  if (result === "be") return "BE";
  return "Open";
}

function resultClass(result) {
  if (result === "win") return "good";
  if (result === "loss") return "bad";
  if (result === "be") return "warn";
  return "";
}

function syncLabel(status) {
  if (status === "synced") return "Synced";
  if (status === "imported") return "Imported";
  if (status === "local") return "Local";
  return "Local";
}

function filteredTrades() {
  const query = searchInput.value.trim().toLowerCase();
  const result = resultFilter.value;
  const pair = pairFilter.value;

  return allTrades.filter((trade) => {
    if (result && trade.result !== result) return false;
    if (pair && trade.pair !== pair) return false;
    if (!query) return true;

    const haystack = [
      trade.pair,
      trade.bias,
      trade.poi,
      trade.inducement,
      trade.notes,
      trade.emotions,
      trade.improve_win,
      trade.improve_loss,
      trade.improve_be,
      trade.source,
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });
}

function stats(trades) {
  const wins = trades.filter((trade) => trade.result === "win").length;
  const losses = trades.filter((trade) => trade.result === "loss").length;
  const bes = trades.filter((trade) => trade.result === "be").length;
  const decided = wins + losses;
  const net = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
  const rTrades = trades.filter((trade) => Number.isFinite(trade.rMultiple));
  const avgR = rTrades.length
    ? rTrades.reduce((sum, trade) => sum + trade.rMultiple, 0) / rTrades.length
    : 0;

  return {
    total: trades.length,
    wins,
    losses,
    bes,
    winRate: decided ? (wins / decided) * 100 : 0,
    net,
    avgR,
  };
}

function populatePairFilter() {
  const current = pairFilter.value;
  const pairs = [...new Set(allTrades.map((trade) => trade.pair).filter(Boolean))].sort();
  pairFilter.innerHTML = '<option value="">All pairs</option>' + pairs
    .map((pair) => `<option value="${escapeHtml(pair)}">${escapeHtml(pair)}</option>`)
    .join("");
  pairFilter.value = pairs.includes(current) ? current : "";
}

function renderStats(trades) {
  const summary = stats(trades);
  kpiTrades.textContent = summary.total;
  kpiWins.textContent = summary.wins;
  kpiLosses.textContent = summary.losses;
  kpiBE.textContent = summary.bes;
  kpiWinRate.textContent = `${summary.winRate.toFixed(1)}%`;
  kpiProfit.textContent = money(summary.net);
  kpiProfit.className = summary.net >= 0 ? "profit" : "loss";
  kpiAvgR.textContent = `${summary.avgR.toFixed(2)}R`;
}

function renderMonthly(trades) {
  const months = new Map();
  trades.forEach((trade) => {
    if (!months.has(trade.monthKey)) months.set(trade.monthKey, []);
    months.get(trade.monthKey).push(trade);
  });

  const rows = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  if (!rows.length) {
    monthlyTable.innerHTML = '<div class="emptyState">No monthly data yet.</div>';
    return;
  }

  monthlyTable.innerHTML = rows.map(([month, monthTrades]) => {
    const summary = stats(monthTrades);
    return `
      <div class="monthRow">
        <div>
          <strong>${escapeHtml(month)}</strong>
          <span>${summary.total} trades / ${summary.winRate.toFixed(1)}% win</span>
        </div>
        <b class="${summary.net >= 0 ? "profit" : "loss"}">${money(summary.net)}</b>
      </div>
    `;
  }).join("");
}

function renderPairStats(trades) {
  const pairs = new Map();
  trades.forEach((trade) => {
    if (!pairs.has(trade.pair)) pairs.set(trade.pair, []);
    pairs.get(trade.pair).push(trade);
  });

  const rows = [...pairs.entries()]
    .map(([pair, pairTrades]) => ({ pair, ...stats(pairTrades) }))
    .sort((a, b) => b.total - a.total || a.pair.localeCompare(b.pair));

  if (!rows.length) {
    pairStatsTable.innerHTML = '<div class="emptyState">No pair stats yet.</div>';
    return;
  }

  pairStatsTable.innerHTML = rows.map((row) => `
    <div class="pairStatsRow">
      <div>
        <strong>${escapeHtml(row.pair)}</strong>
        <span>${row.total} trades / ${row.winRate.toFixed(1)}% win rate</span>
      </div>
      <div class="pairCounts">
        <b class="good">${row.wins}W</b>
        <b class="bad">${row.losses}L</b>
        <b class="warn">${row.bes}BE</b>
      </div>
    </div>
  `).join("");
}

function tradeImages(trade) {
  const images = [
    ["Before", trade.before_url],
    ["After", trade.after_url],
  ].filter(([, src]) => src);

  if (!images.length) return '<div class="noImages">No screenshots uploaded</div>';

  return `
    <div class="tradeImages">
      ${images.map(([label, src]) => `
        <button class="imageThumb" data-src="${escapeHtml(src)}" data-title="${escapeHtml(`${trade.pair} ${label}`)}">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(`${trade.pair} ${label}`)}" loading="lazy" />
          <span>${label}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderTrades(trades) {
  tradeCountLabel.textContent = `${trades.length} trade${trades.length === 1 ? "" : "s"}`;

  if (!trades.length) {
    historyContainer.innerHTML = '<div class="emptyState">No trades match your filters.</div>';
    return;
  }

  historyContainer.innerHTML = trades.map((trade) => {
    const pnlClass = Number.isFinite(trade.pnl) ? (trade.pnl >= 0 ? "profit" : "loss") : "";

    return `
      <article class="tradeCard">
        <div class="tradeTop">
          <div>
            <h2>${escapeHtml(trade.pair)}</h2>
            <p>${escapeHtml(fmtDate(trade.date))}${trade.notes ? ` / ${escapeHtml(trade.notes)}` : ""}</p>
          </div>
          <div class="tradeBadges">
            <span class="badge ${resultClass(trade.result)}">${resultLabel(trade.result)}</span>
            <span class="badge">${escapeHtml(trade.bias || "Neutral")}</span>
            <span class="badge">${escapeHtml(syncLabel(trade.sync_status))}</span>
            <button class="btn btn-danger deleteTradeBtn" data-key="${escapeHtml(trade.delete_key)}" type="button">Delete</button>
          </div>
        </div>

        <div class="tradeMetrics">
          <div><span>PnL</span><b class="${pnlClass}">${moneyOrNA(trade.pnl)}</b></div>
          <div><span>R</span><b>${Number.isFinite(trade.rMultiple) ? `${trade.rMultiple.toFixed(2)}R` : "N/A"}</b></div>
          <div><span>Risk</span><b>${moneyOrNA(trade.risk)}</b></div>
          <div><span>R:R</span><b>${escapeHtml(trade.rr || "N/A")}</b></div>
          <div><span>POI</span><b>${escapeHtml(trade.poi || "N/A")}</b></div>
          <div><span>Inducement</span><b>${escapeHtml(trade.inducement || "N/A")}</b></div>
          <div><span>SL</span><b>${escapeHtml(trade.sl || "N/A")}</b></div>
          <div><span>TP</span><b>${escapeHtml(trade.tp || "N/A")}</b></div>
        </div>

        ${tradeImages(trade)}

        ${(trade.emotions || trade.improve_win || trade.improve_loss || trade.improve_be || trade.source) ? `
          <div class="journalNotes">
            ${trade.emotions ? `<p><b>Emotions:</b> ${escapeHtml(trade.emotions)}</p>` : ""}
            ${trade.improve_win ? `<p><b>Win lesson:</b> ${escapeHtml(trade.improve_win)}</p>` : ""}
            ${trade.improve_loss ? `<p><b>Loss lesson:</b> ${escapeHtml(trade.improve_loss)}</p>` : ""}
            ${trade.improve_be ? `<p><b>BE lesson:</b> ${escapeHtml(trade.improve_be)}</p>` : ""}
            ${trade.source ? `<p><b>Source:</b> ${escapeHtml(trade.source)}</p>` : ""}
          </div>
        ` : ""}
      </article>
    `;
  }).join("");

  historyContainer.querySelectorAll(".imageThumb").forEach((button) => {
    button.addEventListener("click", () => openModal(button.dataset.src, button.dataset.title));
  });

  historyContainer.querySelectorAll(".deleteTradeBtn").forEach((button) => {
    button.addEventListener("click", () => requestDelete(button));
  });
}

function openModal(src, title) {
  modalImg.src = src;
  modalTitle.textContent = title || "Preview";
  imgModal.classList.add("open");
  imgModal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modalImg.src = "";
  imgModal.classList.remove("open");
  imgModal.setAttribute("aria-hidden", "true");
}

function requestDelete(button) {
  if (button.dataset.confirm === "true") {
    deleteTrade(button.dataset.key);
    return;
  }

  button.dataset.confirm = "true";
  button.textContent = "Confirm";
  button.classList.add("confirming");

  window.setTimeout(() => {
    if (!button.isConnected || button.dataset.confirm !== "true") return;
    button.dataset.confirm = "false";
    button.textContent = "Delete";
    button.classList.remove("confirming");
  }, 3500);
}

function render() {
  const trades = filteredTrades();
  renderStats(trades);
  renderMonthly(trades);
  renderPairStats(trades);
  renderTrades(trades);
}

function applyTrades(remoteRows = remoteRowsCache) {
  const localRows = readLocalTrades();
  const importedRows = readImportedTrades();
  allTrades = mergeTrades(localRows, remoteRows, importedRows);
  populatePairFilter();
  lastUpdated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  render();
}

async function init() {
  historyContainer.innerHTML = '<div class="emptyState">Loading trades...</div>';
  applyTrades([]);

  const currentLoad = ++loadToken;
  const remoteRows = await fetchRemoteTrades();
  if (currentLoad !== loadToken) return;

  remoteRowsCache = remoteRows;
  applyTrades(remoteRowsCache);
}

function removeLocalTrade(trade) {
  const keysToDelete = new Set(tradeDeleteKeys(trade));
  const keptTrades = readLocalTrades().filter((row) => {
    const normalized = normalizeTrade(row);
    return !tradeDeleteKeys(normalized).some((key) => keysToDelete.has(key));
  });
  saveLocalTrades(keptTrades);
}

async function deleteTrade(key) {
  const trade = allTrades.find((item) => item.delete_key === key);
  if (!trade) return;

  const deletedKeys = readDeletedTradeKeys();
  tradeDeleteKeys(trade).forEach((deleteKey) => deletedKeys.add(deleteKey));
  saveDeletedTradeKeys(deletedKeys);
  removeLocalTrade(trade);

  allTrades = allTrades.filter((item) => item.delete_key !== key);
  populatePairFilter();
  render();

  if (trade.remote_id && window.sb?.from) {
    const { error } = await window.sb.from("trades").delete().eq("id", trade.remote_id);
    if (error) {
      console.warn("Supabase delete failed:", error.message);
    }
  }
}

exportBtn.addEventListener("click", () => {
  const trades = filteredTrades();
  const headers = [
    "date",
    "pair",
    "result",
    "pnl",
    "risk",
    "r",
    "rr",
    "bias",
    "poi",
    "inducement",
    "sl",
    "tp",
    "notes",
    "emotions",
    "improve_win",
    "improve_loss",
    "improve_be",
    "source",
    "status",
  ];
  const rows = trades.map((trade) => ({
    date: trade.dateRaw || "",
    pair: trade.pair,
    result: resultLabel(trade.result),
    pnl: trade.pnl ?? "",
    risk: trade.risk ?? "",
    r: trade.rMultiple ?? "",
    rr: trade.rr || "",
    bias: trade.bias,
    poi: trade.poi,
    inducement: trade.inducement,
    sl: trade.sl,
    tp: trade.tp,
    notes: trade.notes,
    emotions: trade.emotions,
    improve_win: trade.improve_win,
    improve_loss: trade.improve_loss,
    improve_be: trade.improve_be,
    source: trade.source,
    status: syncLabel(trade.sync_status),
  }));

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kingfx-trades.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

refreshBtn.addEventListener("click", init);
searchInput.addEventListener("input", render);
resultFilter.addEventListener("change", render);
pairFilter.addEventListener("change", render);
closeModalBtn.addEventListener("click", closeModal);
window.addEventListener("kingfx:supabase-ready", init);
imgModal.addEventListener("click", (event) => {
  if (event.target === imgModal) closeModal();
});

init();
