/* Local controller; all model text is escaped before insertion. */
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let selectedRun = "",
  activeTab = "policy",
  snapshot = null,
  renderKey = "",
  selectedScenario = "",
  pending = false;
let scenarioSearch = "",
  surfaceFilter = "";
let observedActiveId = null;
const { chooseRunId, canRenderResult } = window.AsagoViewState;
const names = {
  policy: "Policy Mapper",
  scenarios: "Scenario Generator",
  artifact: "Artifact Generator",
  evaluation: "Garak Evaluation",
};
const titles = {
  policy: "Policy findings",
  scenarios: "Adversarial scenarios",
  artifact: "Garak test artifact",
  evaluation: "Garak evaluation results",
};
const descriptions = {
  policy:
    "Saved FS-ISAC extraction · Explore evidence, themes, and grounded risk matches.",
  scenarios:
    "Live generation · Turn policy risks and the Klarna use case into testable scenarios.",
  artifact:
    "Live generation · Inspect the attack transcript, detector rubric, and validation evidence.",
  evaluation:
    "Live evaluation · Replay the artifact against Qwen on Ollama and inspect Garak’s judgment.",
};

async function api(route, data) {
  const response = await fetch(
    route,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Asago-Demo": "1" },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}
function notice(text) {
  $("#notice").textContent = text;
  $("#notice").hidden = !text;
}
function fileURL(path) {
  return (
    "/files/" +
    [selectedRun, ...path.split("/")].map(encodeURIComponent).join("/")
  );
}
function download(path, label) {
  return path
    ? `<a href="${escapeHTML(fileURL(path))}" target="_blank" rel="noreferrer">${escapeHTML(label)}</a>`
    : "";
}
function code(value) {
  return `<pre class="code">${escapeHTML(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>`;
}
function metric(value, label, mint = false) {
  return `<div class="metric ${mint ? "mint" : ""}"><strong>${escapeHTML(value)}</strong><span>${escapeHTML(label)}</span></div>`;
}
function empty(title, text, number = "→") {
  return `<div class="empty"><span class="empty-number">${number}</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p></div>`;
}

function selectTab(tab) {
  activeTab = tab;
  renderKey = "";
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab);
    el.setAttribute("aria-selected", el.dataset.tab === tab);
  });
  $("#panel-kicker").textContent =
    `${{ policy: "01", scenarios: "02", artifact: "03", evaluation: "04" }[tab]} / ${names[tab].toUpperCase()}`;
  $("#panel-title").textContent = titles[tab];
  $("#panel-description").textContent = descriptions[tab];
  render();
}

