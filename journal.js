// journal.js (fixed)
// Saves ALL form fields to the trades table + uploads before/after images.

const form = document.getElementById("tradeForm");
const statusEl = document.getElementById("status");

const beforeInput = document.getElementById("beforeImg");
const afterInput = document.getElementById("afterImg");
const beforePreview = document.getElementById("beforePreview");
const afterPreview = document.getElementById("afterPreview");

const resetBtn = document.getElementById("resetBtn");
const scrollToFormBtn = document.getElementById("scrollToFormBtn");

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

// Upload returns a PUBLIC URL (requires bucket to be PUBLIC in Supabase Storage settings)
async function uploadImage(file) {
  if (!file) return null;

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const filePath = `trades/${fileName}`;

  const { error: uploadError } = await sb.storage
    .from("trade-images")
    .upload(filePath, file, { upsert: false, contentType: file.type });

  if (uploadError) {
    console.error("Upload error:", uploadError);
    throw new Error("Upload failed: " + uploadError.message);
  }

  const { data } = sb.storage.from("trade-images").getPublicUrl(filePath);
  return data.publicUrl;
}

function v(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  // select/inputs
  return (el.value ?? "").toString().trim();
}

function n(id) {
  const raw = v(id);
  if (raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

beforeInput.addEventListener("change", (e) => previewFile(e.target.files[0], beforePreview));
afterInput.addEventListener("change", (e) => previewFile(e.target.files[0], afterPreview));

resetBtn.addEventListener("click", () => {
  form.reset();
  previewFile(null, beforePreview);
  previewFile(null, afterPreview);
  setStatus("");
});

scrollToFormBtn?.addEventListener("click", () => {
  document.getElementById("formCard")?.scrollIntoView({ behavior: "smooth" });
  document.getElementById("date")?.focus();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    setStatus("Saving...");

    // Required basics
    const date = v("date");           // date (YYYY-MM-DD)
    const pair = v("pair");           // text
    const risk = n("risk");           // numeric

    if (!date || !pair || risk === null) {
      setStatus("Please fill: Date, Pair, Risk.", true);
      return;
    }

    // Optional fields
    const payload = {
      date,
      pair: pair.toUpperCase(),
      risk,

      // journaling + analytics columns
      htf_bias: v("htf_bias") || null,
      poi: v("poi") || null,
      inducement: v("inducement") || null,
      sl: v("sl") || null,
      tp: v("tp") || null,
      rr: v("rr") || null,
      pnl: n("pnl"),
      result: v("result") || null,
      notes: v("notes") || null,

      emotions: v("emotions") || null,
      improve_win: v("improve_win") || null,
      improve_loss: v("improve_loss") || null,
      improve_be: v("improve_be") || null,
    };

    // Upload images (optional)
    const beforeFile = beforeInput.files[0] || null;
    const afterFile = afterInput.files[0] || null;

    if (beforeFile) payload.before_url = await uploadImage(beforeFile);
    if (afterFile) payload.after_url = await uploadImage(afterFile);

    // Insert
    const { error } = await sb.from("trades").insert([payload]);

    if (error) {
      console.error(error);
      setStatus("Save failed. Check table columns + RLS.", true);
      return;
    }

    setStatus("Saved ✅");
    form.reset();
    previewFile(null, beforePreview);
    previewFile(null, afterPreview);
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Something went wrong.", true);
  }
});
