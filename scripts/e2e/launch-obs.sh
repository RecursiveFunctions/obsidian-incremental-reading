#!/bin/bash
# Launch Obsidian on a disposable vault.
#   launch-obs.sh [vault] [user-data-dir] [cdp-port]
# Defaults match the synthetic e2e vault; the real-vault copy passes
# its own user-data-dir and port so the two runs can coexist.
V=${1:-/tmp/ir-vault}
UD=${2:-/tmp/obs-ud}
PORT=${3:-9333}

# Check the :99 socket, not "any Xvfb": other tools park their own Xvfb on
# a different display and would make a bare pgrep pass while :99 is dead.
[ -e /tmp/.X11-unix/X99 ] || { nohup Xvfb :99 -ac -screen 0 1600x1000x24 >/tmp/xvfb.log 2>&1 & sleep 3; }
mkdir -p "$UD" /tmp/shots
python3 - "$V" "$UD" <<'PY'
import hashlib, json, sys, time
vault, ud = sys.argv[1], sys.argv[2]
vid = hashlib.md5(vault.encode()).hexdigest()[:16]
json.dump({"vaults": {vid: {"path": vault, "ts": int(time.time() * 1000), "open": True}}},
          open(ud + "/obsidian.json", "w"))
PY
unset XAUTHORITY; export DISPLAY=:99 XDG_SESSION_TYPE=x11
nohup /opt/Obsidian/obsidian.real --ozone-platform=x11 --no-sandbox --disable-gpu \
  --user-data-dir="$UD" --remote-debugging-port="$PORT" >/tmp/obs.log 2>&1 &
echo "launched $V on port $PORT"
