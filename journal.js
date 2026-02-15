// ===== Journal Page Only =====

const form = document.getElementById("tradeForm");
const statusEl = document.getElementById("status");

const beforeInput = document.getElementById("beforeImg");
const afterInput = document.getElementById("afterImg");
const beforePreview = document.getElementById("beforePreview");
const afterPreview = document.getElementById("afterPreview");

const resetBtn = document.getElementById("resetBtn");
const scrollToFormBtn = document.getElementById("scrollToFormBtn");

// --- Helpers ---
function setStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.style.color = isError ? "#ff6b6b" : "#bdbdbd";
}

function previewFile(file, previewEl) {
  if (!previewEl) return;
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

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const filePath = `trades/${fileName}`;

  const { error } = await sb.storage
    .from("trade-images")
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

// --- Events: image preview ---
beforeInput?.addEventListener("change", (e) => {
  previewFile(e.target.files[0], beforePreview);
});

afterInput?.addEventListener("change", (e) => {
  previewFile(e.target.files[0], afterPreview);
});

// --- Reset form ---
resetBtn?.addEventListener("click", () => {
  form.reset();
  previewFile(null, beforePreview);
  previewFile(null, afterPreview);
  setStatus("");
});

// --- Scroll to form button ---
scrollToFormBtn?.addEventListener("click", () => {
  const formCard = document.getElementById("formCard");
  formCard?.scrollIntoView({ behavior: "smooth" });
  document.getElementById("date")?.focus();
});

// --- Save trade ---
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("Saving...");

  const date = document.getElementById("date").value;
  const pair = document.getElementById("pair").value.trim();
  const risk = Number(document.getElementById("risk").value);
  const notes = document.getElementById("notes").value.trim();

  const beforeFile = beforeInput.files[0] || null;
  const afterFile = afterInput.files[0] || null;

  // 1) upload images
  const beforeUrl = await uploadImage(beforeFile);
  const afterUrl = await uploadImage(afterFile);

  // 2) save trade row
  const { error } = await sb.from("trades").insert([{
    date,
    pair,
    risk,
    notes: notes || null,
    before_url: beforeUrl,
    after_url: afterUrl
  }]);

  if (error) {
    console.error(error);
    setStatus("Save failed. Check trades RLS + table columns.", true);
    return;
  }

  setStatus("Saved ✅");
  form.reset();
  previewFile(null, beforePreview);
  previewFile(null, afterPreview);

  // optional: go to history page after saving
  // window.location.href = "history.html";
});

// --- Start state ---
previewFile(null, beforePreview);
previewFile(null, afterPreview);



