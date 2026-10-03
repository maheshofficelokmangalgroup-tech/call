"""`npm audit` for what ships, with a short, written list of advisories that are accepted on purpose.

    npm audit --package-lock-only --omit=dev --json | python .github/scripts/audit_allowlist.py [--level high]

Fails when there is a vulnerability of the given severity (or worse) that is not in ACCEPTED. An accepted advisory needs a reason and
a date to look at it again - an advisory nobody can fix must not stop every change, but it must not be forgotten either.
"""

from __future__ import annotations

import json
import sys

ORDER = {"info": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}

# advisory id -> why it is accepted (and when to look again)
ACCEPTED = {
    "GHSA-vfj7-8cjw-p6xm": (
        "braces (all versions, no fix published): a deeply nested glob pattern can exhaust the stack. It is only used by React Native's "
        "build tooling (CLI / Metro) on our own source files at build time; it is not part of the app that runs on a phone and it never "
        "sees input from outside. Accepted 2026-10-03; look again when a fixed braces is published."
    ),
}


def main() -> int:
    level = ORDER[sys.argv[sys.argv.index("--level") + 1]] if "--level" in sys.argv else ORDER["high"]
    report = json.load(sys.stdin)
    found: dict[str, tuple[str, str, str]] = {}  # advisory id -> (severity, package, title)
    for name, vulnerability in (report.get("vulnerabilities") or {}).items():
        for via in vulnerability.get("via", []):
            if isinstance(via, dict) and ORDER.get(via.get("severity", "info"), 0) >= level:
                advisory = (via.get("url") or "").rsplit("/", 1)[-1] or via.get("title", "?")
                found[advisory] = (via["severity"], via.get("name", name), via.get("title", ""))
    problems = {a: v for a, v in found.items() if a not in ACCEPTED}
    for advisory, (severity, package, title) in sorted(found.items()):
        state = "ACCEPTED" if advisory in ACCEPTED else "NOT ACCEPTED"
        print(f"{state}: {severity} {package} {advisory} - {title}")
        if advisory in ACCEPTED:
            print(f"    {ACCEPTED[advisory]}")
    if problems:
        print(f"\n{len(problems)} vulnerabilities of level {sys.argv[sys.argv.index('--level') + 1] if '--level' in sys.argv else 'high'} or worse are not accepted.")
        return 1
    print("No vulnerability of that level besides the accepted ones.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
