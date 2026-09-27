#!/usr/bin/env python3
"""Regression guards for the exact destructive reinstall paths reported by user."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / 'setup-server.sh').read_text()


def function(name):
    match = re.search(rf'^{name}\(\) \{{.*?^\}}', SOURCE, re.M | re.S)
    assert match, name
    return match.group()


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.live = self.root / 'live'
        (self.live / 'backend').mkdir(parents=True)
        self.env_file = self.live / 'backend/.env'
        self.env_file.write_text('DATABASE_URL="mysql://original:secret@host/original_db"\nJWT_SECRET="original-jwt"\nCUSTOM_SETTING=keep-me\n')
        self.env = {**os.environ, 'INSTALL_DIR': str(self.live), 'SCRIPT_DIR': str(self.root),
                    'LOG': str(self.root / 'commands'), 'DB_HOST': 'localhost', 'DB_NAME': 'vizitik_db',
                    'DB_USER': 'vizitik', 'DB_PASS': 'not-the-live-password', 'BALE_BOT_TOKEN': ''}
        self.header = '''set -euo pipefail
log() { :; }; ok() { :; }; warn() { :; }; fail() { echo "$*" >&2; exit 1; }
systemctl() { echo "systemctl $*" >> "$LOG"; }
python3() { echo "backup $*" >> "$LOG"; }
mysql() { echo "mysql $*" >> "$LOG"; echo 13; }
'''

    def run_script(self, text):
        return subprocess.run(['bash', '-c', self.header + text], env=self.env, capture_output=True, text=True)

    def test_reinstall_only_backs_up_and_never_imports_or_alters_database(self):
        before = self.env_file.read_bytes()
        proc = self.run_script(function('setup_database') + '\nsetup_database\n')
        self.assertEqual(proc.returncode, 0, proc.stderr)
        log = (self.root / 'commands').read_text()
        self.assertIn('--reason pre-install', log)
        self.assertNotIn('mysql ', log)
        self.assertEqual(self.env_file.read_bytes(), before)

    def test_failed_backup_stops_reinstall(self):
        proc = self.run_script('python3() { return 9; }\n' + function('setup_database') + '\nsetup_database\necho UNSAFE_CONTINUATION\n')
        self.assertEqual(proc.returncode, 9)
        self.assertNotIn('UNSAFE_CONTINUATION', proc.stdout)

    def test_missing_env_with_populated_database_refuses_install(self):
        self.env_file.unlink()
        proc = self.run_script(function('setup_database') + '\nsetup_database\n')
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('Restore the original .env', proc.stderr)
        self.assertNotIn('CREATE', (self.root / 'commands').read_text())

    def test_backend_rebuild_preserves_all_existing_env_bytes(self):
        before = self.env_file.read_bytes()
        mocks = '''
npm_install_in() { :; }; run_here() { :; }; urlencode() { echo encoded; }
env() { :; }
'''
        proc = self.run_script(mocks + function('build_backend') + '\nbuild_backend\n')
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.env_file.read_bytes(), before)
        self.assertEqual(self.env_file.stat().st_mode & 0o777, 0o600)

    def test_source_copy_has_no_destructive_delete_and_excludes_secrets(self):
        copy = function('copy_source')
        self.assertNotIn('rm -rf', '\n'.join(line for line in copy.splitlines() if not line.strip().startswith('#')))
        self.assertNotIn('--delete ', copy)
        self.assertIn("--exclude='.env'", copy)
        self.assertIn("--exclude='.env.*'", copy)
        self.assertNotIn('hesabchin.sql', function('setup_database'))
        self.assertNotIn('--accept-data-loss', function('build_backend'))
        self.assertNotIn('--force-reset', function('build_backend'))


if __name__ == '__main__': unittest.main()
