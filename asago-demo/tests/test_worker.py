from types import SimpleNamespace

import pytest

from asago_demo import worker


@pytest.mark.parametrize(
    ("options", "profile", "mode", "cap"),
    [
        ({}, "klarna-direct-canary-profile.yaml", "coverage", 1),
        (
            {
                "scenario_profile": "full",
                "generation_mode": "exhaustive",
                "max_scenarios_per_pattern": 3,
            },
            "klarna-capability-profile.yaml",
            "exhaustive",
            3,
        ),
    ],
)
def test_worker_applies_scenario_choices_at_the_pipeline_boundary(
    tmp_path, monkeypatch, options, profile, mode, cap
):
    from asago_scenario_generator.pipeline import runner

    (tmp_path / "policy").mkdir()
    (tmp_path / "policy/risk-extraction.json").write_text("{}")
    calls = []

    def pipeline(**kwargs):
        calls.append(kwargs)
        output = tmp_path / "scenario-generation/test"
        output.mkdir(parents=True)
        return SimpleNamespace(run_dir=output)

    # Only model generation is replaced; real option resolution and summarization run.
    monkeypatch.setattr(runner, "run_pipeline", pipeline)
    config = {"base_url": "https://example.test/v1", "model": "test", **options}
    if options:
        config.update(
            scenario_provider="ollama",
            ollama_base_url="http://localhost:11434",
            api_key="never-send-to-ollama",
        )
    worker.configure_environment(config)
    worker.scenarios(tmp_path, config)
    assert len(calls) == 1
    assert calls[0]["profile_path"].name == profile
    assert calls[0]["profile_path"].is_file()
    assert calls[0]["generation_mode"] == mode
    assert calls[0]["max_scenarios_per_pattern"] == cap
    assert calls[0]["base_url"] == (
        "http://localhost:11434/v1" if options else "https://example.test/v1"
    )
    assert calls[0]["api_key"] == ("ollama" if options else "none")
    import os

    assert os.environ["ASAGO_SCENARIO_GENERATOR_MODEL_BASE_URL"] == calls[0]["base_url"]
