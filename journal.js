const LOCAL_KEY = "kingfx_trades";
const IMAGE_BUCKET = "trade-images";
const SUPABASE_READY_TIMEOUT_MS = 6000;

const form = document.getElementById("tradeForm");
const statusEl = document.getElementById("status");
const beforeInput = document.getElementById("beforeImg");
const afterInput = document.getElementById("afterImg");
const beforePreview = document.getElementById("beforePreview");
const afterPreview = document.getElementById("afterPreview");
const resetBtn = document.getElementById("resetBtn");
let isSaving = false;

function setStatus(message, type = "muted") {
  statusEl.textContent = message || "";
  statusEl.dataset.type = type;
}

function value(id) {
  return (document.getElementById(id)?.value || "").trim();
}

function numberValue(id) {
  const raw = value(id);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRMultiple(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  if (text.includes(":")) {
    const parts = text.split(":").map((part) => Number(part.trim()));
    if (parts.length === 2 && parts[0] > 0 && Number.isFinite(parts[1])) {
      return parts[1] / parts[0];
    }
  }

  const cleaned = text.replace(/[rR]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isSupabaseReady() {
  return Boolean(window.sb?.from && window.sb?.storage);
}

function waitForSupabase() {
  if (isSupabaseReady()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("kingfx:supabase-ready", handleReady);
      resolve(isSupabaseReady());
    }, SUPABASE_READY_TIMEOUT_MS);

    function handleReady() {
      window.clearTimeout(timeout);
      resolve(isSupabaseReady());
    }

    window.addEventListener("kingfx:supabase-ready", handleReady, { once: true });
  });
}

function readLocalTrades() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalTrade(trade) {
  const trades = readLocalTrades();
  const index = trades.findIndex((item) => {
    if (trade.id && item.id === trade.id) return true;
    return item.local_id === trade.local_id;
  });
  if (index >= 0) trades[index] = trade;
  else trades.unshift(trade);

  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trades));
  } catch {
    const smallerTrade = {
      ...trade,
      before_url: null,
      after_url: null,
      before_local_url: null,
      after_local_url: null,
    };
    if (index >= 0) trades[index] = smallerTrade;
    else trades[0] = smallerTrade;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trades));
  }
}

function optimizeImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    if (!file.type?.startsWith("image/")) {
      resolve({ blob: file, contentType: file.type || "application/octet-stream", extension: "bin" });
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const maxSize = 1600;
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(objectUrl);
        if (!blob) {
          resolve({ blob: file, contentType: file.type || "image/jpeg", extension: "jpg" });
          return;
        }

        resolve({ blob, contentType: "image/jpeg", extension: "jpg" });
      }, "image/jpeg", 0.86);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read image file."));
    };

    img.src = objectUrl;
  });
}

function showPreview(file, previewEl) {
  previewEl.innerHTML = "";

  if (!file) {
    previewEl.innerHTML = "<span>No image selected</span>";
    return;
  }

  const img = document.createElement("img");
  img.alt = file.name;
  img.src = URL.createObjectURL(file);
  previewEl.appendChild(img);
}

function safePathPart(value) {
  return String(value || "trade")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "trade";
}

async function uploadImage(file, trade, side) {
  if (!file) return null;

  const optimized = await optimizeImageFile(file);
  if (!optimized) return null;

  const datePart = safePathPart(trade.date || new Date().toISOString().slice(0, 10));
  const pairPart = safePathPart(trade.pair);
  const fileName = `${pairPart}-${side}-${safeId()}.${optimized.extension}`;
  const filePath = `trades/${datePart}/${fileName}`;

  const { error } = await window.sb.storage
    .from(IMAGE_BUCKET)
    .upload(filePath, optimized.blob, {
      upsert: false,
      contentType: optimized.contentType,
      cacheControl: "31536000",
    });

  if (error) throw error;

  return filePath;
}

function contextLine(label, fieldId) {
  const fieldValue = value(fieldId);
  return fieldValue ? `${label}: ${fieldValue}` : "";
}

function buildNotes() {
  const baseNotes = value("notes");
  const context = [
    contextLine("Session", "session"),
    contextLine("Setup", "setup_type"),
    contextLine("Setup grade", "setup_grade"),
    contextLine("Rule followed", "rule_followed"),
    contextLine("Mistake tag", "mistake_tag"),
    contextLine("Confidence", "confidence"),
    contextLine("Entry time", "entry_time"),
  ].filter(Boolean);

  if (!context.length) return baseNotes || null;
  return [baseNotes, `[Trade Context]\n${context.join("\n")}`].filter(Boolean).join("\n\n");
}

function resetForm(clearStatus = true) {
  form.reset();
  showPreview(null, beforePreview);
  showPreview(null, afterPreview);
  if (clearStatus) setStatus("");
}

beforeInput.addEventListener("change", (event) => showPreview(event.target.files[0], beforePreview));
afterInput.addEventListener("change", (event) => showPreview(event.target.files[0], afterPreview));
resetBtn.addEventListener("click", resetForm);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSaving) return;

  const date = value("date");
  const pair = value("pair").toUpperCase();
  const risk = numberValue("risk");
  const result = value("result");

  if (!date || !pair || risk === null || !result) {
    setStatus("Fill Date, Pair, Result, and Risk before saving.", "error");
    return;
  }

  isSaving = true;
  form.querySelector('button[type="submit"]').disabled = true;
  setStatus("Connecting to Supabase...");

  const beforeFile = beforeInput.files[0] || null;
  const afterFile = afterInput.files[0] || null;

  const rrText = value("rr");

  const trade = {
    local_id: safeId(),
    created_at: new Date().toISOString(),
    date,
    pair,
    risk,
    htf_bias: value("htf_bias") || null,
    poi: value("poi") || null,
    inducement: value("inducement") || null,
    sl: value("sl") || null,
    tp: value("tp") || null,
    rr: rrText || null,
    r_multiple: parseRMultiple(rrText),
    pnl: numberValue("pnl"),
    result,
    notes: buildNotes(),
    emotions: value("emotions") || null,
    improve_win: value("improve_win") || null,
    improve_loss: value("improve_loss") || null,
    improve_be: value("improve_be") || null,
    before_url: null,
    after_url: null,
    sync_status: "saving",
  };

  if (!await waitForSupabase()) {
    setStatus("Supabase is not ready. Check your internet connection, then try saving again.", "error");
    isSaving = false;
    form.querySelector('button[type="submit"]').disabled = false;
    return;
  }

  try {
    setStatus("Uploading screenshots to Supabase...");
    const beforePath = await uploadImage(beforeFile, trade, "before");
    const afterPath = await uploadImage(afterFile, trade, "after");

    const dbTrade = { ...trade };
    delete dbTrade.local_id;
    delete dbTrade.sync_status;
    delete dbTrade.r_multiple;
    dbTrade.before_url = beforePath;
    dbTrade.after_url = afterPath;

    setStatus("Saving trade to Supabase...");
    const { data, error } = await window.sb
      .from("trades")
      .insert([dbTrade])
      .select()
      .single();

    if (error) throw error;

    saveLocalTrade({
      ...trade,
      ...(data || {}),
      local_id: trade.local_id,
      before_url: beforePath,
      after_url: afterPath,
      sync_status: "synced",
    });

    resetForm(false);
    setStatus("Saved to Supabase. Your phone can load this trade too.", "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Supabase save failed. Try again before closing this page.", "error");
  } finally {
    isSaving = false;
    form.querySelector('button[type="submit"]').disabled = false;
  }
});
