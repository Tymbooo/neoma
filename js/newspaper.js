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
        const parts = [j.error, j.hint].filter(Boolean);
        if (Array.isArray(j.tried) && j.tried.length) {
          parts.push(`Tried models: ${j.tried.join(", ")}`);
        }
        if (j.status) parts.push(`HTTP ${j.status}`);
        throw new Error(parts.join(" — ") || r.statusText);
      }
      renderContent(j.content);
      let base = j.model ? `Edition ready (${j.model})` : "Edition ready";
      if (j.usedLiveSearch) {
        base += " · live web/X search";
      } else if (j.usedXSearch) {
        base += " · X search";
      } else if (j.usedWebSearch) {
        base += " · web search";
      }
      if (j.notice) {
        status.innerHTML = `${escapeHtml(base)}<br/><span class="np-status--sub">${escapeHtml(j.notice)}</span>`;
      } else {
        status.textContent = base;
      }
      status.className = "np-status";
    } catch (e) {
      status.textContent = String(e.message);
      status.className = "np-status np-status--err";
    } finally {
      btn.disabled = false;
    }
  });
})();
