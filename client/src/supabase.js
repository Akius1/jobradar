// Supabase client, auth helpers, and the profile/resume/match accessors.
//
// Two things shape this file.
//
// First, auth is optional. The board is public and has to keep working for
// someone who has never signed in — and for a checkout with no .env.local at
// all, which is how the repo behaves for a new contributor. So the client is
// created only when both variables are present, and every helper below is
// written to fail politely rather than throw when it is not.
//
// Second, the keys here are public on purpose. Vite inlines anything prefixed
// VITE_ into the bundle, so the publishable key is visible to every visitor.
// That is the design: it grants exactly what the row-level security policies
// in supabase/migrations/0001_init.sql allow. Those policies are the security
// boundary, not this key.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;

// Supabase renamed anon -> publishable when it moved off JWT-style keys. Accept
// either name so a checkout configured under the old convention still runs.
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the project has no Supabase credentials; the board still works. */
export const authConfigured = Boolean(url && key);

export const supabase = authConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The OAuth redirect comes back with the session in the URL hash, and
        // this app already uses the hash for its own routing ("#/job/<id>").
        // Letting the SDK consume and clear it keeps the two from colliding.
        detectSessionInUrl: true,
      },
    })
  : null;

/** Guard so every helper reads the same way rather than each checking null. */
function client() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Copy client/.env.local.example to " +
        "client/.env.local and fill in your project URL and publishable key."
    );
  }
  return supabase;
}

// ---- Auth ----

export const signUpWithEmail = (email, password, fullName) =>
  client().auth.signUp({
    email,
    password,
    // Mirrors what Google returns, so the signup trigger can populate
    // profiles.full_name from one code path regardless of provider.
    options: { data: { full_name: fullName || "" } },
  });

export const signInWithEmail = (email, password) =>
  client().auth.signInWithPassword({ email, password });

/**
 * Which social providers the project actually has switched on.
 *
 * signInWithOAuth redirects the moment it is called and does not resolve with
 * an error for a provider that is disabled, so the user lands on a Supabase
 * error page having lost the role they were reading. Asking first costs one
 * small request and keeps the failure inside our own UI. The answer is cached
 * because it cannot change while the tab is open.
 */
let providerCache = null;
export async function enabledProviders() {
  if (!supabase) return [];
  if (providerCache) return providerCache;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
    });
    if (!res.ok) return [];
    const s = await res.json();
    providerCache = Object.entries(s.external || {})
      .filter(([, on]) => on)
      .map(([name]) => name);
    return providerCache;
  } catch {
    // A network failure here should not block sign-in: fall through and let
    // the redirect try, which is no worse than the behaviour without this.
    return [];
  }
}

/**
 * Returns the user to whatever they were looking at. Someone who clicked a
 * role, signed in and landed back on an empty board would have to find it
 * again, which is the most annoying possible outcome of asking them to sign in.
 */
export const signInWithGoogle = (returnTo = window.location.hash) =>
  client().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/${returnTo || ""}` },
  });

export const signOut = () => client().auth.signOut();

export const getSession = async () => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
};

/** Subscribe to sign-in/sign-out. Returns an unsubscribe function. */
export function onAuthChange(handler) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) =>
    handler(session)
  );
  return () => data.subscription.unsubscribe();
}

// ---- Profile ----

export async function getProfile(userId) {
  const { data, error } = await client()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle(); // the signup trigger creates this, but do not assume it
  if (error) throw error;
  return data;
}

export async function saveOnboarding(userId, answers) {
  const { data, error } = await client()
    .from("profiles")
    .update({ ...answers, onboarded_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- Resume ----

/**
 * Upload to the private bucket and record the row.
 *
 * The path is namespaced by user id because the storage policies read
 * ownership out of the path itself: `(storage.foldername(name))[1] = auth.uid()`.
 * Change the shape of this path and those policies stop matching.
 */
export async function uploadResume(userId, file) {
  const supa = client();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supa.storage
    .from("resumes")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  // Only one resume is current at a time; the partial unique index enforces
  // it, so demote the previous one before inserting rather than after.
  await supa.from("resumes").update({ is_current: false }).eq("user_id", userId).eq("is_current", true);

  const { data, error } = await supa
    .from("resumes")
    .insert({
      user_id: userId,
      storage_path: path,
      filename: file.name,
      byte_size: file.size,
      mime_type: file.type,
      is_current: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getCurrentResume(userId) {
  const { data, error } = await client()
    .from("resumes")
    .select("*")
    .eq("user_id", userId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Short-lived URL for the owner to re-download their own file. */
export async function resumeDownloadUrl(storagePath, seconds = 60) {
  const { data, error } = await client()
    .storage.from("resumes")
    .createSignedUrl(storagePath, seconds);
  if (error) throw error;
  return data.signedUrl;
}

// ---- Matches ----

/** Cached assessment for this resume against this job, or null if not yet run. */
export async function getMatch(resumeId, jobId) {
  const { data, error } = await client()
    .from("job_matches")
    .select("*")
    .eq("resume_id", resumeId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveMatch(row) {
  const { data, error } = await client()
    .from("job_matches")
    .upsert(row, { onConflict: "resume_id,job_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
