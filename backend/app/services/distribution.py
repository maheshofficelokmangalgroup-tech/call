"""How a number of contacts is shared between employees. Pure functions: no database, easy to prove right.

Two ways to decide how many each person gets (`quotas`), two ways to hand the contacts out (`Schedule`).

  equal_quotas      10,000 contacts, 10 people  ->  1,000 each. When it does not divide, the ones with the lightest load get one
                    more (then the lowest id), so the difference is never more than one.
  balanced_quotas   "even out the work": whoever has the least to do gets the most, until everybody has the same in total.

  Schedule          which person receives the contact with number i (0, 1, 2 ...):
                      interleave  one for each person in turn (everybody gets a mix of the whole sheet)
                      blocks      the first block to the first person, the next block to the second ...
                    The answer depends on i alone, so a job that stopped after a million contacts goes on exactly where it was.
"""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import accumulate

STRATEGIES = ("equal", "balance_total")
ORDERS = ("interleave", "blocks")


@dataclass(frozen=True)
class Recipient:
    employee_id: int
    load: int = 0  # contacts they already have to call


def _lightest_first(recipients: Sequence[Recipient]) -> list[Recipient]:
    return sorted(recipients, key=lambda r: (r.load, r.employee_id))


def _check(n: int, recipients: Sequence[Recipient]) -> None:
    if n < 0:
        raise ValueError("The number of contacts cannot be negative.")
    if not recipients:
        raise ValueError("There is nobody to share the contacts with.")
    if len({r.employee_id for r in recipients}) != len(recipients):
        raise ValueError("An employee is listed twice.")


def equal_quotas(n: int, recipients: Sequence[Recipient]) -> dict[int, int]:
    _check(n, recipients)
    base, extra = divmod(n, len(recipients))
    return {r.employee_id: base + (1 if index < extra else 0) for index, r in enumerate(_lightest_first(recipients))}


def balanced_quotas(n: int, recipients: Sequence[Recipient]) -> dict[int, int]:
    """Give the next contact to whoever has the least in total, n times - worked out at once (water filling)."""
    _check(n, recipients)
    order = _lightest_first(recipients)
    loads = [r.load for r in order]
    remaining, level, k = n, loads[0], 1  # the k lightest are, in effect, all at `level`
    while k < len(order):
        need = k * (loads[k] - level)  # what it takes to bring the k up to the load of the next person
        if remaining < need:
            break
        remaining -= need
        level = loads[k]
        k += 1
    add, extra = divmod(remaining, k)
    quotas = {r.employee_id: 0 for r in order}
    # the k who are now level share the rest; what does not divide goes to the lowest ids (that is what "the next one to whoever has
    # the least, the lowest id when equal" does once they are level)
    for index, person in enumerate(sorted(order[:k], key=lambda r: r.employee_id)):
        quotas[person.employee_id] = (level + add - person.load) + (1 if index < extra else 0)
    return quotas


def level_targets(recipients: Sequence[Recipient]) -> dict[int, int]:
    """Everybody the same: what each person should have when `load` (what they have to call now) is shared out again between all of them.
    The remainder (fewer than the number of people) stays with the ones who have the most now, so as few contacts as possible move; the
    difference between two people is never more than one."""
    if not recipients:
        raise ValueError("There is nobody to share the contacts with.")
    if len({r.employee_id for r in recipients}) != len(recipients):
        raise ValueError("An employee is listed twice.")
    base, extra = divmod(sum(r.load for r in recipients), len(recipients))
    heaviest_first = sorted(recipients, key=lambda r: (-r.load, r.employee_id))
    return {r.employee_id: base + (1 if index < extra else 0) for index, r in enumerate(heaviest_first)}


def quotas(strategy: str, n: int, recipients: Sequence[Recipient]) -> dict[int, int]:
    if strategy == "equal":
        return equal_quotas(n, recipients)
    if strategy == "balance_total":
        return balanced_quotas(n, recipients)
    raise ValueError(f"Unknown strategy '{strategy}'.")


class Schedule:
    """Who gets contact number i. Built from the quotas; `employee_at(i)` is a few comparisons however big i is."""

    def __init__(self, quotas_by_employee: Sequence[tuple[int, int]], order: str = "interleave") -> None:
        if order not in ORDERS:
            raise ValueError(f"Unknown order '{order}'.")
        wanted = [(employee_id, quota) for employee_id, quota in quotas_by_employee if quota > 0]
        if any(quota < 0 for _, quota in quotas_by_employee):
            raise ValueError("A quota cannot be negative.")
        self.order = order
        self.total = sum(quota for _, quota in wanted)
        if order == "blocks":
            self._ids = [employee_id for employee_id, _ in wanted]
            self._ends = list(accumulate(quota for _, quota in wanted))
            return
        # interleave: cycle c gives one contact to everybody whose quota is at least c. People with the biggest quota come first, so the
        # members of a cycle are always the first few of this list.
        by_quota = sorted(wanted, key=lambda item: (-item[1], item[0]))
        self._ids = [employee_id for employee_id, _ in by_quota]
        sizes = [quota for _, quota in by_quota]  # non-increasing
        levels = sorted(set(sizes))
        self._segment_ends: list[int] = []
        self._segment_width: list[int] = []
        done, previous = 0, 0
        for level in levels:
            width = sum(1 for quota in sizes if quota >= level)  # who is still in the game in the cycles previous+1 .. level
            done += (level - previous) * width
            self._segment_ends.append(done)
            self._segment_width.append(width)
            previous = level

    def employee_at(self, index: int) -> int:
        if not 0 <= index < self.total:
            raise IndexError(f"There is no contact number {index} in a plan for {self.total}.")
        if self.order == "blocks":
            return self._ids[bisect_right(self._ends, index)]
        segment = bisect_right(self._segment_ends, index)
        offset = index - (self._segment_ends[segment - 1] if segment else 0)
        return self._ids[offset % self._segment_width[segment]]
