from pathlib import Path

from storage.snapshot import SnapshotManager


def test_create_snapshot(tmp_path: Path):
    (tmp_path / "sstables").mkdir()

    (tmp_path / "sstables" / "MANIFEST.json").write_text("{}")

    manager = SnapshotManager(tmp_path)

    manager.create("snap1")

    assert (tmp_path / "snapshots" / "snap1").exists()


def test_list_snapshots(tmp_path: Path):
    (tmp_path / "sstables").mkdir()

    (tmp_path / "sstables" / "MANIFEST.json").write_text("{}")

    manager = SnapshotManager(tmp_path)

    manager.create("a")

    manager.create("b")

    assert manager.list() == ["a", "b"]

def test_snapshot_delete(tmp_path):
    (tmp_path / "sstables").mkdir()
    (tmp_path / "sstables" / "MANIFEST.json").write_text("{}")

    manager = SnapshotManager(tmp_path)

    manager.create("snap")

    manager.delete("snap")

    assert manager.list() == []


def test_snapshot_info(tmp_path):
    (tmp_path / "sstables").mkdir()
    (tmp_path / "sstables" / "MANIFEST.json").write_text("{}")

    manager = SnapshotManager(tmp_path)

    manager.create("snap")

    info = manager.info("snap")

    assert info["name"] == "snap"
    assert info["snapshot_format"] == 1