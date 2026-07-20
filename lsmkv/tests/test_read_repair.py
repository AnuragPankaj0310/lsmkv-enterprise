from storage.read_repair import newest_record, stale_records
from storage.record import Record


def test_newest_record_by_version():
    a = Record(
        key="x",
        value=b"1",
        version=1,
        timestamp=10,
    )

    b = Record(
        key="x",
        value=b"2",
        version=2,
        timestamp=5,
    )

    assert newest_record([a, b]) is b


def test_newest_record_by_timestamp():
    a = Record(
        key="x",
        value=b"1",
        version=2,
        timestamp=10,
    )

    b = Record(
        key="x",
        value=b"2",
        version=2,
        timestamp=20,
    )

    assert newest_record([a, b]) is b


def test_stale_records():
    newest = Record(
        key="x",
        value=b"3",
        version=3,
        timestamp=30,
    )

    old = Record(
        key="x",
        value=b"1",
        version=1,
        timestamp=10,
    )

    stale = stale_records(
        [
            newest,
            old,
        ]
    )

    assert stale == [old]