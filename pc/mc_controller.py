"""
Tiny controller that lets your website start/stop a Minecraft server on this PC.

Setup:
  1. Put a long random password (12+ chars) in password.txt next to this file.
  2. Edit the CONFIG section below.
  3. Run:  python mc_controller.py      (use pythonw.exe for no console window)

Endpoints:
  GET  /status   -> {"status": "offline" | "starting" | "online" | "stopping"}   (public)
  POST /start    -> needs header  X-Password: <your password>
  POST /stop     -> needs header  X-Password: <your password>
"""
import hmac
import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ----------------------------- CONFIG -----------------------------
SERVER_DIR = r"C:\minecraft-server"  # folder that contains your server jar
START_CMD = ["java", "-Xms2G", "-Xmx4G", "-jar", "server.jar", "nogui"]
MC_PORT = 25565                       # the port your Minecraft server listens on
ALLOWED_ORIGIN = "https://mysticalpengu.github.io"
CONTROL_PORT = 8765                   # local port this controller listens on
# ------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    with open(os.path.join(HERE, "password.txt"), encoding="utf-8") as f:
        PASSWORD = f.read().strip()
except FileNotFoundError:
    sys.exit("Create password.txt next to this script first.")
if len(PASSWORD) < 12:
    sys.exit("password.txt needs a password of at least 12 characters.")

proc = None
stopping = False
lock = threading.Lock()
failed_attempts = []  # timestamps of recent wrong passwords


def is_running():
    return proc is not None and proc.poll() is None


def port_open():
    try:
        with socket.create_connection(("127.0.0.1", MC_PORT), timeout=0.5):
            return True
    except OSError:
        return False


def get_status():
    if is_running() and stopping:
        return "stopping"
    if port_open():
        return "online"
    if is_running():
        return "starting"
    return "offline"


def start_server():
    global proc, stopping
    with lock:
        if is_running() or port_open():
            return "server is already running"
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            START_CMD,
            cwd=SERVER_DIR,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=flags,
        )
        stopping = False
        return "starting the server, give it a minute"


def stop_server():
    global stopping
    with lock:
        if not is_running():
            return "server wasn't started by this controller (or is already off)"
        try:
            proc.stdin.write(b"stop\n")  # same as typing 'stop' in the console: saves the world
            proc.stdin.flush()
        except OSError:
            proc.terminate()
        stopping = True
        return "stopping the server (saving the world first)"


def check_password(headers):
    """Returns (ok, http_code, error_message)."""
    now = time.time()
    failed_attempts[:] = [t for t in failed_attempts if now - t < 300]
    if len(failed_attempts) >= 5:
        return False, 429, "too many wrong attempts, try again in a few minutes"
    given = headers.get("X-Password", "").encode()
    if hmac.compare_digest(given, PASSWORD.encode()):
        return True, 200, ""
    failed_attempts.append(now)
    time.sleep(1)  # slow down guessing
    return False, 401, "wrong password"


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "X-Password, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/status":
            self._json(200, {"status": get_status()})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/start", "/stop"):
            return self._json(404, {"error": "not found"})
        ok, code, err = check_password(self.headers)
        if not ok:
            return self._json(code, {"error": err})
        message = start_server() if self.path == "/start" else stop_server()
        self._json(200, {"message": message, "status": get_status()})

    def log_message(self, *args):
        pass  # keep the console quiet


if __name__ == "__main__":
    print(f"Controller listening on http://127.0.0.1:{CONTROL_PORT}")
    ThreadingHTTPServer(("127.0.0.1", CONTROL_PORT), Handler).serve_forever()
