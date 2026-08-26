import sys, time; sys.path.insert(0, "/tmp")
from obs import *
with sync_playwright() as pw:
    b, page = connect(pw)
    # trust vault
    page.evaluate("""() => { const btn = Array.from(document.querySelectorAll('.modal button')).find(b => /trust/i.test(b.textContent)); if (btn) btn.click(); }""")
    time.sleep(2)
    print("plugin", plugin_state(page))
    open_file(page, "paper.pdf"); wait_pdf(page); time.sleep(1)
    print("mark topic ->", cmd(page, "incremental-reading:mark-as-ir-topic")); time.sleep(0.5)
    print("selected:", select_pdf(page, "Spaced repetition", 1)); time.sleep(0.3)
    print("extract ->", cmd(page, "incremental-reading:extract-selection")); time.sleep(2)
    print("notices", notices(page))
    print("marks", pdf_marks(page))
    shot(page, "10-pdf-single-extract")
    # persistence: open another note in a new tab, then come back
    open_file(page, "Reading.md", True); time.sleep(1.5)
    shot(page, "11-other-tab")
    page.evaluate("() => { const l = app.workspace.getLeavesOfType('pdf')[0]; app.workspace.setActiveLeaf(l, {focus:true}); }"); time.sleep(1.5)
    print("marks after tab switch", pdf_marks(page))
    shot(page, "12-pdf-back-persist")
