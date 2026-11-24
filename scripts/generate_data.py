#!/usr/bin/env python3
"""Generate synthetic trade and ledger CSVs for the SQL Reconciliation Playground.

All data is fake. No real or employer data is used.
"""
from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SEED = 42
SYMBOLS = ["AAPL", "MSFT", "GOOG", "AMZN", "TSLA", "META", "NVDA", "JPM", "XOM", "DIS"]
ACCOUNTS = [f"ACC{i:03d}" for i in range(1, 21)]
CURRENCY = "USD"


def main() -> None:
    rng = random.Random(SEED)
    DATA.mkdir(parents=True, exist_ok=True)
    base_ts = datetime(2024, 6, 1, 9, 30, 0)

    trades: list[dict] = []
    # Core matched set ~2800
    for i in range(1, 2801):
        symbol = SYMBOLS[i % len(SYMBOLS)]
        qty = rng.randint(1, 500)
        price = round(rng.uniform(10, 500), 4)
        side = "BUY" if i % 2 == 0 else "SELL"
        account = ACCOUNTS[i % len(ACCOUNTS)]
        ts = base_ts + timedelta(minutes=i)
        trades.append(
            {
                "trade_id": f"T{i:05d}",
                "symbol": symbol,
                "side": side,
                "qty": qty,
                "price": price,
                "notional": round(qty * price, 2),
                "trade_ts": ts.isoformat(sep=" "),
                "account_id": account,
                "external_ref": f"XR{i:05d}",
                "trader": f"trader_{(i % 12) + 1}",
            }
        )

    # Duplicate trade_ids (same id, different rows) — 40 extras reuse T00001.. style
    for j in range(40):
        src = trades[j * 17]
        dup = dict(src)
        dup["qty"] = src["qty"] + 1
        dup["notional"] = round(dup["qty"] * float(dup["price"]), 2)
        dup["trade_ts"] = (base_ts + timedelta(minutes=9000 + j)).isoformat(sep=" ")
        trades.append(dup)

    # Orphan trades (no ledger) — 80
    for k in range(80):
        i = 90000 + k
        qty = rng.randint(1, 100)
        price = round(rng.uniform(10, 200), 4)
        trades.append(
            {
                "trade_id": f"T{i:05d}",
                "symbol": SYMBOLS[k % len(SYMBOLS)],
                "side": "BUY",
                "qty": qty,
                "price": price,
                "notional": round(qty * price, 2),
                "trade_ts": (base_ts + timedelta(minutes=10000 + k)).isoformat(sep=" "),
                "account_id": ACCOUNTS[k % len(ACCOUNTS)],
                "external_ref": f"XR{i:05d}",
                "trader": f"trader_{(k % 12) + 1}",
            }
        )

    # NULL-ish external_ref trades
    for k in range(25):
        i = 91000 + k
        qty = rng.randint(1, 50)
        price = round(rng.uniform(5, 80), 4)
        trades.append(
            {
                "trade_id": f"T{i:05d}",
                "symbol": SYMBOLS[k % len(SYMBOLS)],
                "side": "SELL",
                "qty": qty,
                "price": price,
                "notional": round(qty * price, 2),
                "trade_ts": (base_ts + timedelta(minutes=11000 + k)).isoformat(sep=" "),
                "account_id": ACCOUNTS[k % len(ACCOUNTS)],
                "external_ref": "",
                "trader": f"trader_{(k % 12) + 1}",
            }
        )

    # Build ledger from first 2800 trades with intentional mess
    entries: list[dict] = []
    seq_by_account: dict[str, int] = {a: 0 for a in ACCOUNTS}
    entry_id = 1

    # Matched entries for trades 1..2800 except leave 60 unmatched on ledger side
    skip_trade_indices = set(range(50, 110))  # trades T00051..T00110 have no ledger
    amount_mismatch_indices = set(range(200, 260))  # small amount diffs
    null_trade_ref_indices = set(range(400, 420))

    for idx, t in enumerate(trades[:2800]):
        if idx in skip_trade_indices:
            continue
        account = t["account_id"]
        seq_by_account[account] += 1
        # Introduce sequence gaps every so often
        if seq_by_account[account] % 37 == 0:
            seq_by_account[account] += 1  # skip one number

        amount = float(t["notional"])
        if idx in amount_mismatch_indices:
            # off by 0.01 to 2.50
            amount = round(amount + rng.choice([-1, 1]) * round(rng.uniform(0.01, 2.5), 2), 2)

        trade_ref = t["external_ref"]
        if idx in null_trade_ref_indices:
            trade_ref = ""

        side_sign = 1 if t["side"] == "BUY" else -1
        entries.append(
            {
                "entry_id": f"E{entry_id:05d}",
                "trade_ref": trade_ref,
                "trade_id": t["trade_id"] if idx not in null_trade_ref_indices else "",
                "account_id": account,
                "amount": round(amount * side_sign, 2),
                "abs_amount": round(abs(amount), 2),
                "currency": CURRENCY,
                "booked_at": (
                    datetime.fromisoformat(t["trade_ts"]) + timedelta(seconds=rng.randint(1, 120))
                ).isoformat(sep=" "),
                "seq_no": seq_by_account[account],
                "status": "POSTED" if entry_id % 97 else "PENDING",
                "symbol": t["symbol"],
            }
        )
        entry_id += 1

    # Orphan ledger rows (no matching trade)
    for k in range(70):
        account = ACCOUNTS[k % len(ACCOUNTS)]
        seq_by_account[account] += 1
        if seq_by_account[account] % 41 == 0:
            seq_by_account[account] += 2
        entries.append(
            {
                "entry_id": f"E{entry_id:05d}",
                "trade_ref": f"ORPH{k:04d}",
                "trade_id": f"TXMISS{k:04d}",
                "account_id": account,
                "amount": round(rng.uniform(-5000, 5000), 2),
                "abs_amount": round(rng.uniform(10, 5000), 2),
                "currency": CURRENCY,
                "booked_at": (base_ts + timedelta(minutes=20000 + k)).isoformat(sep=" "),
                "seq_no": seq_by_account[account],
                "status": "POSTED",
                "symbol": SYMBOLS[k % len(SYMBOLS)],
            }
        )
        entry_id += 1

    # Duplicate ledger for same trade_ref (double postings)
    for j in range(30):
        src = entries[j * 11]
        dup = dict(src)
        dup["entry_id"] = f"E{entry_id:05d}"
        entry_id += 1
        account = dup["account_id"]
        seq_by_account[account] += 1
        dup["seq_no"] = seq_by_account[account]
        dup["booked_at"] = (base_ts + timedelta(minutes=30000 + j)).isoformat(sep=" ")
        entries.append(dup)

    write_csv(
        DATA / "trades.csv",
        [
            "trade_id",
            "symbol",
            "side",
            "qty",
            "price",
            "notional",
            "trade_ts",
            "account_id",
            "external_ref",
            "trader",
        ],
        trades,
    )
    write_csv(
        DATA / "ledger_entries.csv",
        [
            "entry_id",
            "trade_ref",
            "trade_id",
            "account_id",
            "amount",
            "abs_amount",
            "currency",
            "booked_at",
            "seq_no",
            "status",
            "symbol",
        ],
        entries,
    )

    # Small accounts dim
    accounts = [{"account_id": a, "desk": f"DESK_{(i % 4) + 1}", "region": ["US", "EU", "APAC"][i % 3]} for i, a in enumerate(ACCOUNTS)]
    write_csv(DATA / "accounts.csv", ["account_id", "desk", "region"], accounts)

    meta = DATA / "DATASET_INFO.txt"
    meta.write_text(
        "SYNTHETIC DATA ONLY\n"
        "Generated by scripts/generate_data.py for the SQL Reconciliation Playground.\n"
        "No real, production, or employer data is included.\n"
        f"seed={SEED}\n"
        f"trades_rows={len(trades)}\n"
        f"ledger_entries_rows={len(entries)}\n"
        f"accounts_rows={len(accounts)}\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(trades)} trades, {len(entries)} ledger entries, {len(accounts)} accounts -> {DATA}")


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            out = {k: ("" if row.get(k) is None else row.get(k)) for k in fieldnames}
            w.writerow(out)


if __name__ == "__main__":
    main()
