"""Reuse PR #79's reporting modules without replacing the pinned extraction engine."""

import importlib.util
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PR_PACKAGE = ROOT / ".cache/policy-report/src/asago_policy_mapper"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@lru_cache(maxsize=1)
def report_module():
    themes = load_module(
        "asago_policy_mapper.extract.report_themes", PR_PACKAGE / "extract/report_themes.py"
    )
    # Use the exact PR mappings; do not silently fall back to an older package's data.
    from asago_policy_mapper.evals.eval import _load_risk_to_category_map

    themes._load_risk_to_category_map = lambda: _load_risk_to_category_map(
        PR_PACKAGE / "data/risk_to_category.sssom.tsv"
    )
    return load_module("asago_demo_report", PR_PACKAGE / "extract/report.py")


def build_policy_report(data, output):
    path = report_module().build_risk_extraction_report(data, output)
    # The local preview isolates reports from the job-control API. Opaque-origin
    # frames cannot persist preferences; retain the PR's default and local toggle.
    html = path.read_text()
    html = html.replace(
        "const saved = localStorage.getItem('rl-dark-mode');",
        "let saved = null; try { saved = localStorage.getItem('rl-dark-mode'); } catch (_) {}",
    ).replace(
        "localStorage.setItem('rl-dark-mode', String(dark));",
        "try { localStorage.setItem('rl-dark-mode', String(dark)); } catch (_) {}",
    )
    path.write_text(html)
    return path
