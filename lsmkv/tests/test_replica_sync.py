from storage.record import Record
from distributed.replica_sync import records_to_sync


def test_detect_missing_record():
    source = {
        "a": Record(
            key="a",
            value=b"1",
            version=2,
            timestamp=2.0,
        )
    }

    destination = {}

    repairs = records_to_sync(source, destination)

    assert len(repairs) == 1
    assert repairs[0].key == "a"


def test_detect_stale_version():
    source = {
        "x": Record(
            key="x",
            value=b"new",
            version=5,
            timestamp=5.0,
        )
    }

    destination = {
        "x": Record(
            key="x",
            value=b"old",
            version=3,
            timestamp=3.0,
        )
    }

    repairs = records_to_sync(source, destination)

    assert len(repairs) == 1
    assert repairs[0].source.version == 5