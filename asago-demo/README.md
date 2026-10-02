# End-to-end Asago demo

A local dashboard and five notebooks connect saved policy evidence → live scenario
and artifact generation → a real model evaluation with Garak. The dashboard is
suited to a 3–5 minute screen recording and shares the same run controller as the
notebooks.

## Setup

Requires `uv`, Git, and download access. Supported on macOS and Linux. `uv` manages
the workspace's Python 3.14 and the separate Python 3.13 Garak environment.

From the repository root:

```bash
./asago-demo/setup.sh
cp asago-demo/.env.example asago-demo/.env
# Edit the endpoint, API key, and served model name in asago-demo/.env.
./asago-demo/launch.sh
```

Open **http://127.0.0.1:8765**. Keep the server running. Connection settings can
also be edited in the dashboard; saved credentials stay in an ignored local file.
The workspace root `.env` is supported, with `asago-demo/.env` taking precedence.

If another local app uses port 8765, run `./asago-demo/launch.sh --port 8766` and
open `http://127.0.0.1:8766` instead. In the notebooks use
`DemoClient(base_url="http://127.0.0.1:8766")`. An HTML response from the controller
API usually means the browser reached another server; this can also happen when
IPv4 and IPv6 listeners from different apps share the same port.

Open **Models & connections** to choose a service and model separately for scenario
generation, artifact generation, the Garak target, and the Garak judge. Each role
can use **LiteLLM** or **Ollama** through its OpenAI-compatible API. Artifact
generation initially inherits the scenario service/model, and the judge inherits
the artifact service/model; both can be overridden. Existing Gemma generation
and Qwen/Ollama target settings are preserved.

The panel loads model dropdowns from each service's `/models` endpoint. **Load
LiteLLM models** and **Load Ollama models** refresh them using the connection fields
currently in the panel. Listing models does not save settings or make an inference
request. If discovery is unavailable, choose **Enter a model name…**. Click **Save
model choices** to apply the selections to future runs. Active runs keep their
original configuration; settings are locked while a run is active.

LiteLLM retains its own base URL and API key. Ollama uses a separate base URL and
never receives the LiteLLM key; a bare Ollama server URL is normalized to `/v1`.
The default scenario model remains `gemma-4-26b`; use an actual served model name.
Each new stage records the model/service it used without credentials, so saved
results remain distinguishable from the next-run model choices.

