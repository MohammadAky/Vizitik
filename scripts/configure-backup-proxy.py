#!/usr/bin/env python3
"""Upgrade only the admin proxy location in Vizitik's existing Nginx vhost.
TLS/server names and unrelated locations are left untouched. Caller must keep a
copy and run nginx -t before reloading. Unknown custom layouts fail closed.
"""
import argparse
from pathlib import Path
import re


def configure(text, port):
    count = 0

    def replace(match):
        nonlocal count
        block = match.group()
        if not re.search(r'proxy_pass\s+http://127\.0\.0\.1:' + str(port) + r'\s*;', block):
            return block
        count += 1
        for directive, value in [('client_max_body_size', '50m'), ('proxy_read_timeout', '180s')]:
            pattern = r'(?m)^[ \t]*' + directive + r'[ \t]+[^;\n]+;'
            if re.search(pattern, block):
                block = re.sub(pattern, '        ' + directive + ' ' + value + ';', block)
            else:
                block = block[:-1] + f'    {directive} {value};\n    }}'
        return block

    result = re.sub(r'location\s+[^{}]+\{[^{}]*\}', replace, text)
    if not count:
        raise ValueError('Admin proxy location not recognized; configure client_max_body_size 50m and proxy_read_timeout 180s manually')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    parser.add_argument('port', type=int)
    args = parser.parse_args()
    args.config.write_text(configure(args.config.read_text(), args.port))
