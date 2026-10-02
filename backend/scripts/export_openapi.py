"""Write the API's OpenAPI document to a file (or stdout) without starting the server.

    python -m scripts.export_openapi ../admin-web/openapi.json

The admin panel generates its TypeScript types from it (`npm run gen:api`), and CI regenerates them to make sure the
panel and the API never drift apart.
"""

from __future__ import annotations

import json
import sys

from app.main import app


def main() -> int:
    document = json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False)
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as handle:
            handle.write(document + "\n")
    else:
        sys.stdout.write(document + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
