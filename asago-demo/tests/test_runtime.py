import json
import sys
import time
from pathlib import Path

import pytest

from asago_demo.runtime import Coordinator, Settings, redacted_file, safe_child


def wait_for_finish(coordinator):
    deadline = time.monotonic() + 5
    while coordinator.busy and time.monotonic() < deadline:
        time.sleep(0.02)
    assert not coordinator.busy
    return coordinator.current()


def test_secrets_are_preserved_but_never_returned(tmp_path):
    settings = Settings(tmp_path, defaults={"api_key": "private-key", "model": "gemma"})
    settings.update({"api_key": "", "model": "new-model"})
    assert settings.private()["api_key"] == "private-key"
    public = settings.public()
    assert "private-key" not in json.dumps(public)
    assert "api_key" not in public
    assert public["api_key_configured"]
    assert settings.path.stat().st_mode & 0o077 == 0


def test_settings_reject_unknown_fields_and_bad_urls(tmp_path):
    settings = Settings(tmp_path, defaults={})
    with pytest.raises(ValueError):
        settings.update({"command": "anything"})
    with pytest.raises(ValueError):
        settings.update({"base_url": "file:///tmp/private"})


def test_download_paths_cannot_escape_even_through_symlinks(tmp_path):
    root = tmp_path / "public"
    root.mkdir()
    (root / "file.json").write_text("{}")
    (tmp_path / "private").write_text("secret")
    (root / "link").symlink_to(tmp_path / "private")
    assert safe_child(root, "file.json").is_file()
    for name in ["../private", "link", str(tmp_path / "private")]:
        with pytest.raises(ValueError):
            safe_child(root, name)


def make_coordinator(tmp_path, monkeypatch, script):
    coordinator = Coordinator(tmp_path, Settings(tmp_path, defaults={"api_key": "hide-me"}))
    monkeypatch.setattr(
        coordinator,
        "command",
        lambda stage, run: [sys.executable, "-u", "-c", script, stage, str(run)],
    )
    return coordinator


def test_run_all_connects_stages_and_redacts_logs(tmp_path, monkeypatch):
    code = """
import json,sys
from pathlib import Path
stage,root = sys.argv[1],Path(sys.argv[2])
order=['policy','scenarios','artifact','evaluation']
index=order.index(stage)
if index: assert (root/(order[index-1]+'.json')).exists()
print('hide-me')
(root/(stage+'.json')).write_text(json.dumps({'status':'completed','stage':stage}))
"""
    c = make_coordinator(tmp_path, monkeypatch, code)
    c.start("all")
    state = wait_for_finish(c)
    assert state["status"] == "completed"
    assert all(s["status"] == "completed" for s in state["stages"].values())
    assert "hide-me" not in json.dumps(state)
    assert "hide-me" not in (Path(state["_path"]) / "console.log").read_text()


def test_failure_stops_dependent_stages(tmp_path, monkeypatch):
    c = make_coordinator(
        tmp_path, monkeypatch, "import sys; print('failure details'); sys.exit(2)"
    )
    c.start("all")
    state = wait_for_finish(c)
    assert state["status"] == "failed"
    assert state["stages"]["policy"]["status"] == "failed"
    assert state["stages"]["scenarios"]["status"] == "pending"


def test_non_completed_result_is_not_success(tmp_path, monkeypatch):
    code = """
import sys,json
from pathlib import Path
data = {'status':'failed','error':'No admitted scenarios'}
(Path(sys.argv[2])/(sys.argv[1]+'.json')).write_text(json.dumps(data))
"""
    c = make_coordinator(tmp_path, monkeypatch, code)
    c.start("policy")
    state = wait_for_finish(c)
    assert state["status"] == "failed"
    assert "No admitted" in state["stages"]["policy"]["error"]


def test_concurrent_runs_rejected_and_cancel_stops_worker(tmp_path, monkeypatch):
    c = make_coordinator(tmp_path, monkeypatch, "import time; time.sleep(30)")
    c.start("policy")
    with pytest.raises(ValueError, match="running"):
        c.start("policy")
    c.cancel()
    state = wait_for_finish(c)
    assert state["status"] == "cancelled"


def test_missing_upstream_results_rejected(tmp_path):
    c = Coordinator(tmp_path, Settings(tmp_path, defaults={}))
    with pytest.raises(ValueError, match="Policy"):
        c.start("scenarios")


def test_missing_result_file_fails_even_if_worker_exits_zero(tmp_path, monkeypatch):
    c = make_coordinator(tmp_path, monkeypatch, "print('no result produced')")
    c.start("policy")
    assert wait_for_finish(c)["status"] == "failed"


def test_returned_failure_payload_is_redacted(tmp_path, monkeypatch):
    code = """
import sys,json
from pathlib import Path
data={'status':'failed','error':'hide-me','nested':{'validation':['hide-me']}}
(Path(sys.argv[2])/(sys.argv[1]+'.json')).write_text(json.dumps(data))
"""
    c = make_coordinator(tmp_path, monkeypatch, code)
    c.start("policy")
    state = wait_for_finish(c)
    assert "hide-me" not in json.dumps(state)
    assert "hide-me" not in (Path(state["_path"]) / "policy.json").read_text()


def test_stale_cancellation_does_not_stop_another_job(tmp_path, monkeypatch):
    c = make_coordinator(tmp_path, monkeypatch, "import time; time.sleep(30)")
    run_id = c.start("policy")
    assert not c.cancel("old-run", "policy")
    assert not c.cancel(run_id, "scenarios")
    assert not c.stop.is_set()
    c.cancel(run_id, "policy")
    assert wait_for_finish(c)["status"] == "cancelled"


@pytest.mark.parametrize("suffix", [".json", ".jsonl"])
def test_redaction_preserves_json_with_quoted_bearer_text(tmp_path, suffix):
    path = tmp_path / ("result" + suffix)
    path.write_text(json.dumps({"text": 'Use "Authorization: Bearer example-token".'}))
    clean = redacted_file(path, {})
    assert json.loads(clean)["text"] == 'Use "Authorization: Bearer [redacted]".'
