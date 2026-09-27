#!/usr/bin/env python3
"""Atomic SQL.GZ backup using DATABASE_URL, not possibly stale DB_* values.

No password in argv or cron. The temporary MySQL option file is mode 0600.
A failed dump never replaces a good backup and never runs retention.
"""
import argparse
import datetime
import gzip
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit, unquote
import uuid


def read_env(file):
    values = {}
    for line in Path(file).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(' #', 1)[0].rstrip()
        values[key.strip()] = value
    return values


def connection(env_file):
    # The installed file, not sudo's environment, defines the database to protect.
    url = urlsplit(read_env(env_file).get('DATABASE_URL', ''))
    name = unquote(url.path.lstrip('/'))
    if url.scheme != 'mysql' or not url.hostname or not url.username or not name or '/' in name:
        raise ValueError('A valid mysql DATABASE_URL is required in the selected .env')
    return {'host': url.hostname, 'port': str(url.port or 3306), 'user': unquote(url.username),
            'password': unquote(url.password or ''), 'database': name}


def option(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r') + '"'


def backup(env_file, output, reason='manual', keep_days=None):
    cfg = connection(env_file)
    dump = shutil.which('mariadb-dump') or shutil.which('mysqldump')
    if not dump:
        raise RuntimeError('Install mariadb-client (mariadb-dump or mysqldump is required)')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = output / f'vizitik-{reason}-{stamp}-{uuid.uuid4().hex[:8]}.sql.gz'
    temporary = str(target) + '.partial'
    try:
        with tempfile.TemporaryDirectory(prefix='vizitik-db-') as temp:
            auth = Path(temp) / 'client.cnf'
            auth.write_text('[client]\n' + '\n'.join(f'{k}={option(v)}' for k, v in cfg.items() if k != 'database') + '\n')
            auth.chmod(0o600)
            with open(Path(temp) / 'stderr', 'wb+') as errors:
                # --databases would add CREATE DATABASE/USE: intentionally omitted
                # so a recovery can first be rehearsed in an isolated database.
                cmd = [dump, f'--defaults-extra-file={auth}', '--protocol=tcp', '--single-transaction',
                       '--quick', '--hex-blob', '--default-character-set=utf8mb4', '--skip-lock-tables', '--', cfg['database']]
                with open(temporary, 'xb') as raw:
                    os.chmod(temporary, 0o600)
                    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errors)
                    try:
                        with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as archive:
                            shutil.copyfileobj(proc.stdout, archive)
                        proc.stdout.close()
                        rc = proc.wait()
                    except BaseException:
                        proc.kill()
                        proc.wait()
                        raise
                    if rc:
                        # Do not expose driver output that may contain credentials.
                        raise RuntimeError(f'Database dump failed (exit {rc}); backup NOT published')
                    raw.flush()
                    os.fsync(raw.fileno())
            size = 0
            with gzip.open(temporary, 'rb') as archive:
                for chunk in iter(lambda: archive.read(1024 * 1024), b''):
                    size += len(chunk)
            if size == 0:
                raise RuntimeError('Empty dump; backup NOT published')
            # Preserve login/configuration secrets along with each SQL backup.
            config_target = Path(str(target) + '.env')
            with open(config_target, 'xb') as config:
                os.chmod(config_target, 0o600)
                config.write(Path(env_file).read_bytes())
                config.flush()
                os.fsync(config.fileno())
            os.replace(temporary, target)
            directory_fd = os.open(output, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        # Prune ONLY successful nightly backups, never pre-update/pre-restore ones.
        if keep_days is not None and reason == 'nightly':
            cutoff = datetime.datetime.now().timestamp() - keep_days * 86400
            for old in output.glob('vizitik-nightly-*.sql.gz'):
                if old != target and old.stat().st_mtime < cutoff:
                    old.unlink()
                    Path(str(old) + '.env').unlink(missing_ok=True)
        return target
    finally:
        Path(temporary).unlink(missing_ok=True)
        if not target.exists():
            Path(str(target) + '.env').unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', required=True, help='backend/.env to protect')
    parser.add_argument('--output', required=True, help='private directory OUTSIDE the install tree')
    parser.add_argument('--reason', choices=['manual', 'nightly', 'pre-update', 'pre-install', 'pre-schema'], default='manual')
    parser.add_argument('--keep-days', type=int, default=14)
    args = parser.parse_args()
    if args.keep_days < 1:
        parser.error('--keep-days must be positive')
    try:
        print(backup(args.env, args.output, args.reason, args.keep_days))
    except Exception as error:
        parser.exit(1, f'Backup failed: {error}\n')


if __name__ == '__main__':
    main()