function controls() {
  const run = snapshot?.run,
    busy = snapshot?.busy || pending;
  $("#run-all").disabled = !!busy;
  $("#cancel").hidden = !snapshot?.busy;
  $("#history").disabled = !!busy;
  $("#settings-open").disabled = !!busy;
  const info = run?.stages?.[activeTab];
  const upstream = {
    scenarios: "policy",
    artifact: "scenarios",
    evaluation: "artifact",
  }[activeTab];
  const prerequisite =
    !upstream || run?.stages?.[upstream]?.status === "completed";
  $("#run-stage").disabled = !!busy || !prerequisite;
  $("#run-stage").textContent = {
    policy: "Load saved policy",
    scenarios: "Run scenarios",
    artifact: "Generate artifact",
    evaluation: "Run Garak evaluation",
  }[activeTab];
  $("#elapsed").textContent = info?.started
    ? formatTime((info.ended || Date.now() / 1000) - info.started)
    : "";
  for (const stage of Object.keys(names)) {
    const status = run?.stages?.[stage]?.status || "pending";
    const el = document.querySelector(`[data-tab="${stage}"]`);
    el.dataset.status = status;
    $(`#${stage}-status`).textContent =
      stage === "policy" && status === "completed"
        ? "Saved results loaded"
        : status === "pending"
          ? "Waiting"
          : status;
  }
}
function formatTime(seconds) {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function renderPolicy(data) {
  return `<div class="report-toolbar"><div><span class="badge saved">Saved extraction</span><span>${data.count} matched entries · no live policy calls</span></div><div>${download(data.extraction, "Extraction JSON")}${download(data.report, "Open full report ↗")}</div></div><iframe class="policy-report" title="Interactive FS-ISAC policy report from PR 79" src="${escapeHTML(fileURL(data.report))}" sandbox="allow-scripts allow-downloads"></iframe>`;
}
function distribution(rows, key) {
  const result = {};
  for (const row of rows) {
    const label = row[key] || "Unspecified";
    result[label] = (result[label] || 0) + 1;
  }
  return Object.entries(result).sort((a, b) => b[1] - a[1]);
}
function chart(title, entries, interactive = false) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return `<div class="chart"><h3>${escapeHTML(title)}</h3>${entries.map(([label, count]) => `<button class="bar-button" ${interactive ? `data-surface="${escapeHTML(label)}" aria-pressed="${surfaceFilter === label}"` : 'tabindex="-1"'}><span>${escapeHTML(label)}</span><b style="width:${(count / max) * 100}%"></b><strong>${count}</strong></button>`).join("") || "<small>No results yet</small>"}</div>`;
}
function renderScenarios(data) {
  const rows = data.scenarios || [];
  if (!rows.some((s) => s.file === selectedScenario))
    selectedScenario =
      rows.find((s) => !s.skip_reason)?.file || rows[0]?.file || "";
  return `<div class="results-inner"><div class="metrics">${metric(data.admitted ?? rows.length, "Admitted scenarios", true)}${metric(data.quarantined || 0, "Quarantined candidates")}${metric(rows.filter((s) => !s.skip_reason).length, "Scenarios writable in Garak", true)}</div><div class="charts">${chart("Injection surfaces · select to filter", distribution(rows, "surface"), true)}${chart(
    "Policy risk traceability",
    [
      ["Linked to a risk", rows.filter((s) => s.risk_id).length],
      ["No risk ID exported", rows.filter((s) => !s.risk_id).length],
    ],
  )}</div><div class="filter-row"><input id="scenario-search" type="search" placeholder="Search scenarios or risk IDs" aria-label="Search scenarios" value="${escapeHTML(scenarioSearch)}"><select id="surface-filter" aria-label="Filter by injection surface"><option value="">All injection surfaces</option>${distribution(
    rows,
    "surface",
  )
    .map(
      ([s]) =>
        `<option ${s === surfaceFilter ? "selected" : ""} value="${escapeHTML(s)}">${escapeHTML(s)}</option>`,
    )
    .join(
      "",
    )}</select><small id="scenario-count"></small></div><div id="scenario-list"></div><div class="report-toolbar"><span>Select a scenario, then open Artifact Generator.</span><div>${download(data.report, "Full scenario report ↗")}${download(data.run_dir + "/finalization-inventory.json", "Admission inventory")}</div></div><details class="technical"><summary>Technical details & quarantine evidence</summary>${code({ inventory: data.inventory, quarantine: data.quarantine })}</details></div>`;
}
function fillScenarioList() {
  const data = snapshot?.run?.results?.scenarios;
  if (!data || !$("#scenario-list")) return;
  const filtered = (data.scenarios || []).filter(
    (s) =>
      (!surfaceFilter || s.surface === surfaceFilter) &&
      JSON.stringify([s.title, s.summary, s.id, s.risk_id])
        .toLowerCase()
        .includes(scenarioSearch.toLowerCase()),
  );
  $("#scenario-count").textContent = `${filtered.length} shown`;
  $("#scenario-list").innerHTML =
    filtered
      .map((s) => {
        const risk = snapshot.run.results.policy?.risks?.find(
          (r) => r.risk_id === s.risk_id,
        );
        const quote = risk?.evidence?.[0]?.text;
        return `<article class="scenario-card ${s.file === selectedScenario ? "selected" : ""}"><div class="scenario-top"><label><input type="radio" name="scenario" value="${escapeHTML(s.file)}" ${s.file === selectedScenario ? "checked" : ""} ${s.skip_reason ? "disabled" : ""}><div><span class="id">${escapeHTML(s.id)}</span><h3>${escapeHTML(s.title)}</h3></div></label><span class="badge">${escapeHTML(s.surface)}</span></div><details ${s.file === selectedScenario ? "open" : ""}><summary>Scenario, policy evidence & behavior</summary><div class="scenario-body"><p>${escapeHTML(s.summary)}</p><div class="trace"><small>POLICY TRACE · ${escapeHTML(s.risk_id || "No risk ID exported")}</small>${escapeHTML(quote || risk?.risk_name || "See the scenario source for its risk mapping.")}</div>${s.skip_reason ? `<p>${escapeHTML(s.skip_reason)}</p>` : ""}<h4>Behavior specification</h4>${code(s.gherkin || "No separate behavior specification exported.")}<details class="technical"><summary>Scenario source</summary>${code(s.data)}</details><p style="margin-top:14px">${download(s.file, "Download scenario YAML")}</p></div></details></article>`;
      })
      .join("") ||
    empty(
      "No matching scenarios",
      "Clear the search or choose another injection surface.",
    );
  document.querySelectorAll('input[name="scenario"]').forEach((el) =>
    el.addEventListener("change", () => {
      selectedScenario = el.value;
      fillScenarioList();
    }),
  );
}
function renderArtifact(data) {
  const artifact = data.artifact || {},
    validation = data.validation || {},
    turns = artifact.turns || [];
  const rubrics = artifact.detector_rubric?.rubrics || {};
  return `<div class="results-inner"><div class="metrics">${metric(data.coverage || "—", "Garak platform coverage")}${metric(validation.ok === true ? "Passed" : "Failed", "Artifact validation", validation.ok === true)}${metric(turns.length, "Transcript turns")}</div><div class="trace"><small>SCENARIO → ARTIFACT</small>${escapeHTML(data.scenario_id)} · ${escapeHTML(data.coverage_reason || "")}<br><small>Validation checks the generated artifact. Open Garak Evaluation to test the target model.</small></div><div class="conversation">${turns.map((t, i) => `<article class="turn ${t.adversarial ? "attack" : ""}"><header><span>${String(i + 1).padStart(2, "0")} / ${escapeHTML(t.role)}${t.name ? " · " + escapeHTML(t.name) : ""}</span>${t.adversarial ? '<span class="badge">Adversarial turn</span>' : ""}</header><pre>${escapeHTML(t.content || "")}</pre>${t.tool_calls ? code(t.tool_calls) : ""}</article>`).join("") || empty("No validated artifact written", "Inspect the validation evidence below. The original scenario is still available.")}</div><div class="rubrics"><div><h3>Attack success criteria</h3><ul>${(rubrics.attack_success || []).map((r) => `<li>${escapeHTML(r)}</li>`).join("")}</ul></div><div><h3>Attack blocked criteria</h3><ul>${(rubrics.attack_blocked || []).map((r) => `<li>${escapeHTML(r)}</li>`).join("")}</ul></div><details class="technical"><summary>Validation evidence & detector prompt</summary>${code(validation)}${code(artifact.detector_rubric?.judge_prompt || "")}</details><div class="report-toolbar"><span class="badge ${validation.ok ? "pass" : "fail"}">${validation.ok ? "Validated artifact" : "Validation failed"}</span><div>${download(data.file, "Garak artifact JSON")}${download(data.validation_file, "Validation JSON")}</div></div></div>`;
}
function renderEvaluation(data) {
  const labels = {
    attack_succeeded: "Attack succeeded",
    attack_not_demonstrated: "Attack not demonstrated",
    inconclusive: "Inconclusive",
  };
  const attempts = data.attempts || [];
  const confidence = attempts[0]?.confidence;
  return `<div class="results-inner"><div class="evaluation-verdict ${data.outcome === "attack_succeeded" ? "hit" : ""}"><span class="badge">Live model test</span><h3>${escapeHTML(labels[data.outcome] || "Evaluation result")}</h3><p>${escapeHTML(data.target_model)} · Ollama · ${attempts.length} response${attempts.length === 1 ? "" : "s"} evaluated</p></div><div class="metrics">${metric(confidence == null ? "—" : confidence + "/100", "Judge confidence in attack success")}${metric(data.threshold || 70, "Success cutoff")}${metric(data.judge_model || "—", "Judge model")}</div><div class="trace"><small>ARTIFACT → TARGET → JUDGE</small>${escapeHTML(data.scenario_id)}<br><small>Real model response to the artifact’s replayed context. Proposed tool calls are captured; external tools are not executed. One scenario does not establish overall model safety.</small></div>${attempts.map((a, i) => `<article class="turn"><header><span>${i + 1} / ${escapeHTML(data.target_model)} response</span><span class="badge">${escapeHTML(labels[a.outcome])}</span></header><pre>${escapeHTML(a.response || "The model responded with tool calls.")}</pre>${a.tool_calls?.length ? "<h4>Proposed tool calls</h4>" + code(a.tool_calls) : ""}</article><div class="judge-reason"><h3>Why Garak reached this result</h3><p>${escapeHTML(a.reasoning)}</p></div>`).join("")}<div class="report-toolbar"><span>Garak PR #11 · InjectionJudge</span><div>${download(data.report_file, "Garak report JSONL")}${download(data.conversation_file, "Replayed conversation")}${download(data.artifact_file, "Source artifact")}</div></div><details class="technical"><summary>Execution details</summary>${code({ target: data.target_base_url, model: data.target_model, judge: data.judge_model, probe: "injection.IndirectInjection", detector: "injection_judge.InjectionJudge", revision: data.garak_revision, tool_execution: false })}</details></div>`;
}
function render() {
  controls();
  const run = snapshot?.run,
    info = run?.stages?.[activeTab],
    data = run?.results?.[activeTab];
  const key = JSON.stringify([selectedRun, activeTab, info?.status, data]);
  if (key === renderKey) return;
  renderKey = key;
  if (
    canRenderResult(activeTab, data) &&
    (info?.status === "completed" || info?.status === "failed")
  ) {
    const renderer = {
      policy: renderPolicy,
      scenarios: renderScenarios,
      artifact: renderArtifact,
      evaluation: renderEvaluation,
    }[activeTab];
    $("#results").innerHTML =
      (data.status === "failed"
        ? `<div class="notice">${escapeHTML(data.error)}</div>`
        : "") + renderer(data);
    if (activeTab === "scenarios") {
      fillScenarioList();
      $("#scenario-search").addEventListener("input", (e) => {
        scenarioSearch = e.target.value;
        fillScenarioList();
      });
      $("#surface-filter").addEventListener("change", (e) => {
        surfaceFilter = e.target.value;
        fillScenarioList();
      });
      document.querySelectorAll("[data-surface]").forEach((el) =>
        el.addEventListener("click", () => {
          surfaceFilter =
            surfaceFilter === el.dataset.surface ? "" : el.dataset.surface;
          renderKey = "";
          render();
        }),
      );
    }
  } else if (info?.status === "running") {
    $("#results").innerHTML = empty(
      `${names[activeTab]} is running`,
      activeTab === "policy"
        ? "Building the interactive report from saved extraction data."
        : "The model is working. Real activity appears below; results will appear when the stage completes.",
      "◌",
    );
  } else if (["failed", "cancelled", "interrupted"].includes(info?.status)) {
    $("#results").innerHTML = empty(
      `${names[activeTab]} ${info.status}`,
      info.error || "You can run this stage again.",
    );
  } else {
    $("#results").innerHTML = empty(
      {
        policy: "Start with policy evidence",
        scenarios: "Generate scenarios grounded in this policy",
        artifact: "Turn a scenario into a test artifact",
        evaluation: "Test the artifact against a real model",
      }[activeTab],
      {
        policy:
          "Load the saved FS-ISAC extraction to explore the interactive policy report. No policy model calls are needed.",
        scenarios:
          "Load the policy results, then run the reviewed Klarna coverage configuration. Admitted scenarios and their evidence will appear here.",
        artifact:
          "Generate scenarios, choose one, then build its Garak transcript and detector rubric.",
        evaluation:
          "Generate a validated artifact, then replay it against " +
          (snapshot?.settings?.target_model || "Qwen") +
          " on Ollama. Garak evaluates the real reply and proposed tool calls using the artifact’s rubric.",
      }[activeTab],
    );
  }
}

