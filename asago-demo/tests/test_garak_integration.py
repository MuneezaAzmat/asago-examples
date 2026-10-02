"""Offline boundary checks against the actual PR installation (no model calls)."""

import json

import pytest
from test_evaluation import artifact

from asago_demo.evaluation import EvaluationDeadline, build_conversation


def test_pr_probe_preserves_transcript_through_openai_serializer(tmp_path, monkeypatch):
    pytest.importorskip("garak")
    for name in ("XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"):
        monkeypatch.setenv(name, str(tmp_path / name))
    from garak import _config
    from garak.generators.openai import OpenAICompatible
    from garak.probes.injection import IndirectInjection

    _config.load_base_config()
    entry = build_conversation(artifact())
    source = tmp_path / "conversation.json"
    source.write_text(json.dumps(entry))
    probe = IndirectInjection(
        config_root={
            "probes": {
                "injection": {
                    "IndirectInjection": {
                        "conversation_source": str(source),
                        "generations": 1,
                    }
                }
            }
        }
    )
    attempt = probe._mint_attempt(probe.prompts[0], seq=0)
    assert OpenAICompatible._conversation_to_list(attempt.prompt) == entry["messages"]
    assert attempt.prompt.notes["tools"] == entry["tools"]
    assert attempt.prompt.notes["judge_description"] == entry["judge_description"]


def test_deadline_cannot_be_wrapped_as_retryable_sdk_error():
    httpx = pytest.importorskip("httpx")
    openai = pytest.importorskip("openai")

    def transport(_request):
        raise EvaluationDeadline("deadline")

    client = openai.OpenAI(
        api_key="offline-test",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(transport)),
    )
    with pytest.raises(EvaluationDeadline):
        client.chat.completions.create(
            model="offline",
            messages=[
                {
                    "role": "user",
                    "content": "test",
                }
            ],
        )
    client.close()
