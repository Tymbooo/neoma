(function () {
  const btn = document.getElementById("np-request");
  const out = document.getElementById("np-output");
  const status = document.getElementById("np-status");

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderContent(text) {
    const blocks = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (blocks.length === 0) {
      out.innerHTML = `<p class="np-p">${escapeHtml(text)}</p>`;
      return;
    }
    out.innerHTML = blocks
      .map((p) => `<p class="np-p">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
      .join("");
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = "Fetching from Grok…";
    status.className = "np-status np-status--busy";
    out.innerHTML = "";
    try {
      const r = await fetch("/api/newspaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = [j.error, j.hint].filter(Boolean).join(" — ");
        throw new Error(msg || r.statusText);
      }
      renderContent(j.content);
      status.textContent = j.model ? `Edition ready (${j.model})` : "Edition ready";
      status.className = "np-status";
    } catch (e) {
      status.textContent = String(e.message);
      status.className = "np-status np-status--err";
    } finally {
      btn.disabled = false;
    }
  });
})();