async function poll() {
  try {
    const data = await api(
      "/api/state" +
        (selectedRun ? "?run=" + encodeURIComponent(selectedRun) : ""),
    );
    snapshot = data;
    const nextRun = chooseRunId(selectedRun, data, observedActiveId);
    observedActiveId = data.active_id;
    if (nextRun && nextRun !== selectedRun) {
      selectedRun = nextRun;
      selectedScenario = "";
      return await poll();
    }
    $("#model-label").textContent = data.settings.model || "Configure endpoint";
    const historyHTML =
      (data.history.length
        ? ""
        : '<option value="">No saved runs yet</option>') +
      data.history
        .map(
          (r) =>
            `<option value="${escapeHTML(r.id)}">${escapeHTML(r.id)} · ${escapeHTML(r.status)}</option>`,
        )
        .join("");
    if ($("#history").innerHTML !== historyHTML)
      $("#history").innerHTML = historyHTML;
    $("#history").value = selectedRun;
    $("#console").textContent =
      (data.run?.logs || []).join("\n") ||
      "Logs will appear here when a stage starts.";
    $("#log-state").textContent = data.busy
      ? "Run in progress"
      : data.run
        ? "Saved activity"
        : "No active run";
    if (data.busy) $("#console").scrollTop = $("#console").scrollHeight;
    render();
  } catch (error) {
    notice("Cannot reach the local demo server. " + error.message);
  }
}
async function start(stage) {
  pending = true;
  notice("");
  controls();
  try {
    const result = await api("/api/start", {
      stage,
      run: selectedRun || null,
      scenario: stage === "artifact" ? selectedScenario : "",
    });
    selectedRun = result.run_id;
    renderKey = "";
    selectTab(stage === "all" ? "scenarios" : stage);
    if (stage !== "policy") $("#logs").open = true;
    await poll();
  } catch (error) {
    notice(error.message);
  } finally {
    pending = false;
    controls();
  }
}

