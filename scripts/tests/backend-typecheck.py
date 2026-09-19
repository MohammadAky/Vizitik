#!/usr/bin/env python3
"""Type-level guard for the "Map<unknown, unknown>" build failure.

`new Map(x)` only gets its key/value types from the argument when the argument
is typed. If `x` is `any` (for example `client.product.findMany()` where
`client: PrismaService | any`, or a Prisma model that the client has no types
for yet), TypeScript infers `Map<unknown, unknown>`, `.get()` returns `unknown`,
and the build dies with:

    src/van-inventory/van-inventory.service.ts:136:11 - error TS2345:
    Argument of type 'unknown' is not assignable to parameter of type 'number'

This is exactly what broke `update.sh` on the server. The test compiles:

  1. the real van-inventory service - it must stay error free even when the
     Prisma client has no generated types (the state after a failed
     `prisma generate`);
  2. the naive pattern (typed map built from an `any` array) - it must produce
     an error, otherwise this guard would silently stop protecting anything.

Needs the backend devDependencies (typescript) installed; skips cleanly if not.
"""
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

backend = pathlib.Path(__file__).resolve().parents[2] / 'backend'
tsc = backend / 'node_modules' / '.bin' / 'tsc'
service = backend / 'src' / 'van-inventory' / 'van-inventory.service.ts'

failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


def compile_with_tsc(files, extra_args=()):
    proc = subprocess.run(
        [str(tsc), '--noEmit', '--target', 'ES2021', '--module', 'commonjs',
         '--moduleResolution', 'node', '--experimentalDecorators',
         '--emitDecoratorMetadata', '--esModuleInterop',
         '--allowSyntheticDefaultImports', '--skipLibCheck', '--strictNullChecks', 'false',
         '--noImplicitAny', 'false', *extra_args, *[str(f) for f in files]],
        cwd=str(backend), text=True, capture_output=True,
    )
    return proc.stdout + proc.stderr


if not tsc.exists() or not service.exists():
    print('SKIP: backend devDependencies (typescript) are not installed')
    sys.exit(0)

# --- case 1: the real service must compile ----------------------------------
out = compile_with_tsc([service])
errors = [line for line in out.splitlines() if re.search(r'error TS\d+', line)]
check(not errors, 'van-inventory.service.ts does not compile any more:\n  ' + '\n  '.join(errors[:10]))

# --- case 2: the naive pattern must still be rejected -----------------------
with tempfile.TemporaryDirectory() as tmp:
    naive = pathlib.Path(tmp) / 'naive-map.ts'
    naive.write_text(
        'declare const rows: any;\n'
        "const upcMap = new Map(rows.map((p: any) => [p.id, p.unitsPerCartonDefault || 24]));\n"
        'declare function normalizeStock(a: number, b: number, unitsPerCarton: number): void;\n'
        "normalizeStock(0, 0, upcMap.get('x') || 24);\n",
        encoding='utf-8',
    )
    out = compile_with_tsc([naive], extra_args=['--types', 'node'])
    check('error TS' in out,
          'the naive Map pattern compiled - the guard in this test is no longer meaningful')

if failures:
    for failure in failures:
        print('FAIL:', failure, file=sys.stderr)
    sys.exit(1)

print('PASS: the van-inventory carton-capacity lookup stays type-safe (and the naive Map pattern is still rejected)')
