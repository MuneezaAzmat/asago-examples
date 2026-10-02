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
  const exports = { chooseRunId, canRenderResult, resolveModel };
  if (typeof module !== "undefined") module.exports = exports;
  else root.AsagoViewState = exports;
})(typeof window === "undefined" ? {} : window);
