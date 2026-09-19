#!/usr/bin/env python3
"""Exercise the backend-dist rollback in update.sh.

`nest build` wipes dist/ before compiling (deleteOutDir in nest-cli.json), so a
type error used to leave the install with nothing to start. update.sh therefore
archives the current build first and puts it back when the new build fails.

The two functions are extracted from the real scripts/update.sh (not copied), so
this test fails if they are renamed or their behaviour changes.
"""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

update_sh = pathlib.Path(__file__).resolve().parents[1] / 'update.sh'
source = update_sh.read_text(encoding='utf-8')


def extract(name):
    match = re.search(rf'^{name}\(\) \{{.*?^\}}', source, re.M | re.S)
    if not match:
        print(f'FAIL: {name}() is gone from update.sh', file=sys.stderr)
        sys.exit(1)
    return match.group(0)


HARNESS = f'''set -uo pipefail
CHECK=0
have() {{ command -v "$1" >/dev/null 2>&1; }}
run()  {{ "$@"; }}
info() {{ echo "  ..  $*"; }}
warn() {{ echo "  WARN $*"; }}
err()  {{ echo "  FAIL $*" >&2; }}
{extract('archive_backend_dist')}
{extract('restore_backend_dist')}
'''

failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


def run(script, cwd):
    proc = subprocess.run(['bash', '-c', script], cwd=str(cwd), text=True, capture_output=True)
    return proc


def make_dist(backend, marker):
    (backend / 'dist' / 'assets').mkdir(parents=True, exist_ok=True)
    (backend / 'dist' / 'main.js').write_text(marker, encoding='utf-8')
    (backend / 'dist' / 'assets' / 'app.js').write_text(marker, encoding='utf-8')


def archives(backend):
    return sorted(p.name for p in backend.glob('backend.dist.*.tgz'))


with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    backend = root / 'backend'
    backend.mkdir()

    # --- case 1: a failed build restores the previous dist -----------------
    make_dist(backend, 'good-build')
    proc = run(HARNESS + '\narchive_backend_dist "$PWD"\n', backend)
    check(proc.returncode == 0, f'case 1: archive failed\n{proc.stdout}{proc.stderr}')
    check(len(archives(backend)) == 1, f'case 1: expected one archive, got {archives(backend)}')

    # what `nest build` does before failing: delete dist, produce nothing
    subprocess.run(['rm', '-rf', str(backend / 'dist')], check=True)
    proc = run(HARNESS + '\nrestore_backend_dist "$PWD"\n', backend)
    check(proc.returncode == 0, f'case 1: restore reported failure\n{proc.stdout}{proc.stderr}')
    main_js = backend / 'dist' / 'main.js'
    check(main_js.exists() and main_js.read_text(encoding='utf-8') == 'good-build',
          'case 1: restored dist/main.js is missing or wrong')
    check((backend / 'dist' / 'assets' / 'app.js').exists(),
          'case 1: restore dropped the nested files')

    # --- case 2: nothing to restore ---------------------------------------
    empty = root / 'empty'
    empty.mkdir()
    proc = run(HARNESS + '\nrestore_backend_dist "$PWD"\n', empty)
    check(proc.returncode != 0, 'case 2: restore must fail when there is no archive')
    check(not (empty / 'dist').exists(), 'case 2: restore created a dist out of nowhere')

    # --- case 3: only the three newest archives are kept -------------------
    prune = root / 'prune'
    prune.mkdir()
    stored = prune / 'stored'
    stored.mkdir()
    for i, stamp in enumerate((100, 200, 300, 400)):
        (prune / f'backend.dist.{stamp}.tgz').write_text('old', encoding='utf-8')
        os.utime(prune / f'backend.dist.{stamp}.tgz', (stamp, stamp))
    make_dist(prune, 'fresh-build')
    proc = run(HARNESS + '\narchive_backend_dist "$PWD"\n', prune)
    check(proc.returncode == 0, f'case 3: archive failed\n{proc.stdout}{proc.stderr}')
    kept = archives(prune)
    check(len(kept) == 3, f'case 3: expected three archives after pruning, got {kept}')
    check('backend.dist.100.tgz' not in kept and 'backend.dist.200.tgz' not in kept,
          f'case 3: the oldest archives were not pruned: {kept}')

if failures:
    for failure in failures:
        print('FAIL:', failure, file=sys.stderr)
    sys.exit(1)

print('PASS: update.sh archives the backend build and restores it after a failed build')
