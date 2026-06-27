const LOCAL_KEY = "kingfx_trades";
const DELETED_KEY = "kingfx_deleted_trades";
const REMOTE_TIMEOUT_MS = 8000;

let allTrades = [];
let remoteRowsCache = [];
let loadToken = 0;

const pageMode = document.body.dataset.page || "monthly";
const el = (id) => document.getElementById(id);
const analysisContainer = el("analysisContainer");
const insightPanel = el("insightPanel");
const refreshBtn = el("refreshBtn");
const exportBtn = el("exportBtn");
const searchInput = el("searchInput");
const resultFilter = el("resultFilter");
const pairFilter = el("pairFilter");
const monthFilter = el("monthFilter");
const tradeCountLabel = el("tradeCountLabel");
const lastUpdated = el("lastUpdated");

const kpiTrades = el("kpiTrades");
const kpiWinRate = el("kpiWinRate");
const kpiProfit = el("kpiProfit");
const kpiAvgR = el("kpiAvgR");
const kpiProfitFactor = el("kpiProfitFactor");
const kpiDrawdown = el("kpiDrawdown");

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

function readDeletedTradeKeys() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || "[]"));
  } catch {
    return new Set();
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
  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function monthKeyFromDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "Unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  if (monthKey === "Unknown") return "Unknown";
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });
}

function deriveActualR(plannedR, pnl, risk, result) {
  if (Number.isFinite(pnl) && Number.isFinite(risk) && risk > 0) return pnl / risk;
  if (result === "be") return 0;
  if (result === "loss" && Number.isFinite(plannedR)) return -1;
  if (result === "win" && Number.isFinite(plannedR)) return plannedR;
  return Number.isFinite(plannedR) ? plannedR : null;
}

