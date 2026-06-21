const SUPABASE_URL = "https://nfmnbwyluttivkgplmrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_fEGUHINYAMku5Bl_N3ebTA_vZcqV_j3";

if (window.supabase?.createClient) {
  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  window.sb = null;
  console.warn("Supabase library was not loaded. Trades will be saved locally only.");
}
