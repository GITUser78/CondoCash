// ---------------------------------------------------------------------------
// Supabase client. The library is fetched from a CDN at runtime so the app
// needs no build step; the import is dynamic so that a missing config or an
// unreachable CDN still leaves us with a working page that can explain itself.
// ---------------------------------------------------------------------------
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const CDN = "https://esm.sh/@supabase/supabase-js@2.45.4";

export const isConfigured =
  typeof SUPABASE_URL === "string" &&
  SUPABASE_URL.startsWith("http") &&
  typeof SUPABASE_ANON_KEY === "string" &&
  SUPABASE_ANON_KEY.length > 20;

let client = null;

/** Load the library and create the client. Call once, from app.js. */
export async function initSupabase() {
  if (client) return client;
  if (!isConfigured) return null;
  const { createClient } = await import(/* @vite-ignore */ CDN);
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

/** The initialised client. Throws if used before initSupabase() succeeded. */
export function sb() {
  if (!client) throw new Error("Supabase client is not initialised");
  return client;
}

/** Throw on a PostgREST error so callers can use try/catch uniformly. */
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