function normalizeContextLabel(label) {
  return String(label || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function extractContext(notes) {
  const empty = {
    session: "",
    setup: "",
    grade: "",
    ruleFollowed: "",
    mistakeTag: "",
    confidence: null,
    entryTime: "",
  };
  const text = String(notes || "");
  const marker = "[Trade Context]";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return empty;

  const contextText = text.slice(markerIndex + marker.length);
  const context = { ...empty };
  contextText.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) return;

    const key = normalizeContextLabel(match[1]);
    const value = match[2].trim();
    if (key === "session") context.session = value;
    if (key === "setup") context.setup = value;
    if (key === "setup_grade") context.grade = value;
    if (key === "rule_followed") context.ruleFollowed = value;
    if (key === "mistake_tag") context.mistakeTag = value;
    if (key === "confidence") context.confidence = toNumber(value);
    if (key === "entry_time") context.entryTime = value;
  });

  return context;
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
  if (!result && Number.isFinite(pnl)) result = pnl > 0 ? "win" : (pnl < 0 ? "loss" : "be");

  const plannedR = parseRMultiple(pick(row, ["r_multiple", "rr", "r", "r_multiple_result"]));
  const rMultiple = deriveActualR(plannedR, pnl, risk, result);
  const notes = pick(row, ["notes", "comment"]) || "";
  const context = extractContext(notes);

  return {
    id: rawId || localId || importId || safeId(),
    remote_id: isUuid(rawId) ? rawId : "",
    local_id: localId || "",
    import_id: importId || "",
    created_at: pick(row, ["created_at"]) || dateRaw || "",
    dateRaw,
    date,
    monthKey: monthKeyFromDate(date),
    pair: String(pick(row, ["pair", "symbol", "market"]) || "Unknown").toUpperCase(),
    bias: String(pick(row, ["htf_bias", "bias", "direction"]) || "Neutral"),
    poi: pick(row, ["poi"]) || "",
    inducement: pick(row, ["inducement"]) || "",
    rr: pick(row, ["rr", "r"]) || "",
    risk,
    rMultiple,
    pnl,
    result,
    notes,
    emotions: pick(row, ["emotions"]) || "",
    improve_win: pick(row, ["improve_win"]) || "",
    improve_loss: pick(row, ["improve_loss"]) || "",
    improve_be: pick(row, ["improve_be"]) || "",
    source: pick(row, ["source", "import_source"]) || "",
    session: context.session,
    setup: context.setup,
    grade: context.grade,
    ruleFollowed: context.ruleFollowed,
    mistakeTag: context.mistakeTag,
    confidence: context.confidence,
    entryTime: context.entryTime,
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
    sync_status: [existing.sync_status, incoming.sync_status].includes("synced")
      ? "synced"
      : (incoming.sync_status || existing.sync_status),
  };
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
    const finalKey = directKey || signatureToKey.get(signature) || signature;
    merged.set(finalKey, mergeTradeData(merged.get(finalKey), normalized));
    if (!directKey && signature) signatureToKey.set(signature, finalKey);
  });

  return [...merged.values()].sort((a, b) => {
    const aTime = a.date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : 0;
    const bTime = b.date && !Number.isNaN(b.date.getTime()) ? b.date.getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
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

function percent(value) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
}

function formatR(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}R` : "N/A";
}

function formatProfitFactor(value) {
  if (value === Infinity) return "No losses";
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
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

function calculateMaxDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  [...trades]
    .filter((trade) => Number.isFinite(trade.pnl))
    .sort((a, b) => {
      const aTime = a.date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : 0;
      const bTime = b.date && !Number.isNaN(b.date.getTime()) ? b.date.getTime() : 0;
      return aTime - bTime;
    })
    .forEach((trade) => {
      equity += trade.pnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    });

  return maxDrawdown;
}

function stats(trades) {
  const wins = trades.filter((trade) => trade.result === "win").length;
  const losses = trades.filter((trade) => trade.result === "loss").length;
  const bes = trades.filter((trade) => trade.result === "be").length;
  const decided = wins + losses;
  const pnlTrades = trades.filter((trade) => Number.isFinite(trade.pnl));
  const net = pnlTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossProfit = pnlTrades.filter((trade) => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(pnlTrades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));
  const winPnls = pnlTrades.filter((trade) => trade.pnl > 0).map((trade) => trade.pnl);
  const lossPnls = pnlTrades.filter((trade) => trade.pnl < 0).map((trade) => trade.pnl);
  const rTrades = trades.filter((trade) => Number.isFinite(trade.rMultiple));
  const bestTrade = pnlTrades.reduce((best, trade) => (!best || trade.pnl > best.pnl ? trade : best), null);
  const worstTrade = pnlTrades.reduce((worst, trade) => (!worst || trade.pnl < worst.pnl ? trade : worst), null);

  return {
    total: trades.length,
    wins,
    losses,
    bes,
    winRate: decided ? (wins / decided) * 100 : 0,
    net,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    avgWin: winPnls.length ? winPnls.reduce((sum, value) => sum + value, 0) / winPnls.length : 0,
    avgLoss: lossPnls.length ? lossPnls.reduce((sum, value) => sum + value, 0) / lossPnls.length : 0,
    expectancy: trades.length ? net / trades.length : 0,
    avgR: rTrades.length ? rTrades.reduce((sum, trade) => sum + trade.rMultiple, 0) / rTrades.length : 0,
    maxDrawdown: calculateMaxDrawdown(trades),
    bestTrade,
    worstTrade,
  };
}

function groupBy(trades, getKey) {
  const groups = new Map();
  trades.forEach((trade) => {
    const key = getKey(trade) || "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  });
  return groups;
}

function contextGroups(trades, field) {
  return [...groupBy(trades.filter((trade) => trade[field]), (trade) => trade[field]).entries()]
    .map(([label, groupTrades]) => ({ label, trades: groupTrades, summary: stats(groupTrades) }))
    .sort((a, b) => b.summary.total - a.summary.total || b.summary.net - a.summary.net)
    .slice(0, 5);
}

function topContextLabel(trades, field) {
  const [top] = contextGroups(trades, field);
  return top ? `${top.label} (${top.summary.total})` : "N/A";
}

function filteredTrades() {
  const query = (searchInput?.value || "").trim().toLowerCase();
  const result = resultFilter?.value || "";
  const pair = pairFilter?.value || "";
  const month = monthFilter?.value || "";

  return allTrades.filter((trade) => {
    if (result && trade.result !== result) return false;
    if (pair && trade.pair !== pair) return false;
    if (month && trade.monthKey !== month) return false;
    if (!query) return true;

    const haystack = [
      trade.pair,
      trade.monthKey,
      trade.bias,
      trade.poi,
      trade.inducement,
      trade.notes,
      trade.emotions,
      trade.improve_win,
      trade.improve_loss,
      trade.improve_be,
      trade.session,
      trade.setup,
      trade.grade,
      trade.ruleFollowed,
      trade.mistakeTag,
      trade.source,
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });
}

function populateFilters() {
  if (pairFilter) {
    const current = pairFilter.value;
    const pairs = [...new Set(allTrades.map((trade) => trade.pair).filter(Boolean))].sort();
    pairFilter.innerHTML = '<option value="">All pairs</option>' + pairs
      .map((pair) => `<option value="${escapeHtml(pair)}">${escapeHtml(pair)}</option>`)
      .join("");
    pairFilter.value = pairs.includes(current) ? current : "";
  }

  if (monthFilter) {
    const current = monthFilter.value;
    const months = [...new Set(allTrades.map((trade) => trade.monthKey).filter(Boolean))]
      .sort((a, b) => b.localeCompare(a));
    monthFilter.innerHTML = '<option value="">All months</option>' + months
      .map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(monthLabel(month))}</option>`)
      .join("");
    monthFilter.value = months.includes(current) ? current : "";
  }
}

