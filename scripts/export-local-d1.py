#!/usr/bin/env python3
"""Backward-compatible wrapper — use `python scripts/d1_sync.py push` instead."""
import subprocess
import sys

print("Note: use `pnpm run db:push -- --confirm-overwrite-remote` (requires explicit confirmation).")
sys.exit(subprocess.call([sys.executable, "scripts/d1_sync.py", "push", *sys.argv[1:]], cwd="."))
