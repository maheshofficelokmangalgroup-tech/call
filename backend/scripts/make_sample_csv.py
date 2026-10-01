"""Generate a sample contact file for trying the import (default: 10,000 rows).

    python -m scripts.make_sample_csv --rows 10000 --out sample_contacts_10000.csv

The file deliberately contains a few invalid rows and duplicates so the preview/error report can be seen.
Numbers are reserved fictional ones (+1 xxx 555-01xx) unless --numbers india is given.
"""

from __future__ import annotations

import argparse
import csv
import random

from scripts.seed_demo import CATEGORIES, CITIES, COMPANIES, LATIN_FIRST, LATIN_LAST, phone_source


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rows", type=int, default=10_000)
    parser.add_argument("--out", default="sample_contacts.csv")
    parser.add_argument("--numbers", choices=["fictional", "india"], default="india")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    rng = random.Random(args.seed)
    next_phone = phone_source(args.numbers, rng) if args.numbers == "india" else None

    fict = [f"+1{a}555{n:04d}" for a in (202, 212, 213, 214, 305, 312, 404, 415, 512, 602, 617, 702, 713, 808, 917, 206, 303, 314, 407, 505, 603, 614, 801, 901, 916) for n in range(100, 200)]
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Name", "Mobile", "Email", "City", "Category", "Priority", "Tags", "Company"])
        for i in range(args.rows):
            name = f"{rng.choice(LATIN_FIRST)} {rng.choice(LATIN_LAST)}"
            phone = next_phone() if next_phone else (fict[i] if i < len(fict) else f"9{rng.randint(100000000, 999999999)}")
            if i % 97 == 96:
                phone = "00000"  # invalid
            writer.writerow([name, phone, f"user{i}@example.com", rng.choice(CITIES), rng.choice(CATEGORIES), rng.choice(["High", "Medium", "Low", ""]), "sample", rng.choice(COMPANIES)])
    print(f"Wrote {args.rows} rows to {args.out}")


if __name__ == "__main__":
    main()
