"""Safe Cloudflare D1 sync: pull (default) and guarded push."""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

from d1_common import (
    BACKUP_DIR,
    CLEAR_ORDER,
    INSERT_ORDER,
    ROOT,
    STATUS_TABLES,
    backup_remote,
    database_id,
    fetch_remote_counts,
    fetch_remote_table,
    generate_replace_sql,
    local_db_path,
    run_wrangler,
)

PUSH_CONFIRM_FLAG = "--confirm-overwrite-remote"
PUSH_CONFIRM_ENV = "D1_PUSH_CONFIRM"


def ensure_local_schema() -> sqlite3.Connection:
    db_path = local_db_path()
    if not db_path.exists() or db_path.stat().st_size < 4096:
        print("Local D1 missing or empty — applying schema.sql first…")
        result = run_wrangler(["execute", "beautybyappt-db", "--local", "--file=src/server/schema.sql"])
        if result.returncode != 0:
            raise SystemExit(f"Failed to create local schema:\n{result.stderr or result.stdout}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "appointments" not in tables:
        raise SystemExit("Local D1 has no appointments table. Run `pnpm dev` once, then retry pull.")
    return conn


def cmd_status() -> int:
    print(f"Database: {database_id()}")
    remote = fetch_remote_counts()
    print("\nRemote (production — source of truth):")
    for table in STATUS_TABLES:
        print(f"  {table}: {remote[table]}")

    db_path = local_db_path()
    if not db_path.exists():
        print("\nLocal: (no local database file yet)")
        return 0

    conn = sqlite3.connect(db_path)
    print("\nLocal:")
    for table in STATUS_TABLES:
        try:
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        except sqlite3.Error:
            n = "missing"
        print(f"  {table}: {n}")
    conn.close()
    return 0


def cmd_pull(skip_backup: bool) -> int:
    if not skip_backup:
        backup_remote("before-pull")

    conn = ensure_local_schema()
    rows_by_table: dict[str, list[dict]] = {}
    for table in INSERT_ORDER:
        rows = fetch_remote_table(table)
        rows_by_table[table] = rows
        print(f"  fetched {table}: {len(rows)} rows")

    for table in CLEAR_ORDER:
        conn.execute(f"DELETE FROM {table}")
    conn.commit()

    for table in INSERT_ORDER:
        rows = rows_by_table.get(table) or []
        if not rows:
            continue
        cols = list(rows[0].keys())
        placeholders = ", ".join("?" for _ in cols)
        col_list = ", ".join(cols)
        conn.executemany(
            f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})",
            [[row.get(col) for col in cols] for row in rows],
        )
    conn.commit()
    conn.close()
    print("\nPull complete — local D1 now matches remote.")
    return 0


def cmd_push(force: bool) -> int:
    if not force:
        print(
            "Refusing to push: remote D1 is the source of truth.\n"
            f"To overwrite production, rerun with {PUSH_CONFIRM_FLAG}\n"
            f"or set {PUSH_CONFIRM_ENV}=beautybyappt-db\n"
            "\nRecommended: pull first (`pnpm run db:pull`), then push only if intentional."
        )
        return 1

    remote = fetch_remote_counts()
    db_path = local_db_path()
    if not db_path.exists():
        print("No local D1 file to push.")
        return 1

    conn = sqlite3.connect(db_path)
    local = {}
    for table in STATUS_TABLES:
        local[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    print("Before push:")
    for table in STATUS_TABLES:
        print(f"  {table}: remote={remote[table]} local={local[table]}")

    if remote["appointments"] > local["appointments"]:
        print(
            "\nWARNING: Remote has MORE appointments than local. "
            "Pushing would delete production-only data unless you pulled first."
        )

    backup_remote("before-push")

    rows_by_table: dict[str, list[dict]] = {}
    for table in INSERT_ORDER:
        cols = [d[1] for d in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if not cols:
            continue
        cur = conn.execute(f"SELECT * FROM {table}")
        rows_by_table[table] = [dict(zip(cols, row)) for row in cur.fetchall()]
    conn.close()

    out = ROOT / "remote-data-import.sql"
    out.write_text(generate_replace_sql(rows_by_table), encoding="utf-8")
    result = run_wrangler(["execute", "beautybyappt-db", "--remote", f"--file={out}"])
    if result.returncode != 0:
        print(result.stderr or result.stdout)
        print(f"\nPush failed. Remote backup is in {BACKUP_DIR}")
        return 1

    print("\nPush complete — remote D1 replaced with local data.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe D1 sync for Beauty By Appointment")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Compare local vs remote row counts")
    sub.add_parser("backup-remote", help="Export remote D1 to .d1-backups/")
    pull_p = sub.add_parser("pull", help="Remote → local (safe, default sync direction)")
    pull_p.add_argument("--skip-backup", action="store_true", help="Skip remote backup before pull")
    push_p = sub.add_parser("push", help="Local → remote (destructive — requires confirmation)")
    push_p.add_argument(PUSH_CONFIRM_FLAG, action="store_true", help="Required to overwrite remote D1")

    args = parser.parse_args()
    if args.command == "status":
        return cmd_status()
    if args.command == "backup-remote":
        backup_remote("manual")
        return 0
    if args.command == "pull":
        return cmd_pull(args.skip_backup)
    if args.command == "push":
        import os
        force = getattr(args, "confirm_overwrite_remote", False) or os.environ.get(PUSH_CONFIRM_ENV) == "beautybyappt-db"
        return cmd_push(force)
    return 1


if __name__ == "__main__":
    sys.exit(main())
