(function (root) {
  function chooseRunId(selected, state, previousActive) {
    if (state.active_id && state.active_id !== previousActive)
      return state.active_id;
    return selected || state.active_id || state.history?.[0]?.id || "";
  }
  function canRenderResult(stage, result) {
    if (!result) return false;
    if (stage === "policy")
      return typeof result.report === "string" && !!result.report;
    if (stage === "scenarios") return Array.isArray(result.scenarios);
    if (stage === "artifact")
      return !!result.artifact && typeof result.artifact === "object";
    if (stage === "evaluation") return Array.isArray(result.attempts);
    return false;
  }
  function resolveModel(config, role) {
    const defaults = {
      scenario: "litellm",
      artifact: "same",
      target: "ollama",
      judge: "same",
    };
    const provider = config[`${role}_provider`] || defaults[role];
    const model = config[role === "scenario" ? "model" : `${role}_model`] || "";
    if (provider === "same" && ["artifact", "judge"].includes(role)) {
      const parent = resolveModel(
        config,
        role === "artifact" ? "scenario" : "artifact",
      );
      return { provider: parent.provider, model: model || parent.model };
    }
    return { provider, model };
  }
  async function readAPIResponse(response) {
    if (
      !(response.headers.get("content-type") || "").includes("application/json")
    ) {
      throw new Error(
        `The local demo returned a non-JSON response (HTTP ${response.status}). Its port may belong to another app. Restart Asago on a free port and open the new URL.`,
      );
    }
    return response.json();
  }
  function activityView(run, now = Date.now() / 1000) {
    if (!run) return null;
    const latest = Object.entries(run.stages || {})
      .filter(([, info]) => info.started)
      .sort((a, b) => b[1].started - a[1].started)[0];
    const logs = run.logs || [];
    const recent = [...logs].reverse();
    const activity = run.activity || {
      stage: latest?.[0],
      stages: latest ? [latest[0]] : [],
      started: latest?.[1].started || run.started,
      ended: latest?.[1].ended,
      status: run.status,
      phase: recent.find((line) => /\[Stage [^\]]+\]/.test(line)),
      last_message: logs.at(-1),
      last_warning: recent.find((line) => /WARNING|ERROR|timed out/.test(line)),
      error: latest?.[1].error || run.error,
      log_file: "console.log",
    };
    return {
      ...activity,
      elapsed: Math.max(0, (activity.ended || now) - activity.started),
      quiet:
        activity.status === "running" && activity.last_output_at
          ? Math.max(0, now - activity.last_output_at)
          : null,
    };
  }
  const exports = {
    chooseRunId,
    canRenderResult,
    resolveModel,
    readAPIResponse,
    activityView,
  };
  if (typeof module !== "undefined") module.exports = exports;
  else root.AsagoViewState = exports;
})(typeof window === "undefined" ? {} : window);
