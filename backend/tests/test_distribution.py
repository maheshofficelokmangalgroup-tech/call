"""The arithmetic of sharing contacts out: exact, even, deterministic. Checked against brute force and with random cases."""

from __future__ import annotations

import random
from collections import Counter

import pytest

from app.services.distribution import Recipient, Schedule, balanced_quotas, equal_quotas, quotas


def people(*loads: int) -> list[Recipient]:
    return [Recipient(employee_id=10 + i, load=load) for i, load in enumerate(loads)]


# ----------------------------------------------------------------------------------------------------------------- equal
def test_ten_thousand_contacts_for_ten_people_is_a_thousand_each():
    assert set(equal_quotas(10_000, people(*[0] * 10)).values()) == {1000}


def test_what_does_not_divide_goes_to_the_ones_with_the_lightest_load_one_each():
    result = equal_quotas(10, people(5, 0, 9))  # 3 each and one more
    assert sum(result.values()) == 10
    assert result == {11: 4, 10: 3, 12: 3}  # the lightest (id 11, load 0) gets the extra one


def test_the_difference_is_never_more_than_one_and_nothing_is_lost():
    rng = random.Random(7)
    for _ in range(500):
        count = rng.randint(1, 40)
        n = rng.randint(0, 5000)
        result = equal_quotas(n, people(*[rng.randint(0, 500) for _ in range(count)]))
        assert sum(result.values()) == n and len(result) == count
        assert max(result.values()) - min(result.values()) <= 1


def test_the_same_input_always_gives_the_same_answer():
    group = people(3, 3, 3, 0, 7)
    assert equal_quotas(23, group) == equal_quotas(23, list(reversed(group)))
    assert balanced_quotas(23, group) == balanced_quotas(23, list(reversed(group)))


# -------------------------------------------------------------------------------------------------------------- balanced
def test_the_lightest_loaded_person_is_brought_up_first():
    assert balanced_quotas(10, people(0, 6)) == {10: 8, 11: 2}  # 8 and 8 in total... 0+8 = 8, 6+2 = 8
    assert balanced_quotas(3, people(0, 6)) == {10: 3, 11: 0}  # not enough to reach the other one


def test_balanced_is_what_giving_one_at_a_time_to_the_lightest_would_give():
    rng = random.Random(11)
    for _ in range(400):
        group = people(*[rng.randint(0, 30) for _ in range(rng.randint(1, 8))])
        n = rng.randint(0, 120)
        loads = {r.employee_id: r.load for r in group}
        expected = Counter()
        for _ in range(n):
            lightest = min(loads, key=lambda e: (loads[e], e))
            loads[lightest] += 1
            expected[lightest] += 1
        got = balanced_quotas(n, group)
        assert {k: v for k, v in got.items() if v} == dict(expected)
        assert sum(got.values()) == n


def test_the_strategy_is_chosen_by_name():
    group = people(0, 5)
    assert quotas("equal", 10, group) == equal_quotas(10, group)
    assert quotas("balance_total", 10, group) == balanced_quotas(10, group)
    with pytest.raises(ValueError):
        quotas("nonsense", 1, group)


@pytest.mark.parametrize("n,group", [(-1, people(0)), (5, []), (5, [Recipient(1), Recipient(1)])])
def test_impossible_requests_are_refused(n, group):
    with pytest.raises(ValueError):
        equal_quotas(n, group)


# ------------------------------------------------------------------------------------------------------------- schedule
@pytest.mark.parametrize("order", ["interleave", "blocks"])
def test_every_person_gets_exactly_their_quota(order):
    rng = random.Random(3)
    for _ in range(200):
        want = [(i, rng.randint(0, 40)) for i in range(rng.randint(1, 12))]
        schedule = Schedule(want, order)
        got = Counter(schedule.employee_at(i) for i in range(schedule.total))
        assert got == Counter({i: q for i, q in want if q})


def test_interleave_gives_one_to_each_in_turn_and_blocks_gives_runs():
    assert [Schedule([(1, 3), (2, 2), (3, 1)], "interleave").employee_at(i) for i in range(6)] == [1, 2, 3, 1, 2, 1]
    assert [Schedule([(1, 3), (2, 2), (3, 1)], "blocks").employee_at(i) for i in range(6)] == [1, 1, 1, 2, 2, 3]


def test_equal_quotas_interleave_is_a_plain_round_robin():
    schedule = Schedule(list(equal_quotas(9, people(0, 0, 0)).items()), "interleave")
    sequence = [schedule.employee_at(i) for i in range(9)]
    assert sequence[:3] == sequence[3:6] == sequence[6:] and len(set(sequence[:3])) == 3


def test_a_job_can_continue_from_any_point_because_the_answer_depends_on_the_number_alone():
    schedule = Schedule([(1, 400_000), (2, 350_000), (3, 250_000)], "interleave")
    assert schedule.total == 1_000_000
    first = [schedule.employee_at(i) for i in range(1000)]
    again = Schedule([(3, 250_000), (1, 400_000), (2, 350_000)], "interleave")  # the order of the list does not matter
    assert [again.employee_at(i) for i in range(1000)] == first
    assert schedule.employee_at(999_999) in (1, 2, 3)


def test_a_number_outside_the_plan_is_an_error_not_a_wrong_answer():
    schedule = Schedule([(1, 2)])
    with pytest.raises(IndexError):
        schedule.employee_at(2)
    with pytest.raises(IndexError):
        schedule.employee_at(-1)