function renderKpis(trades) {
  const summary = stats(trades);
  kpiTrades.textContent = summary.total;
  kpiWinRate.textContent = percent(summary.winRate);
  kpiProfit.textContent = money(summary.net);
  kpiProfit.className = summary.net >= 0 ? "profit" : "loss";
  kpiAvgR.textContent = formatR(summary.avgR);
  kpiProfitFactor.textContent = formatProfitFactor(summary.profitFactor);
  kpiDrawdown.textContent = money(summary.maxDrawdown);
}

function metric(label, value, className = "") {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <b class="${className}">${escapeHtml(value)}</b>
    </div>
  `;
}

function renderMonthly(trades) {
  const rows = [...groupBy(trades, (trade) => trade.monthKey).entries()]
    .map(([month, monthTrades]) => ({ key: month, label: monthLabel(month), trades: monthTrades, summary: stats(monthTrades) }))
    .sort((a, b) => b.key.localeCompare(a.key));

  if (!rows.length) {
    analysisContainer.innerHTML = '<div class="emptyState">No monthly data yet.</div>';
    renderInsights(trades, rows, "month");
    return;
  }

  analysisContainer.innerHTML = rows.map((row) => `
    <article class="analysisRow">
      <div class="analysisRowTop">
        <div>
          <h2>${escapeHtml(row.label)}</h2>
          <p>${row.summary.total} trades / ${row.summary.wins}W ${row.summary.losses}L ${row.summary.bes}BE</p>
        </div>
        <strong class="${row.summary.net >= 0 ? "profit" : "loss"}">${money(row.summary.net)}</strong>
      </div>
      <div class="miniMetricGrid">
        ${metric("Win rate", percent(row.summary.winRate))}
        ${metric("Average R", formatR(row.summary.avgR))}
        ${metric("Profit factor", formatProfitFactor(row.summary.profitFactor))}
        ${metric("Expectancy", money(row.summary.expectancy), row.summary.expectancy >= 0 ? "profit" : "loss")}
        ${metric("Drawdown", money(row.summary.maxDrawdown), "warn")}
        ${metric("Top mistake", topContextLabel(row.trades, "mistakeTag"))}
      </div>
    </article>
  `).join("");

  renderInsights(trades, rows, "month");
}

function renderPairs(trades) {
  const rows = [...groupBy(trades, (trade) => trade.pair).entries()]
    .map(([pair, pairTrades]) => ({ key: pair, label: pair, trades: pairTrades, summary: stats(pairTrades) }))
    .sort((a, b) => b.summary.net - a.summary.net || b.summary.total - a.summary.total || a.label.localeCompare(b.label));

  if (!rows.length) {
    analysisContainer.innerHTML = '<div class="emptyState">No pair data yet.</div>';
    renderInsights(trades, rows, "pair");
    return;
  }

  analysisContainer.innerHTML = rows.map((row) => `
    <article class="analysisRow">
      <div class="analysisRowTop">
        <div>
          <h2>${escapeHtml(row.label)}</h2>
          <p>${row.summary.total} trades / ${row.summary.wins}W ${row.summary.losses}L ${row.summary.bes}BE</p>
        </div>
        <strong class="${row.summary.net >= 0 ? "profit" : "loss"}">${money(row.summary.net)}</strong>
      </div>
      <div class="miniMetricGrid">
        ${metric("Win rate", percent(row.summary.winRate))}
        ${metric("Average R", formatR(row.summary.avgR))}
        ${metric("Profit factor", formatProfitFactor(row.summary.profitFactor))}
        ${metric("Avg win", money(row.summary.avgWin), "profit")}
        ${metric("Avg loss", money(row.summary.avgLoss), "loss")}
        ${metric("Main setup", topContextLabel(row.trades, "setup"))}
      </div>
    </article>
  `).join("");

  renderInsights(trades, rows, "pair");
}

function insightItem(label, value, className = "") {
  return `
    <div class="insightItem">
      <span>${escapeHtml(label)}</span>
      <b class="${className}">${escapeHtml(value)}</b>
    </div>
  `;
}

function renderBreakdown(title, rows) {
  if (!rows.length) {
    return `
      <div class="insightBlock">
        <h3>${escapeHtml(title)}</h3>
        <div class="mutedLine">No data yet.</div>
      </div>
    `;
  }

  return `
    <div class="insightBlock">
      <h3>${escapeHtml(title)}</h3>
      ${rows.map((row) => `
        <div class="breakdownRow">
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <span>${row.summary.total} trades / ${percent(row.summary.winRate)}</span>
          </div>
          <b class="${row.summary.net >= 0 ? "profit" : "loss"}">${money(row.summary.net)}</b>
        </div>
      `).join("")}
    </div>
  `;
}

function renderInsights(trades, rows, groupName) {
  const summary = stats(trades);
  const sortedByNet = [...rows].sort((a, b) => b.summary.net - a.summary.net);
  const best = sortedByNet[0];
  const worst = sortedByNet[sortedByNet.length - 1];
  const bestWinRate = [...rows]
    .filter((row) => row.summary.total >= 3)
    .sort((a, b) => b.summary.winRate - a.summary.winRate || b.summary.net - a.summary.net)[0];

  insightPanel.innerHTML = `
    <div class="insightBlock">
      <h3>Snapshot</h3>
      ${insightItem(`Best ${groupName}`, best ? `${best.label} / ${money(best.summary.net)}` : "N/A", "profit")}
      ${insightItem(`Weakest ${groupName}`, worst ? `${worst.label} / ${money(worst.summary.net)}` : "N/A", "loss")}
      ${insightItem("Best win rate", bestWinRate ? `${bestWinRate.label} / ${percent(bestWinRate.summary.winRate)}` : "N/A")}
      ${insightItem("Expectancy", money(summary.expectancy), summary.expectancy >= 0 ? "profit" : "loss")}
      ${insightItem("Best trade", summary.bestTrade ? `${summary.bestTrade.pair} / ${money(summary.bestTrade.pnl)}` : "N/A", "profit")}
      ${insightItem("Worst trade", summary.worstTrade ? `${summary.worstTrade.pair} / ${money(summary.worstTrade.pnl)}` : "N/A", "loss")}
    </div>
    ${renderBreakdown("Sessions", contextGroups(trades, "session"))}
    ${renderBreakdown("Setups", contextGroups(trades, "setup"))}
    ${renderBreakdown("Rule Followed", contextGroups(trades, "ruleFollowed"))}
    ${renderBreakdown("Mistake Tags", contextGroups(trades, "mistakeTag"))}
  `;
}

function render() {
  const trades = filteredTrades();
  renderKpis(trades);
  tradeCountLabel.textContent = `${trades.length} trade${trades.length === 1 ? "" : "s"}`;
  if (pageMode === "pairs") renderPairs(trades);
  else renderMonthly(trades);
}

function applyTrades(remoteRows = remoteRowsCache) {
  const localRows = readLocalTrades();
  const importedRows = readImportedTrades();
  allTrades = mergeTrades(localRows, remoteRows, importedRows);
  populateFilters();
  lastUpdated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  render();
}

async function init() {
  analysisContainer.innerHTML = `<div class="emptyState">Loading ${pageMode === "pairs" ? "pair" : "monthly"} stats...</div>`;
  applyTrades([]);

  const currentLoad = ++loadToken;
  const remoteRows = await fetchRemoteTrades();
  if (currentLoad !== loadToken) return;

  remoteRowsCache = remoteRows;
  applyTrades(remoteRowsCache);
}

function exportCsv() {
  const trades = filteredTrades();
  const headers = [
    "date",
    "month",
    "pair",
    "result",
    "pnl",
    "risk",
    "r",
    "rr",
    "session",
    "setup",
    "grade",
    "rule_followed",
    "mistake_tag",
    "confidence",
    "bias",
    "poi",
    "inducement",
    "notes",
    "emotions",
  ];
  const rows = trades.map((trade) => ({
    date: trade.dateRaw || "",
    month: trade.monthKey,
    pair: trade.pair,
    result: resultLabel(trade.result),
    pnl: trade.pnl ?? "",
    risk: trade.risk ?? "",
    r: trade.rMultiple ?? "",
    rr: trade.rr || "",
    session: trade.session,
    setup: trade.setup,
    grade: trade.grade,
    rule_followed: trade.ruleFollowed,
    mistake_tag: trade.mistakeTag,
    confidence: trade.confidence ?? "",
    bias: trade.bias,
    poi: trade.poi,
    inducement: trade.inducement,
    notes: trade.notes,
    emotions: trade.emotions,
  }));

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = pageMode === "pairs" ? "kingfx-pair-performance.csv" : "kingfx-monthly-breakdown.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

refreshBtn.addEventListener("click", init);
exportBtn.addEventListener("click", exportCsv);
searchInput.addEventListener("input", render);
resultFilter.addEventListener("change", render);
pairFilter?.addEventListener("change", render);
monthFilter?.addEventListener("change", render);
window.addEventListener("kingfx:supabase-ready", init);

init();
