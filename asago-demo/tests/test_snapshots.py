import pytest

from asago_demo.runtime import STAGES, Coordinator, Settings, atomic_json


def completed_run(root, run_id="original"):
    folder = root / "runs" / run_id
    folder.mkdir(parents=True)
    state = {
        "id": run_id,
        "status": "completed",
        "started": 100,
        "model": "original-model",
        "stages": {s: {"status": "completed"} for s in STAGES},
    }
    atomic_json(folder / "state.json", state)
    for stage in STAGES:
        atomic_json(folder / f"{stage}.json", {"status": "completed", "evidence": stage})
    (folder / "policy").mkdir()
    (folder / "policy/report.html").write_text("Original report")
    return folder


def test_snapshot_stays_fixed_after_original_run_and_settings_change(tmp_path):
    original = completed_run(tmp_path)
    settings = Settings(tmp_path, defaults={"model": "new-model"})
    coordinator = Coordinator(tmp_path, settings)
    snapshot_id = coordinator.save_snapshot("original")
    snapshot = coordinator.current(snapshot_id)
    assert snapshot["read_only"] is True
    assert snapshot["snapshot"]["source_run_id"] == "original"
    assert snapshot["model"] == "original-model"
    atomic_json(original / "scenarios.json", {"status": "failed"})
    (original / "policy/report.html").write_text("Changed report")
    assert coordinator.current(snapshot_id)["results"]["scenarios"]["status"] == "completed"
    assert (coordinator.runs / snapshot_id / "policy/report.html").read_text() == "Original report"
    restored = Coordinator(tmp_path, settings)
    assert restored.active_id == "original"
    assert restored.current(snapshot_id)["read_only"] is True
    assert restored.save_snapshot(snapshot_id) == snapshot_id


@pytest.mark.parametrize("stage", [*STAGES, "all"])
def test_snapshot_cannot_be_used_to_start_or_overwrite_a_run(tmp_path, stage):
    completed_run(tmp_path)
    coordinator = Coordinator(tmp_path, Settings(tmp_path, defaults={}))
    snapshot_id = coordinator.save_snapshot("original")
    before = (coordinator.runs / snapshot_id / "state.json").read_bytes()
    with pytest.raises(ValueError, match="read-only"):
        coordinator.start(stage, snapshot_id)
    assert not coordinator.busy
    assert (coordinator.runs / snapshot_id / "state.json").read_bytes() == before


def test_snapshot_rejects_incomplete_results(tmp_path):
    folder = completed_run(tmp_path)
    (folder / "evaluation.json").unlink()
    coordinator = Coordinator(tmp_path, Settings(tmp_path, defaults={}))
    with pytest.raises(ValueError, match="completed"):
        coordinator.save_snapshot("original")
    assert len(list(coordinator.runs.iterdir())) == 1


def test_snapshot_refuses_symlinks_instead_of_retaining_mutable_external_content(tmp_path):
    folder = completed_run(tmp_path)
    (folder / "linked.json").symlink_to(folder / "scenarios.json")
    coordinator = Coordinator(tmp_path, Settings(tmp_path, defaults={}))
    with pytest.raises(ValueError, match="linked"):
        coordinator.save_snapshot("original")


def test_implicit_active_snapshot_cannot_be_overwritten(tmp_path):
    completed_run(tmp_path)
    coordinator = Coordinator(tmp_path, Settings(tmp_path, defaults={}))
    coordinator.active_id = coordinator.save_snapshot("original")
    with pytest.raises(ValueError, match="read-only"):
        coordinator.start("scenarios")
