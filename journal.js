const form = document.getElementById("tradeForm");
const statusEl = document.getElementById("status");

const beforeInput = document.getElementById("beforeImg");
const afterInput = document.getElementById("afterImg");
const beforePreview = document.getElementById("beforePreview");
const afterPreview = document.getElementById("afterPreview");

const resetBtn = document.getElementById("resetBtn");
const scrollToFormBtn = document.getElementById("scrollToFormBtn");

function setStatus(msg, isError=false){
  statusEl.textContent = msg || "";
  statusEl.style.color = isError ? "#ff6b6b" : "#bdbdbd";
}

function previewFile(file, previewEl){
  previewEl.innerHTML = "";
  if(!file){
    previewEl.innerHTML = `<span class="muted">No image selected</span>`;
    return;
  }
  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  previewEl.appendChild(img);
}

async function uploadImage(file){
  if(!file) return null;

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const filePath = `trades/${fileName}`;

  const { error } = await sb.storage
    .from("trade-images")
    .upload(filePath, file, { upsert:false });

  if(error){
    console.error("Upload error:", error);
    setStatus("Image upload failed (check Storage policies/bucket).", true);
    return null;
  }

  const { data } = sb.storage.from("trade-images").getPublicUrl(filePath);
  return data.publicUrl;
}

beforeInput.addEventListener("change", e => previewFile(e.target.files[0], beforePreview));
afterInput.addEventListener("change", e => previewFile(e.target.files[0], afterPreview));

resetBtn.addEventListener("click", ()=>{
  form.reset();
  previewFile(null, beforePreview);
  previewFile(null, afterPreview);
  setStatus("");
});

scrollToFormBtn.addEventListener("click", ()=>{
  document.getElementById("formCard").scrollIntoView({behavior:"smooth"});
  document.getElementById("date").focus();
});

form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  setStatus("Saving...");

  const date = document.getElementById("date").value;
  const pair = document.getElementById("pair").value.trim();
  const htf_bias = document.getElementById("htf_bias").value;
  const poi = document.getElementById("poi").value.trim();
  const inducement = document.getElementById("inducement").value;

  const risk = Number(document.getElementById("risk").value);
  const sl = document.getElementById("sl").value.trim();
  const tp = document.getElementById("tp").value.trim();
  const rr = document.getElementById("rr").value.trim();
  const pnlVal = document.getElementById("pnl").value;
  const pnl = pnlVal === "" ? null : Number(pnlVal);

  const result = document.getElementById("result").value;
  const notes = document.getElementById("notes").value.trim();

  const emotions = document.getElementById("emotions").value.trim();
  const improve_win = document.getElementById("improve_win").value.trim();
  const improve_loss = document.getElementById("improve_loss").value.trim();
  const improve_be = document.getElementById("improve_be").value.trim();

  const beforeFile = beforeInput.files[0] || null;
  const afterFile = afterInput.files[0] || null;

  // upload images first
  const before_url = await uploadImage(beforeFile);
  const after_url = await uploadImage(afterFile);

  // insert row
  const { error } = await sb.from("trades").insert([{
    date,
    pair,
    htf_bias,
    poi: poi || null,
    inducement,
    risk,
    sl: sl || null,
    tp: tp || null,
    rr: rr || null,
    result,
    pnl,
    notes: notes || null,
    emotions: emotions || null,
    improve_win: improve_win || null,
    improve_loss: improve_loss || null,
    improve_be: improve_be || null,
    before_url,
    after_url
  }]);

  if(error){
    console.error(error);
    setStatus("Save failed. Check RLS + table columns.", true);
    return;
  }

  setStatus("Saved ✅");
  form.reset();
  previewFile(null, beforePreview);
  previewFile(null, afterPreview);

  // optional: go to history page after saving
  // window.location.href = "history.html";
});

previewFile(null, beforePreview);
previewFile(null, afterPreview);




