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
  const exports = { chooseRunId, canRenderResult };
  if (typeof module !== "undefined") module.exports = exports;
  else root.AsagoViewState = exports;
})(typeof window === "undefined" ? {} : window);
