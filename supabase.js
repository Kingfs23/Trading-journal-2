// supabase.js
// NOTE: keep your keys here (this file is loaded AFTER the Supabase CDN script)
const SUPABASE_URL = "https://nfmnbwyluttivkgplmrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_fEGUHINYAMku5Bl_N3ebTA_vZcqV_j3";

window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log("SUPABASE_URL:", sb.supabaseUrl);
