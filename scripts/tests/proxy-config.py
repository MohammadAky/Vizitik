#!/usr/bin/env python3
import importlib.machinery
from pathlib import Path
import unittest
module = importlib.machinery.SourceFileLoader('proxy', str(Path(__file__).resolve().parents[1] / 'configure-backup-proxy.py')).load_module()

class ProxyTests(unittest.TestCase):
    def test_changes_only_admin_and_is_idempotent(self):
        old = '''server {
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/example/fullchain.pem;
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_read_timeout 60s;
    }
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_read_timeout 60s;
    }
}'''
        new = module.configure(old, 3001)
        self.assertIn('client_max_body_size 50m;', new)
        self.assertEqual(new.count('client_max_body_size'), 1)
        self.assertEqual(new.count('proxy_read_timeout 60s'), 1)
        self.assertEqual(new.count('proxy_read_timeout 180s'), 1)
        self.assertIn('ssl_certificate /etc/letsencrypt/live/example/fullchain.pem;', new)
        self.assertEqual(module.configure(new, 3001), new)

    def test_unknown_layout_refused(self):
        with self.assertRaises(ValueError): module.configure('server { location / { proxy_pass http://custom; } }', 3001)

if __name__ == '__main__': unittest.main()
