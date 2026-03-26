/**
 * Home page: Google sign-in (Supabase) + username onboarding.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const els = {
  bar: document.getElementById("home-auth-bar"),
  status: document.getElementById("home-auth-status"),
  btnGoogle: document.getElementById("home-auth-google"),
  btnOut: document.getElementById("home-auth-signout"),
  modal: document.getElementById("auth-username-modal"),
  form: document.getElementById("auth-username-form"),
  input: document.getElementById("auth-username-input"),
  err: document.getElementById("auth-username-error"),
};

let supabase = null;

function normalizeUsername(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
}

function showModal(show) {
  if (!els.modal) return;
  els.modal.hidden = !show;
  els.modal.setAttribute("aria-hidden", show ? "false" : "true");
  if (show) els.input?.focus();
}

function setError(msg) {
  if (els.err) {
    els.err.textContent = msg || "";
    els.err.hidden = !msg;
  }
}

async function loadConfig() {
  const r = await fetch("/api/supabase/config");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  return j;
}

function renderSignedOut() {
  if (!els.bar) return;
  els.bar.hidden = false;
  if (els.status) els.status.textContent = "";
  if (els.btnGoogle) els.btnGoogle.hidden = false;
  if (els.btnOut) els.btnOut.hidden = true;
  showModal(false);
}

function renderSignedIn(user, profile) {
  if (!els.bar) return;
  els.bar.hidden = false;
  if (els.btnGoogle) els.btnGoogle.hidden = true;
  if (els.btnOut) els.btnOut.hidden = false;

  const name = profile?.username;
  if (els.status) {
    els.status.textContent = name
      ? `Signed in as ${name}`
      : "Signed in — pick a username";
  }

  if (!name) {
    showModal(true);
    setError("");
  } else {
    showModal(false);
  }
}

async function refreshProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("profiles select", error);
    return null;
  }
  return data;
}

async function handleSession(session) {
  if (!session?.user) {
    renderSignedOut();
    return;
  }
  const profile = await refreshProfile(session.user.id);
  renderSignedIn(session.user, profile);
}

async function init() {
  if (!els.bar) return;

  const cfg = await loadConfig();
  if (!cfg || !cfg.url || !cfg.anonKey) {
    els.bar.hidden = true;
    return;
  }

  const redirectUrl = `${window.location.origin}/`;

  supabase = createClient(cfg.url, cfg.anonKey, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session && window.location.search.includes("code=")) {
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
  }
  await handleSession(session);

  supabase.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });

  els.btnGoogle?.addEventListener("click", async () => {
    if (!supabase) return;
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectUrl },
    });
    if (error) console.error(error);
  });

  els.btnOut?.addEventListener("click", async () => {
    if (!supabase) return;
    showModal(false);
    await supabase.auth.signOut();
    renderSignedOut();
  });

  els.form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;

    const u = normalizeUsername(els.input?.value || "");
    if (u.length < 3) {
      setError("Use at least 3 letters or numbers (underscores ok).");
      return;
    }

    setError("");
    const { error } = await supabase.from("profiles").upsert(
      {
        id: session.user.id,
        username: u,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      if (error.code === "23505" || /unique/i.test(error.message)) {
        setError("That username is taken. Try another.");
      } else {
        setError(error.message || "Could not save username.");
      }
      return;
    }

    showModal(false);
    if (els.status) els.status.textContent = `Signed in as ${u}`;
    els.input.value = "";
  });
}

init().catch((e) => {
  console.error(e);
  if (els.bar) els.bar.hidden = true;
});
