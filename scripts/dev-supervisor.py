#!/usr/bin/env python3
"""Run dev servers and reap the entire npm/watch process trees on any exit."""
import importlib.machinery
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
config = importlib.machinery.SourceFileLoader('backup', str(ROOT / 'scripts/database-backup.py')).load_module().read_env(ROOT / 'backend/.env')
env = {**os.environ, 'NODE_ENV': 'development', 'HOST': '0.0.0.0', 'BIND_HOST': '0.0.0.0',
       'BACKUP_DIR': str(ROOT / '.backups'),
       'DEV_API_TARGET': 'http://127.0.0.1:' + config.get('PORT', '3000')}
children = []


def stop(signum, frame):
    raise SystemExit(128 + signum)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    for directory, command in [('backend', ['npm', 'run', 'start:dev']),
                               ('admin', ['node', 'server.js']),
                               ('frontend-app', ['npm', 'run', 'dev', '--', '--host', '0.0.0.0'])]:
        children.append(subprocess.Popen(command, cwd=ROOT / directory, env=env, start_new_session=True))
    print('PWA :5173 (same-origin /api proxy); admin :' + config.get('ADMIN_PORT', '3001') + '; Ctrl+C stops all.', flush=True)
    while True:
        for child in children:
            if child.poll() is not None:
                raise SystemExit(child.returncode or 1)
        time.sleep(0.25)
finally:
    for child in children:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 5
    for child in children:
        try:
            child.wait(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            pass
    # Even if the group leader exited, npm's grandchildren may still be alive.
    for child in children:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
