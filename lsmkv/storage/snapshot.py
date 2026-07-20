"""
Snapshot manager.

Creates point-in-time copies of the storage engine.

Snapshots contain:

- WAL
- SSTables
- Manifest
- Metadata
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path


class SnapshotManager:
    def __init__(self, data_dir: Path):
        self._data_dir = Path(data_dir)
        self._snapshot_dir = self._data_dir / "snapshots"
        self._snapshot_dir.mkdir(parents=True, exist_ok=True)

    def create(self, name: str) -> Path:
        """
        Create a named snapshot.
        """
        target = self._snapshot_dir / name

        if target.exists():
            raise FileExistsError(f"Snapshot '{name}' already exists.")

        target.mkdir()

        shutil.copytree(
            self._data_dir / "sstables",
            target / "sstables",
        )

        wal = self._data_dir / "wal.log"

        if wal.exists():
            shutil.copy2(
                wal,
                target / "wal.log",
            )

        metadata = {
            "name": name,
            "created_at": time.time(),

            "storage_version": "2.1",

            "sstables": len(
                [
                    p
                    for p in (target / "sstables").iterdir()
                    if p.is_file()
                    and p.name != "MANIFEST.json"
                ]
            ),

            "wal_present": wal.exists(),

            "snapshot_format": 1,
        }

        with open(target / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)

        return target

    def restore(self, name: str):
        """
        Restore a snapshot.
        """
        source = self._snapshot_dir / name

        if not source.exists():
            raise FileNotFoundError(name)

        shutil.rmtree(
            self._data_dir / "sstables",
            ignore_errors=True,
        )

        shutil.copytree(
            source / "sstables",
            self._data_dir / "sstables",
        )

        wal = source / "wal.log"

        if wal.exists():
            shutil.copy2(
                wal,
                self._data_dir / "wal.log",
            )

    def list(self):
        return sorted(
            p.name
            for p in self._snapshot_dir.iterdir()
            if p.is_dir()
        )
    
    def info(self, name: str) -> dict:
        """
        Return snapshot metadata.
        """

        path = self._snapshot_dir / name / "metadata.json"

        if not path.exists():
            raise FileNotFoundError(name)

        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
        
    def delete(self, name: str) -> None:
        """
        Delete a snapshot.
        """

        path = self._snapshot_dir / name

        if not path.exists():
            raise FileNotFoundError(name)

        shutil.rmtree(path)