For evaluation, start [Ollama](https://ollama.com) and install a tool-capable Qwen
model, for example `ollama pull qwen2.5:14b`. The target defaults to
`http://127.0.0.1:11434/v1` and `qwen2.5:14b`. **Load Ollama models** lists installed
models. A tool-capable LiteLLM model can also be selected as the target. Tool
support in Garak PR #11 uses the OpenAI-compatible chat path.

## Four stages

1. **Policy Mapper:** load the saved FS-ISAC extraction already in this repository.
   No extraction model call is made. Explore the actual interactive report from
   [Policy Mapper PR #79](https://github.com/asago-ai/asago-policy-mapper/pull/79),
   including themes, taxonomy filters, grounding confidence, and evidence.
2. **Scenario Generator:** choose the entry-point profile, generation mode, and
   per-pattern limit on the page, then generate using this run's extraction.
   Inspect admission/quarantine data,
   risk traceability, and behavior specifications; select a supported scenario.
3. **Artifact Generator:** generate and validate that scenario's conversation,
   tool-call context, and success/blocked rubric. Invalid artifacts stop the chain.
4. **Garak Evaluation:** replay the artifact against the selected target and judge the next model
   response with [Garak PR #11](https://github.com/trustyai-explainability/garak/pull/11).
   Inspect the actual response, proposed tool calls, judge confidence/reasoning,
   and downloadable native Garak JSONL evidence.

**Run demo** runs all four stages, choosing the first admitted scenario supported
by Garak. **Stop run** stops the active worker; duplicate jobs are rejected.
**Run activity** shows actual pipeline logs. The run selector opens saved results.
Zero admitted scenarios, failed validation, and failed evaluations stay visible.

### Scenario generation options

The Scenario Generator tab exposes the settings used by both **Run scenarios**
and **Run demo**. Changes are saved when scenario generation starts. The defaults
remain the quick direct-input profile, coverage mode, and a per-pattern limit of 1.

- **Entry-point profile:** Direct input has one entry point (user messages).
  Full Klarna adds retrieved knowledge (RAG) and authenticated customer context,
  for three input entry points. Output APIs and human escalation are not counted.
- **Generation mode:** Cover entry points (`coverage`) selects one primary scenario
  per feasible entry point, keeping alternatives as fallbacks. Explore attack
  patterns (`exhaustive`) attempts eligible candidates up to the per-pattern limit;
  this can produce more scenarios and take longer.
- **Variants per attack pattern:** a limit from 1 to 10, not a total batch size.
  Coverage mode prioritizes covering entry points and can exceed this limit when
  needed. Increasing it alone does not add variants for a single entry point.

Qualification and validation determine the final count; selecting the full profile
does not guarantee three admitted scenarios. New runs retain the options used in
their scenario-stage state, shown separately from the next-run controls. Older
saved runs are labeled as having no recorded generation settings. Controls are
disabled while a run is active. Artifact generation still uses the selected
supported scenario.

The target receives replayed scenario context. Its proposed tool calls are
captured without executing business tools. Artifact validation is separate from
target evaluation. Garak's judge marks attack success at confidence ≥70/100;
a lower score means the full attack was not demonstrated, not general model
safety. Missing/invalid replies or judgments are inconclusive. Inspect the raw
response alongside the verdict: an individual concerning action can occur even
when a multi-part rubric is not fully satisfied.

## Notebooks

With the server running:

```bash
./asago-demo/notebooks.sh
```

Open Jupyter's displayed URL and choose the **Asago demo** kernel.

| Notebook | Purpose |
| --- | --- |
| `00-end-to-end.ipynb` | Complete staged walkthrough |
| `01-policy-mapper.ipynb` | Saved policy extraction and interactive report |
| `02-scenario-generator.ipynb` | Live scenarios and policy traceability |
| `03-artifact-generator.ipynb` | Live artifact generation and validation |
| `04-garak-evaluation.ipynb` | Real Qwen response and Garak judgment |

Run them in stage order. Notebook actions appear in the dashboard. Interrupting a
cell requests cancellation of that run/stage. The original component notebooks
remain in their existing folders.

## What is committed, and what is local

| Committed | Created locally and ignored |
| --- | --- |
| Python runner and browser UI | Workspace `.venv/` |
| Five notebooks with empty outputs | `asago-demo/.garak-venv/` |
| Tests, setup scripts, configuration example | `asago-demo/.cache/` report assets |
| Workspace lock and Garak dependency pins | `asago-demo/runs/` |
| This guide | `.env`, `settings.json`, notebook checkpoints |

Inputs are reused directly from `asago-policy-mapper/policy_examples/` and
`asago-scenario-generator/inputs/`. No repository clone, duplicated input dataset,
model output, or credential is committed. The demo imports the artifact generator
installed by `uv`, without relying on a sibling development checkout.

| Component | Source |
| --- | --- |
| Scenario generator | Workspace lock; `c6a7355c2a3f18342d484f2f62901962b5e3baef` |
| Artifact generator | Workspace lock; `a7c586b7480ae8090019079c557e7c4842dd12f9` |
| Policy report | PR #79; `d2423c7bf12432f44fab6963f497dc7f975c7c26` |
| Garak probe/judge | PR #11; `06aba1a2c9b142d561eeeff08dfaffcbe77487c3` |

Setup caches only the reporting modules, mappings, templates, assets, and license
needed from Policy Mapper PR #79. Its full package requires Python <3.14, so the
workspace's extraction package remains at its existing lock revision. The report
adapter tolerates unavailable storage inside its isolated preview frame.

Garak is installed directly from its immutable Git revision into the separate
Python 3.13 environment. `garak-requirements.txt` records the resolved dependency
versions; `0.17.0.dev11` is a local build label, not an upstream release identifier.
The adapter converts artifact `turns` to OpenAI `messages`, removes ASAGO-only
annotations, serializes tool arguments, and preserves authored message content
and tool pairing. Tool schemas come from explicit artifact schemas when available,
otherwise from system-turn declarations. Unspecified parameter types remain
unrestricted. Context and success/blocked criteria are passed to InjectionJudge.

Each execution retains its native report under `runs/<run>/evaluation/`. Rerunning
an upstream stage invalidates downstream summaries while retaining raw evidence.
A server restart marks unfinished work interrupted and reopens the last used run.
Reports are isolated from the controller API; only localhost is served.

## Recording a 3–5 minute walkthrough

Use a wide browser window and **Recording view**. Show 20 seconds of context,
45 seconds of policy evidence, 60 seconds of scenarios, 60 seconds of artifacts,
and 60 seconds of evaluation. Finish with the target response, judge reasoning,
and downloadable evidence. Trim model waits while retaining a short view of real
progress. Keep the saved-policy label visible; opening an old result is not a
new model execution.

## Checks

After setup, from the repository root:

```bash
.venv/bin/python -m pytest asago-demo/tests -q
PYTHONPATH=asago-demo asago-demo/.garak-venv/bin/python -m pytest asago-demo/tests/test_garak_integration.py -q
.venv/bin/ruff check asago-demo
.venv/bin/ruff format --check asago-demo
node --test asago-demo/tests/ui.test.cjs
```

These checks make no model calls. The PR-specific integration test runs in the
Garak environment; it is skipped when Garak is not installed. Live verification
requires configured generation/judge credentials and a running Ollama model.
