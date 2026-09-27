#!/usr/bin/env python3
"""Run the actual updater with isolated source/install dirs and fake OS commands.
No system services, production database, or checkout are modified. The updater
never touches a database and never requires a dump tool.
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
            # 'frontend' is the legacy PHP site: it is served straight from the checkout
            for tree in ['backend', 'frontend-app', 'admin', 'landing', 'scripts', 'frontend']:
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
                    'PATH': str(self.bin) + ':' + os.environ['PATH'],
                    'LOG': str(self.root / 'commands'), 'FAIL': ''}
        tools = {
            'id': 'echo 0',
            'flock': 'exit 0',  # parallel test runners do not share the deploy lock
            'npm': 'echo "npm $PWD $*" >> "$LOG"; [[ "$FAIL" == build ]] && exit 1; if [[ "$*" == *build* ]]; then mkdir -p dist; : > dist/main.js; fi; exit 0',
            'npx': 'echo "npx $*" >> "$LOG"; [[ "$FAIL" != schema || "$*" != *"db push"* ]]',
            'systemctl': 'echo "systemctl $*" >> "$LOG"; exit 0',
            'curl': '[[ "$FAIL" != health ]] && echo \'{"db":"ok","ok":true}\'',
            'sleep': ':',
        }
        for name, body in tools.items():
            file = self.bin / name
            file.write_text('#!/usr/bin/env bash\n' + body + '\n')
            file.chmod(0o755)
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

    def test_schema_failure_is_fatal_before_activation(self):
        proc = self.run_update('schema')
        self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_original()
        self.assertNotIn('systemctl stop', (self.root / 'commands').read_text())

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

    def test_php_only_change_installs_nothing_and_keeps_services_running(self):
        # The legacy PHP site is served straight from the checkout, so a change
        # under frontend/ must never be staged as a tree nor restart the API.
        first = self.run_update()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        (self.src / 'frontend' / 'index.php').write_text('<?php echo 2;\n', encoding='utf-8')
        git(self.src, 'add', '-A')
        git(self.src, 'commit', '-qm', 'legacy site change')
        before = (self.root / 'commands').read_text()
        proc = self.run_update()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        after = (self.root / 'commands').read_text()[len(before):]
        self.assertIn('changed: php', proc.stdout)
        self.assertIn('nothing to swap in', proc.stdout)
        self.assertNotIn('systemctl stop', after)
        self.assertNotIn('staging: php', proc.stdout)
        self.assertEqual((self.live / '.vizitik-revision').read_text().strip(), git(self.src, 'rev-parse', 'HEAD'))

    def test_restart_only_touches_no_file(self):
        proc = self.run_update(args=['--restart-only'])
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_original()
        log = (self.root / 'commands').read_text()
        self.assertIn('systemctl restart vizitik-backend', log)
        self.assertNotIn('npm ', log)

    def test_stale_recorded_revision_rebuilds_every_tree_without_a_php_tree(self):
        # A recorded revision from the pre-rewrite history is not in the checkout:
        # the updater falls back to a full rebuild. That is the run that died with
        # "cd: .../php: No such file or directory" on the live server.
        (self.live / '.vizitik-revision').write_text('deadbeef' * 5 + '\n', encoding='utf-8')
        proc = self.run_update()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn('rebuilding every tree', proc.stdout)
        self.assertIn('changed: backend schema frontend admin landing scripts php', proc.stdout)
        self.assertFalse((self.live / 'php').exists(), 'the legacy site must never be installed as a tree')
        self.assertEqual((self.live / 'backend/marker').read_text(), 'new')
        self.assertEqual((self.live / 'frontend/marker').read_text(), 'old')

    def test_quiet_no_op_is_loud_and_never_reports_a_deploy(self):
        # an install already at the checkout revision must say so instead of
        # silently doing nothing (the bug this updater replaced).
        first = self.run_update()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        before = (self.root / 'commands').read_text()
        second = self.run_update()
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertIn('nothing to do', second.stdout)
        self.assertIn('already at', second.stdout)
        self.assertNotIn('systemctl stop', (self.root / 'commands').read_text()[len(before):])


if __name__ == '__main__': unittest.main()
