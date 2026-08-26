import sys, time; sys.path.insert(0, "/tmp")
from obs import *
exec(open('/tmp/t6.py').read().split('with sync_playwright')[0])
with sync_playwright() as pw:
    b, page = connect(pw)
    print("queue:", custom_review(page, "e.notePath === 'Reading.md'"))
    print("slot:", slot(page)); activate_review(page)
    print("selection:", select_in_body(page, "quick", 34)); time.sleep(0.3)
    n0 = len(notices(page))
    print("extract ->", cmd(page, "incremental-reading:extract-selection")); time.sleep(2)
    print("notices:", notices(page)[n0:], "| slot:", slot(page)); print("marks:", marks(page)); shot(page, "33-reading-card-bold-extract")
    print("children:", page.evaluate("() => app.plugins.plugins['incremental-reading'].store.load().then(s => Array.from(s.elements.values()).filter(e => e.anchor && e.anchor.sourcePath==='Reading.md').map(e => ({q: e.anchor.quote.exact, pos: e.anchor.position})))"))
