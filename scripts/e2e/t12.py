"""Source-gone answers must stick across reloads and across devices.

  * Single device: answer "Keep without notes" once, reload twice, no
    second "Source note is gone" prompt.
  * Two devices: another device tombstoned Reading.md, this device still
    has a stale copy. Load must not offer a re-link or write
    source-restored, which would erase the other device's answer and make
    it prompt again on its next load (fixed in 0.8.1).

  ./scripts/e2e/make-vault.sh && ./scripts/e2e/launch-obs.sh && python3 scripts/e2e/t12.py
"""
import sys, time, json, os, glob, shutil
sys.path.insert(0, os.path.dirname(__file__))
from obs import *

V = "/tmp/ir-vault"
OTHER = "dev_e2eother"
NOW = int(time.time() * 1000)

def el(id, type, notePath=None, anchorPath=None, parent=None):
    e = {"id": id, "type": type, "priority": 50, "parentId": parent,
         "dismissed": False, "created": NOW, "text": "Alpha paragraph",
         "anchorState": "ok"}
    if notePath: e["notePath"] = notePath
    if anchorPath:
        e["anchor"] = {"sourcePath": anchorPath,
                       "quote": {"exact": "Alpha paragraph", "prefix": "", "suffix": ""}}
    return e

def ev(i, kind, target, payload):
    return {"id": f"ev_e2e_{i}", "ts": NOW, "lamport": i, "device": OTHER,
            "kind": kind, "target": target, "payload": payload}

def seed(events):
    shutil.rmtree(f"{V}/.ir", ignore_errors=True)
    os.makedirs(f"{V}/.ir/log")
    with open(f"{V}/.ir/log/{OTHER}.jsonl", "w") as f:
        for e in events: f.write(json.dumps(e) + "\n")

def reload(page):
    page.evaluate("() => app.plugins.disablePlugin('incremental-reading')"); time.sleep(1)
    page.evaluate("() => app.plugins.enablePlugin('incremental-reading')"); time.sleep(4)

def modal_titles(page):
    return page.evaluate("() => Array.from(document.querySelectorAll('.modal .modal-title')).map(t => t.textContent)")

def all_events():
    out = []
    for p in glob.glob(f"{V}/.ir/log/*.jsonl"):
        out += [json.loads(l) for l in open(p) if l.strip()]
    return out

def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    return ok

with sync_playwright() as pw:
    b, page = connect(pw)
    page.evaluate("""() => { const btn = Array.from(document.querySelectorAll('.modal button')).find(b => /trust/i.test(b.textContent)); if (btn) btn.click(); }""")
    print("plugin", plugin_state(page))
    ok = True

    # 1. single device: answer once, never asked again
    page.evaluate("() => app.plugins.disablePlugin('incremental-reading')"); time.sleep(1)
    seed([
        ev(1, "element-created", "el_src", {"element": el("el_src", "topic", notePath="Gone.md")}),
        ev(2, "element-created", "el_ex", {"element": el("el_ex", "extract", anchorPath="Gone.md", parent="el_src")}),
    ])
    page.evaluate("() => app.plugins.enablePlugin('incremental-reading')"); time.sleep(4)
    t = modal_titles(page)
    ok &= check("first load prompts", "Source note is gone" in t, t)
    click_button(page, "Keep without notes"); time.sleep(1)
    for i in range(2):
        reload(page)
        t = modal_titles(page)
        ok &= check(f"reload {i+1}: no re-prompt", "Source note is gone" not in t, t)
        dismiss_modals(page)

    # 2. two devices: foreign tombstone + stale local copy
    page.evaluate("() => app.plugins.disablePlugin('incremental-reading')"); time.sleep(1)
    seed([
        ev(1, "element-created", "el_ex2", {"element": el("el_ex2", "extract", anchorPath="Reading.md")}),
        ev(2, "source-tombstoned", "el_ex2", {"tombstone": {"path": "Reading.md", "title": "Reading", "deletedAt": NOW}}),
    ])
    page.evaluate("() => app.plugins.enablePlugin('incremental-reading')"); time.sleep(4)
    t = modal_titles(page)
    ok &= check("foreign tombstone: no load-time modal", len(t) == 0, t)
    dismiss_modals(page); time.sleep(1)
    restored = [e for e in all_events() if e["kind"] == "source-restored"]
    ok &= check("foreign tombstone kept", not restored, restored)

    # 3. a note that really comes back while open still offers re-link
    page.evaluate("() => app.plugins.disablePlugin('incremental-reading')"); time.sleep(1)
    seed([
        ev(1, "element-created", "el_ex3", {"element": el("el_ex3", "extract", anchorPath="Back.md")}),
        ev(2, "source-tombstoned", "el_ex3", {"tombstone": {"path": "Back.md", "title": "Back", "deletedAt": NOW}}),
    ])
    page.evaluate("() => app.plugins.enablePlugin('incremental-reading')"); time.sleep(4)
    dismiss_modals(page); time.sleep(0.5)
    page.evaluate("() => app.vault.create('Back.md', 'Alpha paragraph is back.')"); time.sleep(2)
    t = modal_titles(page)
    ok &= check("live restore offers re-link", "Re-link Incremental Reading source?" in t, t)
    click_button(page, "Re-link"); dismiss_modals(page); time.sleep(0.5)
    page.evaluate("() => app.vault.delete(app.vault.getAbstractFileByPath('Back.md'))"); time.sleep(2)
    dismiss_modals(page)

    print("ALL PASS" if ok else "SOME FAILED")
