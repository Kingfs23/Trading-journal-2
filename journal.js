const form = document.getElementById("tradeForm");
const historyContainer = document.getElementById("historyContainer");

async function uploadImage(file) {
  const fileName = `${Date.now()}-${file.name}`;

  const { error } = await supabase.storage
    .from("trade-images")
    .upload(fileName, file);

  if (error) {
    console.error(error);
    return null;
  }

  const { data } = supabase.storage
    .from("trade-images")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const beforeFile = document.getElementById("beforeImg").files[0];
  const afterFile = document.getElementById("afterImg").files[0];

  let beforeUrl = null;
  let afterUrl = null;

  if (beforeFile) {
    beforeUrl = await uploadImage(beforeFile);
  }

  if (afterFile) {
    afterUrl = await uploadImage(afterFile);
  }

  const { error } = await supabase
    .from("trades")
    .insert([
      {
        date: document.getElementById("date").value,
        pair: document.getElementById("pair").value,
        risk: document.getElementById("risk").value,
        before_url: beforeUrl,
        after_url: afterUrl
      }
    ]);

  if (error) {
    console.error(error);
    alert("Error saving trade");
  } else {
    alert("Trade Saved ✅");
    form.reset();
    loadTrades();
  }
});

async function loadTrades() {
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  historyContainer.innerHTML = "";

  data.forEach(trade => {
    const card = document.createElement("div");
    card.classList.add("trade-card");

    card.innerHTML = `
      <h3>${trade.pair}</h3>
      <p>Date: ${trade.date}</p>
      <p>Risk: $${trade.risk}</p>
      <div class="trade-images">
        ${trade.before_url ? `<img src="${trade.before_url}">` : ""}
        ${trade.after_url ? `<img src="${trade.after_url}">` : ""}
      </div>
    `;

    historyContainer.appendChild(card);
  });
}

loadTrades();

