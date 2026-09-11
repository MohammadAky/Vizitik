#!/usr/bin/env python3
"""Exercise change classification without touching services or a live install."""
import pathlib, subprocess, tempfile
script = pathlib.Path(__file__).resolve().parents[1] / 'update.sh'
with tempfile.TemporaryDirectory() as d:
    root = pathlib.Path(d)
    def git(*args):
        return subprocess.check_output(['git', '-C', d, *args], text=True).strip()
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
    def commit(path):
        f = root / path; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(path)
        git('add', '.'); git('commit', '-qm', path)
        return git('rev-parse', 'HEAD')
    baseline = commit('backend/base')
    commit('admin/index.html'); commit('landing/index.html')
    code = script.read_text().rsplit('main "$@"', 1)[0]
    for mode in (0, 1):
        probe = code + f'''\nDEPLOYED_REV={baseline}
DO_PULL={mode}
PREV=$(git_at rev-parse HEAD); NOW=$PREV
classify_changes
[[ " $CHANGED " == *" admin "* && " $CHANGED " == *" landing "* && "$DO_BACKEND" == 0 ]]
'''
        subprocess.run(['bash', '-c', probe, 'test', '--check'], env={**__import__('os').environ, 'SRC_DIR': d, 'INSTALL_DIR': d}, check=True)
print('PASS: manual pull and unchanged checkout retain all undeployed changes')
