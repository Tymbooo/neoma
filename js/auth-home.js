/**
 * Home page: login gate → map + overlay (Supabase Google + username).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const els = {
  loginGate: document.getElementById("home-login-gate"),
  loginDisabled: document.getElementById("home-login-disabled"),
  mapApp: document.getElementById("home-map-app"),
  overlay: document.getElementById("home-map-auth-overlay"),
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

/** Map only, no auth (misconfigured or error). */
function showGuestMap() {
  if (els.loginGate) els.loginGate.hidden = true;
  if (els.mapApp) els.mapApp.hidden = false;
  if (els.overlay) els.overlay.hidden = true;
  document.body.classList.add("home--map-visible");
  showModal(false);
}

/** Full-screen login; map hidden. */
function showLoginScreen(showDisabledHint) {
  if (els.loginGate) els.loginGate.hidden = false;
  if (els.mapApp) els.mapApp.hidden = true;
  if (els.overlay) els.overlay.hidden = true;
  if (els.loginDisabled) els.loginDisabled.hidden = !showDisabledHint;
  if (els.btnGoogle) els.btnGoogle.hidden = !!showDisabledHint;
  document.body.classList.remove("home--map-visible");
  showModal(false);
}

/** Map + top overlay; login hidden. */
function showMapWithOverlay(statusText) {
  if (els.loginGate) els.loginGate.hidden = true;
  if (els.mapApp) els.mapApp.hidden = false;
  if (els.overlay) els.overlay.hidden = false;
  if (els.status) els.status.textContent = statusText;
  document.body.classList.add("home--map-visible");
}

function renderSignedOut() {
  showLoginScreen(false);
}

function renderSignedIn(user, profile) {
  const name = profile?.username;
  const statusText = name ? `Signed in as ${name}` : "Signed in — pick a username";
  showMapWithOverlay(statusText);

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
  if (!els.loginGate || !els.mapApp) return;

  const cfg = await loadConfig();
  if (!cfg || !cfg.url || !cfg.anonKey) {
    showGuestMap();
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
    showMapWithOverlay(`Signed in as ${u}`);
    els.input.value = "";
  });
}

init().catch((e) => {
  console.error(e);
  showGuestMap();
});
