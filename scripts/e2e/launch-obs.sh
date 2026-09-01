#!/bin/bash
# Check the :99 socket, not "any Xvfb": other tools park their own Xvfb on
# a different display and would make a bare pgrep pass while :99 is dead.
[ -e /tmp/.X11-unix/X99 ] || { nohup Xvfb :99 -ac -screen 0 1600x1000x24 >/tmp/xvfb.log 2>&1 & sleep 3; }
mkdir -p /tmp/obs-ud /tmp/shots
python3 - <<'PY'
import json,time
json.dump({"vaults":{"abcdef0123456789":{"path":"/tmp/ir-vault","ts":int(time.time()*1000),"open":True}}}, open("/tmp/obs-ud/obsidian.json","w"))
PY
unset XAUTHORITY; export DISPLAY=:99 XDG_SESSION_TYPE=x11
nohup /opt/Obsidian/obsidian.real --ozone-platform=x11 --no-sandbox --disable-gpu \
  --user-data-dir=/tmp/obs-ud --remote-debugging-port=9333 >/tmp/obs.log 2>&1 &
echo launched
