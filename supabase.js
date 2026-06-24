const SUPABASE_URL = "https://nfmnbwyluttivkgplmrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_fEGUHINYAMku5Bl_N3ebTA_vZcqV_j3";

function initSupabaseClient() {
  if (!window.supabase?.createClient) return false;

  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.dispatchEvent(new Event("kingfx:supabase-ready"));
  return true;
}

if (!initSupabaseClient()) {
  window.sb = null;

  const supabaseScript = document.getElementById("supabaseLibrary");
  if (supabaseScript) {
    supabaseScript.addEventListener("load", initSupabaseClient, { once: true });
    supabaseScript.addEventListener("error", () => {
      console.warn("Supabase library was not loaded. Trades will be saved locally only.");
    }, { once: true });
  } else {
    console.warn("Supabase library was not loaded. Trades will be saved locally only.");
  }
}
