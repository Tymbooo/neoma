/**
 * Home page: login gate → map + overlay (Supabase Google + username).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const els = {
  boot: document.getElementById("home-auth-boot"),
  loginGate: document.getElementById("home-login-gate"),
  loginDisabled: document.getElementById("home-login-disabled"),
  mapApp: document.getElementById("home-map-app"),
  coinsVal: document.getElementById("home-coins-val"),
  heartsRow: document.getElementById("home-hearts-row"),
  overlay: document.getElementById("home-map-auth-overlay"),
  btnGoogle: document.getElementById("home-auth-google"),
  btnOut: document.getElementById("home-auth-signout"),
  modal: document.getElementById("auth-username-modal"),
  form: document.getElementById("auth-username-form"),
  input: document.getElementById("auth-username-input"),
  err: document.getElementById("auth-username-error"),
};

let supabase = null;
/** @type {{ coins: number, heartLosses: string[] }} */
let walletSnapshot = { coins: 0, heartLosses: [] };
/** @type {ReturnType<typeof setInterval> | null} */
let heartTick = null;

const HEART_MS = 60 * 60 * 1000;

function hideBoot() {
  if (els.boot) els.boot.hidden = true;
}

function clearOptimisticMapClass() {
  document.body.classList.remove("home--optimistic-map");
}

function renderHeartsUI() {
  if (!els.heartsRow) return;
  const now = Date.now();
  const active = walletSnapshot.heartLosses.filter((ts) => {
    const t = new Date(ts).getTime();
    return !Number.isNaN(t) && now - t < HEART_MS;
  }).length;
  const dark = Math.min(3, active);
  els.heartsRow.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("span");
    s.className = "home-heart" + (i < dark ? " home-heart--lost" : "");
    s.textContent = "\u2764\uFE0F";
    s.setAttribute("aria-hidden", "true");
    els.heartsRow.appendChild(s);
  }
}

function applyWalletFromProfile(profile) {
  if (profile) {
    walletSnapshot.coins = Number(profile.coins) || 0;
    walletSnapshot.heartLosses = Array.isArray(profile.heart_losses)
      ? profile.heart_losses.map(String)
      : [];
  } else {
    walletSnapshot.coins = 0;
    walletSnapshot.heartLosses = [];
  }
  if (els.coinsVal) els.coinsVal.textContent = String(walletSnapshot.coins);
  renderHeartsUI();
}

function startHeartTimer() {
  stopHeartTimer();
  heartTick = setInterval(() => renderHeartsUI(), 30000);
}

function stopHeartTimer() {
  if (heartTick != null) {
    clearInterval(heartTick);
    heartTick = null;
  }
}

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
  hideBoot();
  clearOptimisticMapClass();
  if (els.loginGate) els.loginGate.hidden = true;
  if (els.mapApp) els.mapApp.hidden = false;
  if (els.overlay) els.overlay.hidden = true;
  stopHeartTimer();
  document.body.classList.add("home--map-visible");
  showModal(false);
}

/** Full-screen login; map hidden. */
function showLoginScreen(showDisabledHint) {
  hideBoot();
  clearOptimisticMapClass();
  if (els.loginGate) els.loginGate.hidden = false;
  if (els.mapApp) els.mapApp.hidden = true;
  if (els.overlay) els.overlay.hidden = true;
  stopHeartTimer();
  if (els.loginDisabled) els.loginDisabled.hidden = !showDisabledHint;
  if (els.btnGoogle) els.btnGoogle.hidden = !!showDisabledHint;
  document.body.classList.remove("home--map-visible");
  showModal(false);
}

/** Map + top overlay; login hidden. */
function showMapWithOverlay() {
  hideBoot();
  clearOptimisticMapClass();
  if (els.loginGate) els.loginGate.hidden = true;
  if (els.mapApp) els.mapApp.hidden = false;
  if (els.overlay) els.overlay.hidden = false;
  renderHeartsUI();
  startHeartTimer();
  document.body.classList.add("home--map-visible");
}

function renderSignedOut() {
  showLoginScreen(false);
}

function renderSignedIn(user, profile) {
  const name = profile?.username;
  showMapWithOverlay();
  applyWalletFromProfile(profile);

  if (!name) {
    showModal(true);
    setError("");
  } else {
    showModal(false);
  }
}

async function refreshProfile(userId) {
  const full = await supabase
    .from("profiles")
    .select("username, coins, heart_losses")
    .eq("id", userId)
    .maybeSingle();
  if (!full.error) return full.data;

  console.warn("profiles select (wallet columns may be missing — run 003_wallet_hearts.sql)", full.error);
  const slim = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
  if (slim.error) {
    console.warn("profiles select", slim.error);
    return null;
  }
  return { ...slim.data, coins: 0, heart_losses: [] };
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

  window.addEventListener("neoma:wallet-updated", (e) => {
    if (typeof e.detail?.coins === "number") {
      walletSnapshot.coins = e.detail.coins;
      if (els.coinsVal) els.coinsVal.textContent = String(walletSnapshot.coins);
    }
  });

  window.addEventListener("neoma:hearts-updated", (e) => {
    if (Array.isArray(e.detail?.heartLosses)) {
      walletSnapshot.heartLosses = e.detail.heartLosses.map(String);
      renderHeartsUI();
    }
  });

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

    const profile = await refreshProfile(session.user.id);
    showModal(false);
    els.input.value = "";
    renderSignedIn(session.user, profile);
  });
}

init().catch((e) => {
  console.error(e);
  hideBoot();
  showGuestMap();
});
