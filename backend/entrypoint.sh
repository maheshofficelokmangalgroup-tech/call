#!/bin/sh
set -e

# Wait for the database, apply migrations, make sure roles/outcomes/settings exist and
# create the first admin when BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD are set.
python -m scripts.bootstrap

exec "$@"
