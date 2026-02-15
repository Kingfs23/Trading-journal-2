// Elements
const form = document.getElementById("tradeForm");
const historyContainer = document.getElementById("historyContainer");
const statusEl = document.getElementById("status");

const beforeInput = document.getElementById("beforeImg");
const afterInput = document.getElementById("afterImg");
const beforePreview = document.getElementById("beforePreview");
const afterPreview = document.getElementById("afterPreview");

const resetBtn = document.getElementById("resetBtn");
const refreshBtn = document.getElementById("refreshBtn");
const scrollToFormBtn = document.getElementById("scrollToFormBtn");

// Helpers
function setStatus(msg, isError = false) {
  statusEl.textContent = msg || "";
  statusEl.style.color = isError ? "#ff6b6b" : "#bdbdbd";
}

function previewFile(file, previewEl) {
  previewEl.innerHTML = "";
  if (!file) {
    previewEl.innerHTML = `<span class="muted">No image selected</span>`;
    return;
  }
  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  previewEl.appendChild(img);
}

// Upload image to Supabase Storage, returns public URL
async function uploadImage(file) {
  if (!file) return null;

  // safer unique filename
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const filePath = `trades/${fileName}`;

  const { error } = await sb.storage
    .from("trade-images") // bucket name must match exactly
    .upload(filePath, file, { upsert: false });

  if (error) {
    console.error("Upload error:", error);
    setStatus("Image upload failed. Check Storage policies / bucket name.", true);
    return null;
  }

  const { data } = sb.storage
    .from("trade-images")
    .getPublicUrl(filePath);

  return data.publicUrl;
}

// Load and render trades
async function loadTrades() {
  setStatus("Loading trades...");

  const { data, error } = await sb
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    setStatus("Failed to load trades. Check created_at column / RLS policy.", true);
    return;
  }

  historyContainer.innerHTML = "";

  if (!data || data.length === 0) {
    historyContainer.innerHTML = `<div class="muted">No trades yet. Add your first trade.</div>`;
    setStatus("");
    return;
  }

  data.forEach((t) => {
    const card = document.createElement("div");
    card.className = "tradeCard";

    const dateTxt = t.date ? String(t.date) : "-";
    const pairTxt = t.pair || "-";
    const riskTxt = (t.risk ?? "") === "" ? "-" : `$${t.risk}`;
    const notesTxt = t.notes ? t.notes : "";

    card.innerHTML = `
      <div class="tradeTop">
        <div class="tradeMeta">
          <strong>${pairTxt}</strong>
          <div class="small">Date: ${dateTxt} • Risk: ${riskTxt}</div>
          ${notesTxt ? `<div class="small">Notes: ${escapeHtml(notesTxt)}</div>` : ""}
        </div>

        <div class="tradeActions">
          <button class="btn btn-ghost" data-del="${t.id}">Delete</button>
        </div>
      </div>

      <div class="tradeImgs">
        ${t.before_url ? `<img src="${t.before_url}" alt="Before">` : ""}
        ${t.after_url ? `<img src="${t.after_url}" alt="After">` : ""}
      </div>
    `;

    historyContainer.appendChild(card);
  });

  // Delete handlers
  historyContainer.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("Delete this trade?")) return;

      const { error } = await sb.from("trades").delete().eq("id", id);
      if (error) {
        console.error(error);
        setStatus("Delete failed (RLS policy may block DELETE).", true);
        return;
      }
      setStatus("Deleted ✅");
      loadTrades();
    });
  });

  setStatus("");
}

// Prevent XSS in notes display
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Events
beforeInput.addEventListener("change", (e) => previewFile(e.target.files[0], beforePreview));
afterInput.addEventListener("change", (e) => previewFile(e.target.files[0], afterPreview));

resetBtn.addEventListener("click", () => {
  form.reset();
  previewFile(null, beforePreview);
  previewFile(null, afterPreview);
  setStatus("");
});

refreshBtn.addEventListener("click", loadTrades);

scrollToFormBtn.addEventListener("click", () => {
  document.getElementById("formCard").scrollIntoView({ behavior: "smooth" });
  document.getElementById("date").focus();
});

// Save trade
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("Saving...");

  const date = document.getElementById("date").value;
  const pair = document.getElementById("pair").value.trim();
  const risk = Number(document.getElementById("risk").value);
  const notes = document.getElementById("notes").value.trim();

  const beforeFile = beforeInput.files[0] || null;
  const afterFile = afterInput.files[0] || null;

  // 1) upload images first
  const beforeUrl = await uploadImage(beforeFile);
  const afterUrl = await uploadImage(afterFile);

  // 2) insert trade row
  const { error } = await sb.from("trades").insert([{
    date,
    pair,
    risk,
    notes: notes || null,
    before_url: beforeUrl,
    after_url: afterUrl
    // created_at should be DEFAULT now() in DB
  }]);

  if (error) {
    console.error(error);
    setStatus("Save failed. Check RLS policy + columns (before_url/after_url/created_at).", true);
    return;
  }

  setStatus("Saved ✅");
  form.reset();
  previewFile(null, beforePreview);
  previewFile(null, afterPreview);
  loadTrades();
});

// Start
previewFile(null, beforePreview);
previewFile(null, afterPreview);
loadTrades();



