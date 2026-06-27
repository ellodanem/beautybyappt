"""Safe Cloudflare D1 sync: pull (default) and guarded push."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from d1_common import (
    BACKUP_DIR,
    CLEAR_ORDER,
    INSERT_ORDER,
    ROOT,
    STATUS_TABLES,
    apply_local_schema,
    backup_remote,
    database_id,
    execute_local_sql,
    fetch_local_counts_wrangler,
    fetch_local_table,
    fetch_remote_counts,
    fetch_remote_table,
    generate_replace_sql,
    run_wrangler,
)

PUSH_CONFIRM_FLAG = "--confirm-overwrite-remote"
PUSH_CONFIRM_ENV = "D1_PUSH_CONFIRM"


def cmd_status() -> int:
    print(f"Database: {database_id()}")
    remote = fetch_remote_counts()
    print("\nRemote (production — source of truth):")
    for table in STATUS_TABLES:
        print(f"  {table}: {remote[table]}")

    print("\nLocal:")
    for table, count in fetch_local_counts_wrangler().items():
        print(f"  {table}: {count}")
    return 0


def cmd_pull(skip_backup: bool) -> int:
    if not skip_backup:
        backup_remote("before-pull")

    print("Applying local schema…")
    apply_local_schema()

    rows_by_table: dict[str, list[dict]] = {}
    for table in INSERT_ORDER:
        rows = fetch_remote_table(table)
        rows_by_table[table] = rows
        print(f"  fetched {table}: {len(rows)} rows")

    import_sql = BACKUP_DIR / "pull-local-replace.sql"
    BACKUP_DIR.mkdir(exist_ok=True)
    import_sql.write_text(generate_replace_sql(rows_by_table), encoding="utf-8")
    print(f"Importing into local D1 via wrangler ({import_sql.name})…")
    execute_local_sql(import_sql)
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
    local_counts = fetch_local_counts_wrangler()
    if all(count == "missing" for count in local_counts.values()):
        print("No local D1 data to push.")
        return 1

    local = {table: count for table, count in local_counts.items() if isinstance(count, int)}

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
        rows_by_table[table] = fetch_local_table(table)

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
