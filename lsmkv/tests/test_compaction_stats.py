from storage.compaction_stats import CompactionStats


def test_default_values():
    s = CompactionStats()

    assert s.input_tables == 0
    assert s.output_tables == 0
    assert s.obsolete_records == 0
    assert s.duration_ms == 0.0


def test_reset():
    s = CompactionStats()

    s.input_tables = 3
    s.output_tables = 1
    s.input_records = 50
    s.bytes_in = 100

    s.reset()

    assert s.input_tables == 0
    assert s.output_tables == 0
    assert s.input_records == 0
    assert s.bytes_in == 0