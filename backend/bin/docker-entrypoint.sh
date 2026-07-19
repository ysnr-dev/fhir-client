#!/bin/bash
set -e

# Remove a stale server pid so the container can restart cleanly.
rm -f tmp/pids/server.pid

# Prepare the database: creates it and loads the schema if it does not exist,
# otherwise runs pending migrations. Idempotent, safe to run on every boot.
bin/rails db:prepare

exec "$@"
