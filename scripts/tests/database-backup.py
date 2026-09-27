#!/usr/bin/env python3
"""SQL dump pipeline tests with a fake executable (no live DB required)."""
import gzip
import importlib.machinery
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'database-backup.py'
backup = importlib.machinery.SourceFileLoader('backup', str(MODULE)).load_module()


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / '.env'
        self.env.write_text('DATABASE_URL="mysql://test:p%40ss%23%25%27%5Cword@127.0.0.1:3307/actual_db"\nDB_NAME=wrong_db\nJWT_SECRET=kept\n')
        self.output = self.root / 'backups'
        self.binary = self.root / 'mariadb-dump'
        self.binary.write_text('''#!/usr/bin/env python3
import os, sys
from pathlib import Path
assert '--single-transaction' in sys.argv
assert '--hex-blob' in sys.argv
assert sys.argv[-1] == 'actual_db'
assert not any('p@ss' in a for a in sys.argv)
p = Path(sys.argv[1].split('=', 1)[1])
assert p.stat().st_mode & 0o777 == 0o600
assert 'port="3307"' in p.read_text()
print('-- real SQL would go here; فارسی')
sys.exit(int(os.environ.get('DUMP_EXIT', '0')))
''')
        self.binary.chmod(0o755)
        self.patch = patch.dict(os.environ, {'PATH': str(self.root) + ':' + os.environ['PATH']})
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_roundtrip_secret_modes_and_unique_names(self):
        first = backup.backup(self.env, self.output)
        second = backup.backup(self.env, self.output)
        self.assertNotEqual(first, second)
        self.assertIn('فارسی', gzip.open(first, 'rt').read())
        self.assertEqual(first.stat().st_mode & 0o777, 0o600)
        snapshot = Path(str(first) + '.env')
        self.assertEqual(snapshot.read_bytes(), self.env.read_bytes())
        self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)
        self.assertEqual(backup.connection(self.env)['password'], "p@ss#%'\\word")

    def test_failed_dump_never_publishes_or_prunes(self):
        first = backup.backup(self.env, self.output, 'nightly')
        os.utime(first, (1, 1))
        with patch.dict(os.environ, {'DUMP_EXIT': '2'}), self.assertRaises(RuntimeError):
            backup.backup(self.env, self.output, 'nightly', 1)
        self.assertTrue(first.exists())
        self.assertEqual(list(self.output.glob('*.partial')), [])
        self.assertEqual(len(list(self.output.glob('*.sql.gz'))), 1)

    def test_retention_only_after_success_and_only_nightly(self):
        old = backup.backup(self.env, self.output, 'nightly')
        safety = backup.backup(self.env, self.output, 'pre-update')
        for file in [old, safety]: os.utime(file, (1, 1))
        backup.backup(self.env, self.output, 'nightly', 1)
        self.assertFalse(old.exists())
        self.assertFalse(Path(str(old) + '.env').exists())
        self.assertTrue(safety.exists())

    def test_invalid_config_fails_without_output(self):
        self.env.write_text('DATABASE_URL=""\n')
        with self.assertRaises(ValueError): backup.backup(self.env, self.output)
        self.assertFalse(self.output.exists())


if __name__ == '__main__': unittest.main()
