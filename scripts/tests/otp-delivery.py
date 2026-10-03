#!/usr/bin/env python3
"""OTP delivery must not lie.

Bale answers a refused message with HTTP 200 and ``ok: false`` (for example
"bot was blocked by the user" or "chat not found"), and a wrong token with 401.
The old code looked at neither: it returned "delivered" for every answer, so the
app told the visitor "کد در گفتگوی بله ارسال شد" while nothing arrived and the
server log stayed silent.

This test stands a fake Bale API on 127.0.0.1 and calls the *compiled* services
(BALE_API_BASE points at it), asserting:

  * a real delivery (ok:true)            -> true
  * 401 Unauthorized                     -> false
  * 200 with ok:false ("chat not found") -> false
  * 403, as Bale sends for a blocked bot -> false
  * a 502 HTML page instead of json      -> false
  * no BALE_BOT_TOKEN                    -> false
  * no known chat for the phone          -> false

and that BaleService.sendMessage surfaces the same rejections instead of
returning a body nobody inspects.

Needs `backend/dist` (npm run build in backend/) and node; skips cleanly if not.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DIST_AUTH = BACKEND / "dist" / "auth" / "auth.service.js"
DIST_BALE = BACKEND / "dist" / "bale" / "bale.service.js"

if shutil.which("node") is None or not DIST_AUTH.exists() or not DIST_BALE.exists():
    print("SKIP: needs node and a built backend (cd backend && npm run build)")
    sys.exit(0)

MODE = {"value": "ok"}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 - http.server API
        mode = MODE["value"]
        if mode == "html":
            self.send_response(502)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html>bad gateway</html>")
            return
        if mode == "401":
            body, code = {"ok": False, "error_code": 401, "description": "Unauthorized"}, 401
        elif mode == "chat-not-found":
            body, code = {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"}, 200
        elif mode == "blocked":
            body, code = {"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user"}, 200
        else:
            body, code = {"ok": True, "result": {"message_id": 7}}, 200
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):  # keep the output clean
        pass


HARNESS = r"""
const [which, modeFlag] = process.argv.slice(1); // with node -e the extra args start at argv[1]
process.env.BALE_BOT_TOKEN = modeFlag === 'no-token' ? '' : '111111:TESTTOKEN';
if (modeFlag === 'no-chat') delete process.env.BALE_TOKEN_STUB;
const out = (v) => process.stdout.write('RESULT:' + JSON.stringify(v) + '\n');
(async () => {
  if (which === 'auth') {
    const { AuthService } = require('%AUTH%');
    const svc = new AuthService({}, {}, {});
    const chat = modeFlag === 'no-chat' ? null : '55667788';
    out({ delivered: await svc.dispatchBaleMessage('09120000000', '12345', 'ثبت‌نام ویزیتور جدید', chat) });
  } else {
    const { BaleService } = require('%BALE%');
    const svc = new BaleService({}, {});
    const res = await svc.sendMessage('55667788', 'test');
    out({ ok: res?.ok ?? null, description: res?.description ?? null });
  }
})().catch((e) => { out({ threw: String(e && e.message) }); });
""".replace("%AUTH%", str(DIST_AUTH)).replace("%BALE%", str(DIST_BALE))

failures = []


def run_node(which, mode="normal"):
    env = dict(os.environ)
    env["BALE_API_BASE"] = f"http://127.0.0.1:{PORT}"
    env["NODE_ENV"] = "test"
    p = subprocess.run(
        ["node", "-e", HARNESS, which, mode],
        capture_output=True, text=True, timeout=60, env=env, cwd=str(BACKEND),
    )
    if p.returncode != 0:
        return {"threw": (p.stderr or "").strip().splitlines()[-1:] or ["node failed"]}
    for line in reversed((p.stdout or "").splitlines()):
        if line.startswith("RESULT:"):
            return json.loads(line[len("RESULT:"):])
    return {"threw": (p.stdout or p.stderr or "").strip()[-200:]}


def check(label, got, expected, detail=""):
    if got != expected:
        failures.append(f"{label}: expected {expected!r}, got {got!r} {detail}")


server = HTTPServer(("127.0.0.1", 0), Handler)
PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

# --- AuthService.dispatchBaleMessage: the visitor-facing answer must be the truth
MODE["value"] = "ok"
check("auth/ok", run_node("auth").get("delivered"), True)
for mode, label in [("401", "auth/401"), ("chat-not-found", "auth/chat-not-found"), ("blocked", "auth/blocked"), ("html", "auth/502-html")]:
    MODE["value"] = mode
    check(label, run_node("auth").get("delivered"), False)
MODE["value"] = "ok"
check("auth/no-token", run_node("auth", "no-token").get("delivered"), False)
check("auth/no-known-chat", run_node("auth", "no-chat").get("delivered"), False)

# --- BaleService.sendMessage: the caller must be able to see the rejection
MODE["value"] = "ok"
check("bale/ok", run_node("bale").get("ok"), True)
MODE["value"] = "blocked"
check("bale/blocked-ok-flag", run_node("bale").get("ok"), False)
MODE["value"] = "401"
check("bale/401-ok-flag", run_node("bale").get("ok"), False)

server.shutdown()

if failures:
    print("FAIL: OTP delivery can report success without delivering")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("PASS: a refused Bale message is reported as not delivered (401 / ok:false / blocked / 502 / no token / unknown chat)")
