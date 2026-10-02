const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseRunId, canRenderResult } = require("../view-state.js");

test("failed worker without a result payload keeps its error view", () => {
  assert.equal(
    canRenderResult("policy", {
      status: "failed",
      error: "Policy data missing",
    }),
    false,
  );
  assert.equal(
    canRenderResult("scenarios", {
      status: "failed",
      error: "Endpoint unavailable",
    }),
    false,
  );
  assert.equal(
    canRenderResult("artifact", {
      status: "failed",
      error: "No writable scenario",
    }),
    false,
  );
  assert.equal(
    canRenderResult("evaluation", {
      status: "failed",
      error: "Target unavailable",
    }),
    false,
  );
});

test("failure with useful diagnostics can still show its results", () => {
  assert.equal(
    canRenderResult("scenarios", {
      status: "failed",
      scenarios: [],
      quarantine: [{}],
    }),
    true,
  );
  assert.equal(
    canRenderResult("artifact", {
      status: "failed",
      artifact: {},
      validation: { ok: false },
    }),
    true,
  );
  assert.equal(
    canRenderResult("evaluation", {
      status: "failed",
      attempts: [],
      report_file: "run.jsonl",
    }),
    true,
  );
});

test("new notebook runs become visible even when another run was selected", () => {
  assert.equal(
    chooseRunId("run-a", { active_id: "run-b", history: [] }, "run-a"),
    "run-b",
  );
  assert.equal(
    chooseRunId("run-a", { active_id: "run-b", history: [] }, null),
    "run-b",
  );
});

test("user can inspect history after active run has already been observed", () => {
  assert.equal(
    chooseRunId("run-a", { active_id: "run-b", history: [] }, "run-b"),
    "run-a",
  );
});

test("first connection opens the most recent saved run", () => {
  assert.equal(
    chooseRunId("", { active_id: null, history: [{ id: "latest" }] }, null),
    "latest",
  );
});
