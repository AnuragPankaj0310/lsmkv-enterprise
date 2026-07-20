from __future__ import annotations

from dataclasses import dataclass

from storage.record import Record


@dataclass
class ReplicaDifference:
    key: str
    source: Record
    destination: Record | None


def records_to_sync(
    source: dict[str, Record],
    destination: dict[str, Record],
) -> list[ReplicaDifference]:
    """
    Compare two replicas.

    Returns records that should be copied from source
    to destination.
    """

    repairs = []

    for key, record in source.items():
        other = destination.get(key)

        if other is None:
            repairs.append(
                ReplicaDifference(
                    key,
                    record,
                    None,
                )
            )
            continue

        if (
            other.version,
            other.timestamp,
        ) < (
            record.version,
            record.timestamp,
        ):
            repairs.append(
                ReplicaDifference(
                    key,
                    record,
                    other,
                )
            )

    return repairs