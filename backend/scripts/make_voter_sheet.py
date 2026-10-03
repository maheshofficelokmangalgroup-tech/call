"""Make up a voter list in the format of the real one - and say exactly what an import of it must find.

    python -m scripts.make_voter_sheet sheet.csv --rows 209395

The columns are those of the list the company has (Mobile Number, Voter Name, Relative Name, Age, Gender, EPIC No, Voter Pincode,
Voter Address): one row per NUMBER, so the same voter is on several rows (many numbers of one person), the same number is on
several rows (a family that shares a phone, a row typed twice), and a few rows are not numbers at all. Nothing is real.

The expected result is worked out from the rows in the order of the file with the one rule of the import - the first row with a
number keeps it, a later row with the same number is a repeat - and has nothing to do with the code of the import.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from pathlib import Path

HEADER = ["Mobile Number", "Voter Name", "Relative Name", "Age", "Gender", "EPIC No", "Voter Pincode", "Voter Address"]
FIRST = ["Aakash", "Aabid", "Ajit", "Amol", "Anil", "Arun", "Ashok", "Avinash", "Babasaheb", "Bhushan", "Chetan", "Dattatray", "Dilip", "Ganesh", "Hanumant", "Jaykumar", "Kiran", "Mukund", "Nitin", "Omkar", "Pramod", "Rahul", "Rajendra", "Sachin", "Sandeep", "Shivaji", "Suhas", "Sunil", "Vijay", "Vishal"]
FEMALE = ["Aaisha", "Anita", "Kavita", "Madhuri", "Pallavi", "Priya", "Rupali", "Sangita", "Savita", "Shital", "Sunita", "Swati", "Vandana", "Vaishali"]
LAST = ["Aagam", "Aalmane", "Dharavat", "Gaikwad", "Jadhav", "Kamble", "Kulkarni", "Mane", "Mushrif", "Niungare", "Patil", "Pawar", "Shinde", "Sutar", "Waghmare", "Yadav", "Bhosale", "Chavan", "More", "Salunkhe"]
AREAS = ["Maratha Nagar", "Ganesh Nagar", "Ashok Highschool Mage", "Peth Vadgaon", "Kavthesar rasta", "Sali Galli", "Vasant Rutu Colony", "Station Road", "Market Yard", "Shivaji Chowk"]
VILLAGES = ["Hatkanangale", "Bhudargad", "Karvir", "Shirol", "Panhala", "Radhanagari", "Kagal", "Ichalkaranji", "Kasba Bawda", "Danoli"]
GENDER_WORDS = ("M", "F")


def _number(index: int) -> str:
    """The index-th number: all different, all valid mobile numbers (6-9 and nine more digits). 7919 is prime and does not divide the modulus."""
    return str(6_000_000_000 + (index * 7919 + 13) % 3_900_000_000)


def make_rows(count: int, seed: int = 7, *, shared: float = 0.04, typed_twice: float = 0.25, bad: float = 0.002) -> list[list[str]]:
    rng = random.Random(seed)
    pincodes = [str(416000 + n) for n in rng.sample(range(1, 400), 185)]
    rows: list[list[str]] = []
    person = 0
    next_number = 0
    earlier: list[str] = []  # numbers of people made before (a family that shares a phone)
    while len(rows) < count:
        person += 1
        male = rng.random() < 0.94
        first = rng.choice(FIRST if male else FEMALE)
        relative = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        name = f"{first} {rng.choice(['Aaba', 'Hasan', 'Vitthal', 'Pramod', 'Dattatray', 'Jaykumar'])} {rng.choice(LAST)}"
        age = str(rng.randint(18, 90))
        epic = f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{person:07d}" if rng.random() < 0.09 else ""
        pin = rng.choice(pincodes)
        address = f"{rng.randint(1, 900)}/{person}, {rng.choice(AREAS)}, {rng.choice(VILLAGES)}, KOLHAPUR, {pin}"  # (the person's number in it: no two people are alike)
        wanted = rng.choices([1, 2, 3, 4, 5, 6, 8, 12, 16], weights=[40, 20, 12, 8, 6, 5, 4, 3, 2])[0]
        numbers: list[str] = []
        for _ in range(wanted):
            if earlier and rng.random() < shared:
                numbers.append(rng.choice(earlier))  # somebody else's number
            else:
                numbers.append(_number(next_number))
                next_number += 1
        earlier.extend(numbers[:2])
        if len(earlier) > 5000:
            del earlier[:2500]
        lines = []
        for number in numbers:
            lines.append(number)
            if rng.random() < typed_twice:
                lines.append(number)  # the same row typed twice
        if rng.random() < bad:
            lines.append(rng.choice(["12345", "98765", "abcdefghij", "0000000000"]))
        rng.shuffle(lines)
        for number in lines:
            rows.append([number, name if rng.random() > 0.05 else name.upper(), relative, age, "M" if male else "F", epic, pin, address])
    return rows[:count]


def expected_of(rows: list[list[str]]) -> dict:
    """What an import must find, from the rows in the order of the file."""
    seen: set[str] = set()
    people: dict[str, list[str]] = {}
    repeated = invalid = 0
    for number, name, relative, age, gender, epic, pin, address in rows:
        if not (number.isdigit() and len(number) == 10 and number[0] in "6789" and len(set(number)) > 1):
            invalid += 1
            continue
        if number in seen:
            repeated += 1
            continue
        seen.add(number)
        people.setdefault(f"{relative}|{age}|{pin}|{address}", []).append(number)
    return {
        "rows": len(rows), "invalid": invalid, "repeated": repeated, "survivors": len(seen), "people": len(people), "numbers": len(seen),
        "merged_rows": len(seen) - len(people), "unique_numbers_in_sheet": len({r[0] for r in rows}),
        "most_numbers_of_one_person": max((len(v) for v in people.values()), default=0), "_people": people,
    }


def write_csv(path: Path, count: int, seed: int = 7) -> dict:
    rows = make_rows(count, seed)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADER)
        writer.writerows(rows)
    return expected_of(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("path", type=Path)
    parser.add_argument("--rows", type=int, default=209_395)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args(argv)
    expected = write_csv(args.path, args.rows, args.seed)
    expected.pop("_people")
    print(f"{args.path} ({args.path.stat().st_size / 1024 / 1024:.1f} MB): " + json.dumps(expected))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