document
  .querySelectorAll("[data-tab]")
  .forEach((el) =>
    el.addEventListener("click", () => selectTab(el.dataset.tab)),
  );
$("#run-all").addEventListener("click", () => start("all"));
$("#run-stage").addEventListener("click", () => start(activeTab));
$("#cancel").addEventListener("click", async () => {
  try {
    await api("/api/cancel", { run: snapshot?.active_id });
    await poll();
  } catch (e) {
    notice(e.message);
  }
});
$("#history").addEventListener("change", async (e) => {
  selectedRun = e.target.value;
  selectedScenario = "";
  renderKey = "";
  await poll();
});
$("#recording").addEventListener("click", () => {
  const active = document.body.classList.toggle("recording");
  $("#recording").setAttribute("aria-pressed", active);
  $("#recording").textContent = active
    ? "Exit recording view"
    : "Recording view";
});
function setTheme(dark) {
  document.documentElement.classList.toggle("pf-v6-theme-dark", dark);
  $("#theme").textContent = dark ? "Light mode" : "Dark mode";
  localStorage.setItem("asago-demo-dark", String(dark));
}
setTheme(localStorage.getItem("asago-demo-dark") !== "false");
$("#theme").addEventListener("click", () =>
  setTheme(!document.documentElement.classList.contains("pf-v6-theme-dark")),
);
$("#settings-open").addEventListener("click", () => {
  const s = snapshot.settings;
  $("#base-url").value = s.base_url || "";
  $("#model").value = s.model || "";
  $("#artifact-model").value = s.artifact_model || "";
  $("#api-key").value = "";
  $("#target-base-url").value = s.target_base_url || "";
  $("#target-model").value = s.target_model || "";
  $("#key-state").textContent = s.api_key_configured
    ? "A key is configured locally. It is never displayed here."
    : "No API key configured.";
  $("#settings-dialog").showModal();
});
$("#settings-close").addEventListener("click", () =>
  $("#settings-dialog").close(),
);
async function saveSettings() {
  return api("/api/settings", {
    base_url: $("#base-url").value,
    model: $("#model").value,
    artifact_model: $("#artifact-model").value,
    api_key: $("#api-key").value,
    target_base_url: $("#target-base-url").value,
    target_model: $("#target-model").value,
  });
}
$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await saveSettings();
    $("#settings-dialog").close();
    await poll();
  } catch (error) {
    $("#connection-state").textContent = error.message;
  }
});
$("#connection-check").addEventListener("click", async () => {
  const button = $("#connection-check");
  button.disabled = true;
  $("#connection-state").textContent = "Checking the model endpoint…";
  try {
    await saveSettings();
    const result = await api("/api/check", {});
    $("#models").innerHTML = result.models
      .map((m) => `<option value="${escapeHTML(m)}"></option>`)
      .join("");
    $("#connection-state").textContent = result.ready
      ? "Connected. The selected model is available."
      : "Connected. Choose an available model: " + result.models.join(", ");
  } catch (error) {
    $("#connection-state").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$("#target-check").addEventListener("click", async () => {
  const button = $("#target-check");
  button.disabled = true;
  $("#connection-state").textContent = "Checking Ollama…";
  try {
    await saveSettings();
    const result = await api("/api/check-target", {});
    $("#target-models").innerHTML = result.models
      .map((m) => `<option value="${escapeHTML(m)}"></option>`)
      .join("");
    $("#connection-state").textContent = result.ready
      ? "Ollama is ready. The target model is installed."
      : "Choose an installed model: " + result.models.join(", ");
  } catch (error) {
    $("#connection-state").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
async function tick() {
  await poll();
  setTimeout(tick, 1500);
}
tick();
