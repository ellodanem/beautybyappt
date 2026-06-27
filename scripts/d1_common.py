"""Shared helpers for Cloudflare D1 local ↔ remote sync."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_NAME = "beautybyappt-db"
BACKUP_DIR = ROOT / ".d1-backups"

CLEAR_ORDER = [
    "appointment_offering_addons",
    "appointment_services",
    "appointment_notes",
    "payments",
    "notification_log",
    "appointments",
    "booking_links",
    "offering_slot_instances",
    "offering_addons",
    "offering_time_slots",
    "offering_date_windows",
    "offerings",
    "blocked_slots",
    "products",
    "services",
    "clients",
    "staff",
    "_meta",
]

INSERT_ORDER = [
    "staff",
    "clients",
    "services",
    "products",
    "offerings",
    "offering_date_windows",
    "offering_time_slots",
    "offering_addons",
    "offering_slot_instances",
    "appointments",
    "appointment_services",
    "appointment_notes",
    "appointment_offering_addons",
    "booking_links",
    "blocked_slots",
    "payments",
    "notification_log",
    "_meta",
]

STATUS_TABLES = ("appointments", "services", "clients", "staff")


def database_id() -> str:
    text = (ROOT / "wrangler.toml").read_text(encoding="utf-8")
    match = re.search(r'database_id\s*=\s*"([^"]+)"', text)
    if not match or match.group(1) == "local":
        raise SystemExit("wrangler.toml must have a real remote database_id.")
    return match.group(1)


def local_db_path() -> Path:
    digest = hashlib.sha256(database_id().encode()).hexdigest()
    return ROOT / f".wrangler/state/v3/d1/miniflare-D1DatabaseObject/{digest}.sqlite"


def run_wrangler(args: list[str]) -> subprocess.CompletedProcess[str]:
    parts = ["pnpm", "exec", "wrangler", "d1", *args]
    return subprocess.run(
        parts,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        shell=True,
        encoding="utf-8",
        errors="replace",
    )


def backup_remote(label: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out = BACKUP_DIR / f"remote-{label}-{ts}.sql"
    result = run_wrangler(["export", DB_NAME, "--remote", f"--output={out}"])
    if result.returncode != 0:
        raise SystemExit(f"Remote backup failed:\n{result.stderr or result.stdout}")
    print(f"Remote backup: {out}")
    return out


def fetch_remote_table(table: str) -> list[dict]:
    result = run_wrangler(["execute", DB_NAME, "--remote", "--json", "--command", f"SELECT * FROM {table}"])
    if result.returncode != 0:
        raise SystemExit(f"Failed to read remote {table}:\n{result.stderr or result.stdout}")
    payload = json.loads(result.stdout)
    if not payload or not payload[0].get("success"):
        raise SystemExit(f"Remote query failed for {table}: {result.stdout}")
    return payload[0].get("results") or []


def fetch_local_counts(conn) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in STATUS_TABLES:
        try:
            counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        except Exception:
            counts[table] = -1
    return counts


def fetch_remote_counts() -> dict[str, int]:
    return fetch_table_counts("--remote")


def fetch_local_counts_wrangler() -> dict[str, int | str]:
    try:
        return fetch_table_counts("--local")
    except SystemExit:
        return {table: "missing" for table in STATUS_TABLES}


def fetch_table_counts(target: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in STATUS_TABLES:
        result = run_wrangler([
            "execute", DB_NAME, target, "--json", "--command", f"SELECT COUNT(*) as n FROM {table}",
        ])
        if result.returncode != 0:
            raise SystemExit(f"Failed to count {target} {table}:\n{result.stderr or result.stdout}")
        payload = json.loads(result.stdout)
        counts[table] = payload[0]["results"][0]["n"]
    return counts


def fetch_local_table(table: str) -> list[dict]:
    result = run_wrangler(["execute", DB_NAME, "--local", "--json", "--command", f"SELECT * FROM {table}"])
    if result.returncode != 0:
        raise SystemExit(f"Failed to read local {table}:\n{result.stderr or result.stdout}")
    payload = json.loads(result.stdout)
    if not payload or not payload[0].get("success"):
        raise SystemExit(f"Local query failed for {table}: {result.stdout}")
    return payload[0].get("results") or []


def apply_local_schema() -> None:
    result = run_wrangler(["execute", DB_NAME, "--local", "--file=src/server/schema.sql"])
    if result.returncode != 0:
        raise SystemExit(f"Failed to apply local schema:\n{result.stderr or result.stdout}")


def execute_local_sql(path: Path) -> None:
    result = run_wrangler(["execute", DB_NAME, "--local", f"--file={path}"])
    if result.returncode != 0:
        raise SystemExit(f"Failed to execute local SQL ({path.name}):\n{result.stderr or result.stdout}")


def sql_literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def generate_replace_sql(rows_by_table: dict[str, list[dict]]) -> str:
    lines = ["PRAGMA defer_foreign_keys=TRUE;", ""]
    for table in CLEAR_ORDER:
        lines.append(f"DELETE FROM {table};")
    lines.append("")
    for table in INSERT_ORDER:
        rows = rows_by_table.get(table) or []
        if not rows:
            continue
        cols = list(rows[0].keys())
        col_list = ", ".join(cols)
        for row in rows:
            values = ", ".join(sql_literal(row.get(col)) for col in cols)
            lines.append(f"INSERT INTO {table} ({col_list}) VALUES ({values});")
    lines.append("")
    return "\n".join(lines)
