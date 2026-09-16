#!/usr/bin/env python3
"""Exercise update.sh change classification against a throwaway checkout/install pair.

The script runs `update.sh --check`, which only prints what a real run would do, with
SRC_DIR/INSTALL_DIR pointing into a temporary directory. Nothing outside that temp dir
is touched, so this is safe to run on any machine that has git + bash.

Two cases are covered:
  1. an undeployed commit that only touches admin/ and landing/ must still be recognised
     (the install is not allowed to go quiet just because no backend file changed), and
     must not trigger any npm/backend build;
  2. a checkout whose HEAD is already the recorded deployed revision is a no-op.
"""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

script = pathlib.Path(__file__).resolve().parents[1] / 'update.sh'
failures = []


def git(cwd, *args):
    return subprocess.check_output(['git', '-C', str(cwd), *args], text=True).strip()


def check(condition, message):
    if not condition:
        failures.append(message)


def run_check(src, install):
    env = {**os.environ, 'SRC_DIR': str(src), 'INSTALL_DIR': str(install)}
    proc = subprocess.run(
        ['bash', str(script), '--check', '--no-pull'],
        cwd=str(src), env=env, text=True, capture_output=True,
    )
    return proc


def changed_parts(out):
    match = re.search(r'changed:\s*(.+)$', out, re.M)
    return set(match.group(1).split()) if match else set()


with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    src, install = root / 'src', root / 'install'
    (src / 'backend').mkdir(parents=True)
    (install / 'backend').mkdir(parents=True)

    git(src, 'init', '-q')
    git(src, 'config', 'user.email', 'test@example.invalid')
    git(src, 'config', 'user.name', 'Test')

    (src / 'backend' / 'base.txt').write_text('base\n', encoding='utf-8')
    git(src, 'add', '.')
    git(src, 'commit', '-qm', 'baseline')
    baseline = git(src, 'rev-parse', 'HEAD')
    (install / '.vizitik-revision').write_text(baseline + '\n', encoding='utf-8')

    # --- case 1: undeployed changes outside backend/ ---------------------
    (src / 'admin').mkdir(exist_ok=True)
    (src / 'admin' / 'index.html').write_text('admin\n', encoding='utf-8')
    (src / 'landing').mkdir(exist_ok=True)
    (src / 'landing' / 'index.html').write_text('landing\n', encoding='utf-8')
    git(src, 'add', '.')
    git(src, 'commit', '-qm', 'admin + landing')
    head = git(src, 'rev-parse', 'HEAD')

    proc = run_check(src, install)
    out = proc.stdout + proc.stderr
    check(proc.returncode == 0, f'case 1: update.sh --check exited {proc.returncode}\n{out}')
    check(changed_parts(out) == {'admin', 'landing'},
          f'case 1: expected "changed: admin landing", got {changed_parts(out) or "<nothing>"}\n{out}')
    check('npm' not in out, f'case 1: backend/frontend work was scheduled despite no code change\n{out}')
    check(not (install / 'admin').exists() and not (install / 'landing').exists(),
          'case 1: --check must not copy anything into the install dir')

    # --- case 2: nothing new to deploy ----------------------------------
    (install / '.vizitik-revision').write_text(head + '\n', encoding='utf-8')
    proc = run_check(src, install)
    out = proc.stdout + proc.stderr
    check(proc.returncode == 0, f'case 2: update.sh --check exited {proc.returncode}\n{out}')
    check('nothing changed' in out or 'already at latest' in out,
          f'case 2: expected a no-op, got:\n{out}')
    check('npm' not in out, f'case 2: no-op run tried to build something\n{out}')

if failures:
    for failure in failures:
        print('FAIL:', failure, file=sys.stderr)
    sys.exit(1)

print('PASS: update.sh keeps undeployed admin/landing changes and treats a deployed revision as a no-op')
