const historyContainer = document.getElementById("historyContainer");
const refreshBtn = document.getElementById("refreshBtn");

const modal = document.getElementById("imgModal");
const modalImg = document.getElementById("modalImg");
const modalTitle = document.getElementById("modalTitle");
const closeModalBtn = document.getElementById("closeModalBtn");

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function openModal(title, url){
  modalTitle.textContent = title || "Preview";
  modalImg.src = url;
  modal.classList.add("open");
}
function closeModal(){
  modal.classList.remove("open");
  modalImg.src = "";
}

closeModalBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e)=>{ if(e.target === modal) closeModal(); });

async function loadTrades(){
  historyContainer.innerHTML = `<div class="muted">Loading...</div>`;

  const { data, error } = await sb
    .from("trades")
    .select("*")
    .order("created_at", { ascending:false });

  if(error){
    console.error(error);
    historyContainer.innerHTML = `<div class="muted">Failed to load history.</div>`;
    return;
  }

  if(!data || data.length === 0){
    historyContainer.innerHTML = `<div class="muted">No trades yet.</div>`;
    return;
  }

  historyContainer.innerHTML = "";

  data.forEach(t=>{
    const card = document.createElement("div");
    card.className = "tradeCard";

    card.innerHTML = `
      <div class="tradeTop">
        <div class="tradeMeta">
          <strong>${escapeHtml(t.pair || "-")}</strong>
          <div class="small">
            Date: ${t.date || "-"} • Bias: ${escapeHtml(t.htf_bias || "-")} • Result: ${escapeHtml(t.result || "-")}
          </div>
          <div class="small">
            Risk: ${t.risk ?? "-"} • PnL: ${t.pnl ?? "-"} • RR: ${escapeHtml(t.rr || "-")}
          </div>
          ${t.poi ? `<div class="small">POI: ${escapeHtml(t.poi)}</div>` : ""}
          ${t.inducement ? `<div class="small">Inducement: ${escapeHtml(t.inducement)}</div>` : ""}
          ${t.sl ? `<div class="small">SL: ${escapeHtml(t.sl)}</div>` : ""}
          ${t.tp ? `<div class="small">TP: ${escapeHtml(t.tp)}</div>` : ""}
          ${t.notes ? `<div class="small">Notes: ${escapeHtml(t.notes)}</div>` : ""}
        </div>

        <div class="tradeActions">
          <button class="btn btn-ghost" data-del="${t.id}">Delete</button>
        </div>
      </div>

      <div class="imgGrid">
        <div class="imgBox">
          <div class="imgLabel">Before</div>
          ${
            t.before_url
              ? `<img class="thumb clickable" data-title="Before - ${escapeHtml(t.pair)}" src="${t.before_url}" alt="Before">`
              : `<div class="muted small">No image</div>`
          }
        </div>

        <div class="imgBox">
          <div class="imgLabel">After</div>
          ${
            t.after_url
              ? `<img class="thumb clickable" data-title="After - ${escapeHtml(t.pair)}" src="${t.after_url}" alt="After">`
              : `<div class="muted small">No image</div>`
          }
        </div>
      </div>
    `;

    historyContainer.appendChild(card);
  });

  // delete
  historyContainer.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-del");
      if(!confirm("Delete this trade?")) return;
      const { error } = await sb.from("trades").delete().eq("id", id);
      if(error){ console.error(error); alert("Delete failed."); return; }
      loadTrades();
    });
  });

  // click preview
  historyContainer.querySelectorAll("img.clickable").forEach(img=>{
    img.addEventListener("click", ()=>{
      openModal(img.getAttribute("data-title") || "Preview", img.src);
    });
  });
}

refreshBtn.addEventListener("click", loadTrades);
loadTrades();




