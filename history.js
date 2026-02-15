// ===== History Page Only =====

const historyContainer = document.getElementById("historyContainer");
const refreshBtn = document.getElementById("refreshBtn");

const modal = document.getElementById("imgModal");
const modalImg = document.getElementById("modalImg");
const modalTitle = document.getElementById("modalTitle");
const closeModalBtn = document.getElementById("closeModalBtn");

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openModal(title, url) {
  if (!modal || !modalImg) return;
  modalTitle.textContent = title || "Preview";
  modalImg.src = url;
  modal.classList.add("open");
}

function closeModal() {
  if (!modal || !modalImg) return;
  modal.classList.remove("open");
  modalImg.src = "";
}

closeModalBtn?.addEventListener("click", closeModal);
modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

async function loadTrades() {
  historyContainer.innerHTML = `<div class="muted">Loading...</div>`;

  const { data, error } = await sb
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    historyContainer.innerHTML = `<div class="muted">Failed to load history.</div>`;
    return;
  }

  if (!data || data.length === 0) {
    historyContainer.innerHTML = `<div class="muted">No trades yet. Go to Journal and add one.</div>`;
    return;
  }

  historyContainer.innerHTML = "";

  data.forEach((t) => {
    const pairTxt = t.pair || "-";
    const dateTxt = t.date ? String(t.date) : "-";
    const riskTxt = (t.risk ?? "") === "" ? "-" : `$${t.risk}`;

    const card = document.createElement("div");
    card.className = "tradeCard";

    card.innerHTML = `
      <div class="tradeTop">
        <div class="tradeMeta">
          <strong>${escapeHtml(pairTxt)}</strong>
          <div class="small">Date: ${dateTxt} • Risk: ${riskTxt}</div>
          ${t.notes ? `<div class="small">Notes: ${escapeHtml(t.notes)}</div>` : ""}
        </div>
        <div class="tradeActions">
          <button class="btn btn-ghost" data-del="${t.id}">Delete</button>
        </div>
      </div>

      <div class="tradeImgs">
        ${t.before_url ? `<img class="clickable" data-title="Before - ${escapeHtml(pairTxt)}" src="${t.before_url}" alt="Before">` : ""}
        ${t.after_url ? `<img class="clickable" data-title="After - ${escapeHtml(pairTxt)}" src="${t.after_url}" alt="After">` : ""}
      </div>
    `;

    historyContainer.appendChild(card);
  });

  // delete
  historyContainer.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("Delete this trade?")) return;

      const { error } = await sb.from("trades").delete().eq("id", id);
      if (error) {
        console.error(error);
        alert("Delete failed (RLS may block DELETE).");
        return;
      }
      loadTrades();
    });
  });

  // image click preview
  historyContainer.querySelectorAll("img.clickable").forEach((img) => {
    img.style.cursor = "pointer";
    img.addEventListener("click", () => {
      const title = img.getAttribute("data-title") || "Preview";
      openModal(title, img.src);
    });
  });
}

refreshBtn?.addEventListener("click", loadTrades);

loadTrades();

