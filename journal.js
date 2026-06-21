const LOCAL_KEY = "kingfx_trades";

const form = document.getElementById("tradeForm");
const statusEl = document.getElementById("status");
const beforeInput = document.getElementById("beforeImg");
const afterInput = document.getElementById("afterImg");
const beforePreview = document.getElementById("beforePreview");
const afterPreview = document.getElementById("afterPreview");
const resetBtn = document.getElementById("resetBtn");

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

function readLocalTrades() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalTrade(trade) {
  const trades = readLocalTrades();
  const index = trades.findIndex((item) => item.local_id === trade.local_id);
  if (index >= 0) trades[index] = trade;
  else trades.unshift(trade);

  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trades));
  } catch {
    const smallerTrade = { ...trade, before_url: null, after_url: null };
    if (index >= 0) trades[index] = smallerTrade;
    else trades[0] = smallerTrade;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trades));
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 1400;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
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

async function uploadImage(file) {
  if (!file || !window.sb?.storage) return null;

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const filePath = `trades/${fileName}`;

  const { error } = await window.sb.storage
    .from("trade-images")
    .upload(filePath, file, { upsert: false, contentType: file.type });

  if (error) throw error;

  const { data } = window.sb.storage.from("trade-images").getPublicUrl(filePath);
  return data?.publicUrl || null;
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

  const date = value("date");
  const pair = value("pair").toUpperCase();
  const risk = numberValue("risk");
  const result = value("result");

  if (!date || !pair || risk === null || !result) {
    setStatus("Fill Date, Pair, Result, and Risk before saving.", "error");
    return;
  }

  setStatus("Saving trade...");

  const beforeFile = beforeInput.files[0] || null;
  const afterFile = afterInput.files[0] || null;
  const beforeDataUrl = await fileToDataUrl(beforeFile);
  const afterDataUrl = await fileToDataUrl(afterFile);
  const rrText = value("rr");

  const trade = {
    local_id: crypto.randomUUID(),
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
    notes: value("notes") || null,
    emotions: value("emotions") || null,
    improve_win: value("improve_win") || null,
    improve_loss: value("improve_loss") || null,
    improve_be: value("improve_be") || null,
    before_url: beforeDataUrl,
    after_url: afterDataUrl,
    sync_status: "local",
  };

  saveLocalTrade(trade);

  if (!window.sb?.from) {
    resetForm(false);
    setStatus("Saved locally. Open History to see it.", "success");
    return;
  }

  try {
    const dbTrade = { ...trade };
    delete dbTrade.local_id;
    delete dbTrade.sync_status;
    delete dbTrade.r_multiple;

    const beforePublicUrl = await uploadImage(beforeFile);
    const afterPublicUrl = await uploadImage(afterFile);
    if (beforePublicUrl) dbTrade.before_url = beforePublicUrl;
    if (afterPublicUrl) dbTrade.after_url = afterPublicUrl;

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
      before_url: beforePublicUrl || trade.before_url,
      after_url: afterPublicUrl || trade.after_url,
      sync_status: "synced",
    });

    resetForm(false);
    setStatus("Saved. Your trade is now in History.", "success");
  } catch (error) {
    console.error(error);
    resetForm(false);
    setStatus("Saved locally. Supabase sync failed, but History will still show it.", "warning");
  }
});
