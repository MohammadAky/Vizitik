#!/usr/bin/env python3
"""Run the actual updater with isolated source/install dirs and fake OS commands.
No system services, production database, or checkout are modified.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'update.sh'


def git(cwd, *args):
    return subprocess.check_output(['git', '-C', str(cwd), *args], text=True).strip()


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.src = self.root / 'source'
        self.live = self.root / 'installed'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for root, text in [(self.src, 'new'), (self.live, 'old')]:
            for tree in ['backend', 'frontend-app', 'admin', 'landing', 'scripts']:
                (root / tree).mkdir(parents=True)
                (root / tree / 'marker').write_text(text)
            (root / 'admin/server.js').write_text(text)
        (self.src / 'backend/.env').write_text('DO_NOT_DEPLOY=source-secret')
        (self.live / 'backend/.env').write_text('DATABASE_URL="mysql://test:secret@127.0.0.1/test_db"\nJWT_SECRET=original\nPORT=3000\n')
        self.original_env = (self.live / 'backend/.env').read_bytes()
        git(self.src, 'init', '-q')
        git(self.src, 'config', 'user.name', 'Test')
        git(self.src, 'config', 'user.email', 'test@example.invalid')
        git(self.src, 'add', '.')
        git(self.src, 'commit', '-qm', 'fixture')
        self.env = {**os.environ, 'SRC_DIR': str(self.src), 'INSTALL_DIR': str(self.live),
                    'BACKUP_DIR': str(self.root / 'backups'), 'PATH': str(self.bin) + ':' + os.environ['PATH'],
                    'LOG': str(self.root / 'commands'), 'FAIL': ''}
        tools = {
            'id': 'echo 0',
            'flock': 'exit 0',  # parallel test runners do not share the deploy lock
            'npm': 'echo "npm $PWD $*" >> "$LOG"; [[ "$FAIL" != build ]]',
            'npx': 'echo "npx $*" >> "$LOG"; [[ "$FAIL" != schema || "$*" != *"db push"* ]]',
            'mariadb-dump': 'echo "dump" >> "$LOG"; echo "-- dump"; [[ "$FAIL" != backup ]]',
            'systemctl': 'echo "systemctl $*" >> "$LOG"; exit 0',
            'curl': '[[ "$FAIL" != health ]] && echo \'{"db":"ok","ok":true}\'',
            'sleep': ':',
        }
        for name, body in tools.items():
            file = self.bin / name
            file.write_text('#!/usr/bin/env bash\n' + body + '\n')
            file.chmod(0o755)
        rsync = self.bin / 'rsync'
        rsync.write_text('''#!/usr/bin/env python3
import shutil, sys
shutil.copytree(sys.argv[-2], sys.argv[-1], dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('node_modules', 'dist', '.env', '.env.*', '*.tgz'))
''')
        rsync.chmod(0o755)

    def run_update(self, fail='', args=()):
        return subprocess.run(['bash', str(SCRIPT), '--yes', '--no-pull', *args], env={**self.env, 'FAIL': fail}, text=True, capture_output=True)

    def assert_original(self):
        self.assertEqual((self.live / 'backend/.env').read_bytes(), self.original_env)
        self.assertEqual((self.live / 'backend/marker').read_text(), 'old')
        self.assertEqual((self.live / 'admin/server.js').read_text(), 'old')
        self.assertFalse((self.live / '.vizitik-revision').exists())

    def test_build_failure_leaves_live_install_and_services_untouched(self):
        proc = self.run_update('build')
        self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_original()
        self.assertNotIn('systemctl stop', (self.root / 'commands').read_text())

    def test_backup_failure_never_applies_schema(self):
        proc = self.run_update('backup')
        self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_original()
        self.assertNotIn('db push', (self.root / 'commands').read_text())

    def test_schema_failure_is_fatal_before_activation(self):
        proc = self.run_update('schema')
        self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_original()
        self.assertNotIn('systemctl stop', (self.root / 'commands').read_text())
        self.assertEqual(len(list((self.root / 'backups').glob('*.sql.gz'))), 1)

    def test_health_failure_rolls_back_files_dependencies_and_secrets(self):
        proc = self.run_update('health')
        self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_original()
        self.assertIn('restoring previous application files', proc.stderr)

    def test_success_preserves_env_and_records_revision_after_health(self):
        proc = self.run_update()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual((self.live / 'backend/.env').read_bytes(), self.original_env)
        self.assertEqual((self.live / 'backend/marker').read_text(), 'new')
        self.assertEqual((self.live / '.vizitik-revision').read_text().strip(), git(self.src, 'rev-parse', 'HEAD'))
        self.assertEqual((self.live / 'backend/admin/server.js').read_text(), 'new')
        self.assertEqual(list(self.live.glob('.update.*')), [])

    def test_partial_update_does_not_hide_pending_changes(self):
        proc = self.run_update(args=['--frontend-only'])
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_original()
        self.assertEqual((self.live / 'frontend-app/marker').read_text(), 'new')


if __name__ == '__main__': unittest.main()
