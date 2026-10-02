"""Write a big sheet of made-up contacts (for trying the import at the size it is meant for).

    python -m scripts.make_big_sheet sheet.csv --rows 1000000
    python -m scripts.make_big_sheet sheet.xlsx --rows 200000 --invalid 0.02 --repeat 0.01

Every number is a valid Indian mobile number and is different from the others - except the `--repeat` share (the same number again,
written in another way) and the `--invalid` share (rows with a problem). Nothing in it is real.
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from pathlib import Path

HEADER = ["Name", "Mobile", "Email", "City", "Category", "Priority", "Tags", "Company"]
FIRST = ["Aarav", "Vivaan", "Aditya", "Sai", "Arjun", "Ananya", "Diya", "Isha", "Kavya", "Meera", "Rohan", "Priya", "Neha", "Rahul", "Sneha", "Omkar", "Mahesh", "Jyoti"]
LAST = ["Patil", "Shelke", "Bhusare", "Deshmukh", "Jadhav", "More", "Pawar", "Kulkarni", "Joshi", "Shinde", "Gaikwad", "Kale", "Sharma", "Singh", "Khan"]
CITIES = ["Pune", "Mumbai", "Nagpur", "Nashik", "Thane", "Aurangabad", "Kolhapur", "Solapur", "Satara", "Latur"]
CATEGORIES = ["Retail", "Wholesale", "Online", "Corporate", "Referral"]
BASE = 6_000_000_000  # 6000000000 .. 9999999999 are all valid mobile numbers


def number(index: int, base: int = BASE) -> str:
    return str(base + index)


def row(index: int, rng: random.Random, base: int) -> list[str]:
    name = f"{FIRST[index % len(FIRST)]} {LAST[(index // len(FIRST)) % len(LAST)]} {index}"
    return [
        name, number(index, base), f"c{index}@example.com" if index % 3 == 0 else "", CITIES[index % len(CITIES)],
        CATEGORIES[index % len(CATEGORIES)], str(1 + index % 3), "vip;repeat" if index % 50 == 0 else "", f"Company {index % 997}",
    ]


def generate(rows: int, *, base: int = BASE, invalid: float = 0.01, repeat: float = 0.01, seed: int = 7):
    """Yield the cells of every row of the sheet and, last, a dict with the counts that are expected of it."""
    rng = random.Random(seed)
    expected = {"rows": rows, "invalid": 0, "repeated": 0, "unique": 0}
    uniques: list[int] = []  # the rows whose number is good and new: a repeat is always the number of one of these
    for index in range(rows):
        draw = rng.random()
        cells = row(index, rng, base)
        if draw < invalid:
            cells[1] = rng.choice(["12345", "abc", "", "0000000000", "+91 12"])  # not a mobile number
            expected["invalid"] += 1
        elif draw < invalid + repeat and uniques:
            earlier = uniques[rng.randrange(len(uniques))]
            digits = number(earlier, base)
            cells[1] = f"+91 {digits[:5]} {digits[5:]}"  # the same number, written another way
            cells[0] = "Again " + cells[0]
            expected["repeated"] += 1
        else:
            uniques.append(index)
            expected["unique"] += 1
        yield cells
    yield expected  # type: ignore[misc]


def write_csv(path: Path, rows: int, **kwargs) -> dict:
    expected: dict = {}
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADER)
        for cells in generate(rows, **kwargs):
            if isinstance(cells, dict):
                expected = cells
            else:
                writer.writerow(cells)
    return expected


def write_xlsx(path: Path, rows: int, **kwargs) -> dict:
    from openpyxl import Workbook

    book = Workbook(write_only=True)
    sheet = book.create_sheet("Contacts")
    sheet.append(HEADER)
    expected: dict = {}
    for cells in generate(rows, **kwargs):
        if isinstance(cells, dict):
            expected = cells
        else:
            sheet.append([int(c) if i == 1 and c.isdigit() else c for i, c in enumerate(cells)])  # numbers as numbers, like Excel keeps them
    book.save(path)
    return expected


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--rows", type=int, default=100_000)
    parser.add_argument("--invalid", type=float, default=0.01, help="share of rows with a problem")
    parser.add_argument("--repeat", type=float, default=0.01, help="share of rows that repeat the number of an earlier row")
    parser.add_argument("--base", type=int, default=BASE)
    args = parser.parse_args(argv)
    writer = write_xlsx if args.out.suffix.lower() == ".xlsx" else write_csv
    expected = writer(args.out, args.rows, base=args.base, invalid=args.invalid, repeat=args.repeat)
    print(f"{args.out}: {expected}", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
