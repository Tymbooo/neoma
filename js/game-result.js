/**
 * Win/lose overlay: Claim reward (+1 coin) and record heart loss on defeat.
 * Dispatches `neoma:wallet-updated` with { coins } after a successful claim.
 */
(function (global) {
  let overlayEl = null;
  /** @type {(() => void) | null} */
  let claimClickHandler = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    const root = document.createElement("div");
    root.id = "game-result-overlay";
    root.className = "gr-overlay";
    root.hidden = true;
    root.innerHTML = `
      <div class="gr-backdrop" role="presentation"></div>
      <div class="gr-card" role="dialog" aria-modal="true" aria-labelledby="gr-title">
        <h2 id="gr-title" class="gr-title"></h2>
        <p id="gr-detail" class="gr-detail"></p>
        <p id="gr-hint" class="gr-hint" hidden></p>
        <div class="gr-actions">
          <button type="button" class="gr-btn gr-btn--primary" id="gr-claim" hidden>Claim reward</button>
          <button type="button" class="gr-btn" id="gr-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    overlayEl = root;
    root.querySelector(".gr-backdrop").addEventListener("click", () => close());
    root.querySelector("#gr-close").addEventListener("click", () => close());
    return root;
  }

  function close() {
    const el = ensureOverlay();
    el.hidden = true;
    document.body.classList.remove("gr-open");
    const claimBtn = el.querySelector("#gr-claim");
    if (claimBtn && claimClickHandler) {
      claimBtn.removeEventListener("click", claimClickHandler);
      claimClickHandler = null;
    }
  }

  async function getAccessToken() {
    const r = await fetch("/api/supabase/config");
    const cfg = await r.json().catch(() => ({}));
    if (!r.ok || !cfg.url || !cfg.anonKey) return null;
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
    const sb = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const {
      data: { session },
    } = await sb.auth.getSession();
    return session?.access_token ?? null;
  }

  async function postWallet(body) {
    const token = await getAccessToken();
    if (!token) return { ok: false, reason: "no-session" };
    const r = await fetch("/api/supabase/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...j };
  }

  /**
   * @param {{ won: boolean, title?: string, detail?: string }} opts
   */
  async function show(opts) {
    const won = !!opts.won;
    const el = ensureOverlay();
    const titleEl = el.querySelector("#gr-title");
    const detailEl = el.querySelector("#gr-detail");
    const hintEl = el.querySelector("#gr-hint");
    const claimBtn = el.querySelector("#gr-claim");

    if (claimClickHandler) {
      claimBtn.removeEventListener("click", claimClickHandler);
      claimClickHandler = null;
    }

    titleEl.textContent = opts.title || (won ? "You won!" : "You lose");
    detailEl.textContent = opts.detail || "";
    hintEl.hidden = true;
    hintEl.textContent = "";
    claimBtn.hidden = !won;
    claimBtn.disabled = false;

    claimClickHandler = async () => {
      hintEl.hidden = false;
      hintEl.textContent = "Claiming…";
      claimBtn.disabled = true;
      const claimId = crypto.randomUUID();
      const res = await postWallet({ claimId });
      claimBtn.disabled = false;
      if (res.ok && typeof res.coins === "number") {
        global.dispatchEvent(new CustomEvent("neoma:wallet-updated", { detail: { coins: res.coins } }));
        close();
        return;
      }
      if (res.reason === "no-session" || res.status === 401) {
        hintEl.textContent = "Sign in from the home page to collect coins.";
      } else if (res.status === 503) {
        hintEl.textContent = "Rewards are not configured on this server yet.";
      } else {
        hintEl.textContent = res.error || "Could not claim. Try again later.";
      }
    };

    if (won) {
      claimBtn.addEventListener("click", claimClickHandler);
    }

    if (!won) {
      void postWallet({ recordHeartLoss: true }).then((res) => {
        if (res.ok) {
          global.dispatchEvent(
            new CustomEvent("neoma:hearts-updated", { detail: { heartLosses: res.heartLosses } })
          );
        }
      });
    }

    el.hidden = false;
    document.body.classList.add("gr-open");
  }

  global.GameResult = { show, close };
})(typeof window !== "undefined" ? window : globalThis);
