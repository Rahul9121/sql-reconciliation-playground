#!/usr/bin/env python3
"""Load CSVs into DuckDB and verify every challenge solution returns a result set."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute(
        f"""
        CREATE OR REPLACE TABLE trades AS
        SELECT * FROM read_csv_auto('{(DATA / 'trades.csv').as_posix()}', header=true, sample_size=-1);
        CREATE OR REPLACE TABLE ledger_entries AS
        SELECT * FROM read_csv_auto('{(DATA / 'ledger_entries.csv').as_posix()}', header=true, sample_size=-1);
        CREATE OR REPLACE TABLE accounts AS
        SELECT * FROM read_csv_auto('{(DATA / 'accounts.csv').as_posix()}', header=true, sample_size=-1);
        """
    )


def main() -> int:
    challenges_path = DATA / "challenges.json"
    if not (DATA / "trades.csv").exists():
        print("Missing data CSVs. Run: python scripts/generate_data.py", file=sys.stderr)
        return 2
    challenges = json.loads(challenges_path.read_text(encoding="utf-8"))
    conn = duckdb.connect(database=":memory:")
    load(conn)

    counts = conn.execute(
        "SELECT (SELECT COUNT(*) FROM trades), (SELECT COUNT(*) FROM ledger_entries), (SELECT COUNT(*) FROM accounts)"
    ).fetchone()
    print(f"Loaded rows trades={counts[0]} ledger={counts[1]} accounts={counts[2]}")

    failed = 0
    for ch in challenges:
        cid = ch["id"]
        sql = ch["solution_sql"]
        try:
            rel = conn.execute(sql)
            rows = rel.fetchall()
            cols = [d[0] for d in rel.description]
            if not cols:
                raise AssertionError("solution returned no columns")
            # Re-run must be stable
            rows2 = conn.execute(sql).fetchall()
            if rows != rows2:
                raise AssertionError("solution is not deterministic")
            print(f"OK  {cid:28} rows={len(rows):5d} cols={len(cols)}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {cid}: {exc}", file=sys.stderr)

    if failed:
        print(f"{failed} challenge(s) failed", file=sys.stderr)
        return 1
    print(f"All {len(challenges)} challenge solutions passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
