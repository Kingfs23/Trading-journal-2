const LOCAL_KEY = "kingfx_trades";

let allTrades = [];

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

function pick(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null && row?.[name] !== "") return row[name];
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
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
  if (raw === "win" || raw === "won" || raw === "tp") return "win";
  if (raw === "loss" || raw === "lost" || raw === "sl") return "loss";
  if (raw === "be" || raw.includes("break")) return "be";
  return "";
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

function normalizeTrade(row) {
  const dateRaw = pick(row, ["date", "created_at", "entry_date"]);
  const date = dateRaw ? new Date(dateRaw) : null;
  const result = normalizeResult(pick(row, ["result", "outcome", "status"]));
  const pnl = toNumber(pick(row, ["pnl", "profit", "net", "amount"]));
  const rMultiple = parseRMultiple(pick(row, ["r_multiple", "rr", "r", "r_multiple_result"]));
  const monthKey = date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    : "Unknown";

  return {
    id: pick(row, ["id", "local_id"]) || crypto.randomUUID(),
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
    rMultiple,
    pnl,
    result,
    notes: pick(row, ["notes", "comment"]) || "",
    emotions: pick(row, ["emotions"]) || "",
    improve_win: pick(row, ["improve_win"]) || "",
    improve_loss: pick(row, ["improve_loss"]) || "",
    improve_be: pick(row, ["improve_be"]) || "",
    before_url: resolveImage(pick(row, ["before_url", "before_img", "before_path"])),
    after_url: resolveImage(pick(row, ["after_url", "after_img", "after_path"])),
    sync_status: row.sync_status || (row.local_id ? "local" : "synced"),
  };
}

async function fetchRemoteTrades() {
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

function mergeTrades(localRows, remoteRows) {
  const merged = new Map();
  [...remoteRows, ...localRows].forEach((row) => {
    const normalized = normalizeTrade(row);
    const key = row.local_id || row.id || `${normalized.dateRaw}-${normalized.pair}-${normalized.pnl}-${normalized.result}`;
    merged.set(String(key), normalized);
  });

  return [...merged.values()].sort((a, b) => {
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
      trade.notes,
      trade.emotions,
      trade.improve_win,
      trade.improve_loss,
      trade.improve_be,
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });
}

function stats(trades) {
  const wins = trades.filter((trade) => trade.result === "win").length;
  const losses = trades.filter((trade) => trade.result === "loss").length;
  const bes = trades.filter((trade) => trade.result === "be").length;
  const decided = wins + losses + bes;
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

  historyContainer.innerHTML = trades.map((trade) => `
    <article class="tradeCard">
      <div class="tradeTop">
        <div>
          <h2>${escapeHtml(trade.pair)}</h2>
          <p>${escapeHtml(fmtDate(trade.date))}${trade.notes ? ` / ${escapeHtml(trade.notes)}` : ""}</p>
        </div>
        <div class="tradeBadges">
          <span class="badge ${resultClass(trade.result)}">${resultLabel(trade.result)}</span>
          <span class="badge">${escapeHtml(trade.bias || "Neutral")}</span>
          <span class="badge">${trade.sync_status === "synced" ? "Synced" : "Local"}</span>
        </div>
      </div>

      <div class="tradeMetrics">
        <div><span>PnL</span><b class="${(trade.pnl || 0) >= 0 ? "profit" : "loss"}">${money(trade.pnl || 0)}</b></div>
        <div><span>R</span><b>${Number.isFinite(trade.rMultiple) ? `${trade.rMultiple.toFixed(2)}R` : "N/A"}</b></div>
        <div><span>Risk</span><b>${money(trade.risk || 0)}</b></div>
        <div><span>SL</span><b>${escapeHtml(trade.sl || "N/A")}</b></div>
        <div><span>TP</span><b>${escapeHtml(trade.tp || "N/A")}</b></div>
        <div><span>POI</span><b>${escapeHtml(trade.poi || "N/A")}</b></div>
      </div>

      ${tradeImages(trade)}

      ${(trade.emotions || trade.improve_win || trade.improve_loss || trade.improve_be) ? `
        <div class="journalNotes">
          ${trade.emotions ? `<p><b>Emotions:</b> ${escapeHtml(trade.emotions)}</p>` : ""}
          ${trade.improve_win ? `<p><b>Win lesson:</b> ${escapeHtml(trade.improve_win)}</p>` : ""}
          ${trade.improve_loss ? `<p><b>Loss lesson:</b> ${escapeHtml(trade.improve_loss)}</p>` : ""}
          ${trade.improve_be ? `<p><b>BE lesson:</b> ${escapeHtml(trade.improve_be)}</p>` : ""}
        </div>
      ` : ""}
    </article>
  `).join("");

  historyContainer.querySelectorAll(".imageThumb").forEach((button) => {
    button.addEventListener("click", () => openModal(button.dataset.src, button.dataset.title));
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

function render() {
  const trades = filteredTrades();
  renderStats(trades);
  renderMonthly(trades);
  renderTrades(trades);
}

async function init() {
  historyContainer.innerHTML = '<div class="emptyState">Loading trades...</div>';
  const localRows = readLocalTrades();
  const remoteRows = await fetchRemoteTrades();
  allTrades = mergeTrades(localRows, remoteRows);
  populatePairFilter();
  lastUpdated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  render();
}

exportBtn.addEventListener("click", () => {
  const trades = filteredTrades();
  const headers = ["date", "pair", "result", "pnl", "risk", "r", "bias", "poi", "notes", "before_url", "after_url"];
  const rows = trades.map((trade) => ({
    date: trade.dateRaw || "",
    pair: trade.pair,
    result: resultLabel(trade.result),
    pnl: trade.pnl ?? "",
    risk: trade.risk ?? "",
    r: trade.rMultiple ?? "",
    bias: trade.bias,
    poi: trade.poi,
    notes: trade.notes,
    before_url: trade.before_url || "",
    after_url: trade.after_url || "",
  }));

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
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
imgModal.addEventListener("click", (event) => {
  if (event.target === imgModal) closeModal();
});

init();
