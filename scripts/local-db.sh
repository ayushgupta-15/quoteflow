#!/usr/bin/env bash
# Private, throwaway Postgres cluster inside the project (.pgdata), on port 54329.
# No sudo and no interference with any system Postgres. Needs the PostgreSQL server binaries.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.pgdata"
PORT="${PGPORT_LOCAL:-54329}"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"

case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      "$BIN/initdb" -D "$DATA" -U quoteflow --auth=trust >/dev/null
      echo "unix_socket_directories = '$DATA'" >> "$DATA/postgresql.conf"
    fi
    "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$DATA/server.log" -w start
    "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U quoteflow -d postgres -tc \
      "SELECT 1 FROM pg_database WHERE datname='quoteflow'" | grep -q 1 \
      || "$BIN/createdb" -h 127.0.0.1 -p "$PORT" -U quoteflow quoteflow
    echo "Postgres ready: postgres://quoteflow@127.0.0.1:$PORT/quoteflow"
    ;;
  stop)
    "$BIN/pg_ctl" -D "$DATA" -m fast stop
    ;;
  *)
    echo "usage: $0 start|stop"; exit 1;;
esac
