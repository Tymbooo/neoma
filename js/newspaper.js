(function () {
  const btn = document.getElementById("np-request");
  const out = document.getElementById("np-output");
  const status = document.getElementById("np-status");
  const promptEl = document.getElementById("np-prompt");

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderGrokRequest(gr, model) {
    if (!promptEl || !gr) return;
    const esc = escapeHtml;
    if (gr.apiKind === "responses") {
      const payload = {
        instructions: gr.instructions,
        input: gr.input,
        tools: gr.tools,
        tool_choice: gr.tool_choice,
        temperature: gr.temperature,
        max_output_tokens: gr.max_output_tokens,
        max_turns: gr.max_turns,
      };
      promptEl.innerHTML = `
      <details class="np-prompt-details" open>
        <summary class="np-prompt-summary">Exact payload sent to Grok (Responses API + x_search)</summary>
        <p class="np-prompt-meta">
          <span><strong>Endpoint</strong> <code>${esc(gr.endpoint || "")}</code></span>
          <span><strong>model</strong> <code>${esc(model || "")}</code></span>
        </p>
        <p class="np-prompt-note">The API key is sent only in the <code>Authorization</code> header (not shown).</p>
        <pre class="np-prompt-pre np-prompt-pre--json" tabindex="0">${esc(JSON.stringify(payload, null, 2))}</pre>
      </details>`;
      promptEl.hidden = false;
      return;
    }
    if (!Array.isArray(gr.messages)) return;
    const blocks = gr.messages
      .map(
        (m) => `
      <div class="np-prompt-block">
        <span class="np-prompt-role">${esc(m.role || "?")}</span>
        <pre class="np-prompt-pre" tabindex="0">${esc(m.content || "")}</pre>
      </div>`
      )
      .join("");
    promptEl.innerHTML = `
      <details class="np-prompt-details" open>
        <summary class="np-prompt-summary">Exact payload sent to Grok (chat completions — no x_search)</summary>
        <p class="np-prompt-meta">
          <span><strong>Endpoint</strong> <code>${esc(gr.endpoint || "")}</code></span>
          <span><strong>model</strong> <code>${esc(model || "")}</code></span>
          <span><strong>temperature</strong> <code>${esc(String(gr.temperature))}</code></span>
          <span><strong>max_tokens</strong> <code>${esc(String(gr.max_tokens))}</code></span>
        </p>
        <p class="np-prompt-note">The API key is sent only in the <code>Authorization</code> header (not shown).</p>
        ${blocks}
      </details>`;
    promptEl.hidden = false;
  }

  function clearPrompt() {
    if (!promptEl) return;
    promptEl.hidden = true;
    promptEl.innerHTML = "";
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
    clearPrompt();
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
      if (j.grokRequest) renderGrokRequest(j.grokRequest, j.model);
      let base = j.model ? `Edition ready (${j.model})` : "Edition ready";
      if (j.usedXSearch) base += " · X search";
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
