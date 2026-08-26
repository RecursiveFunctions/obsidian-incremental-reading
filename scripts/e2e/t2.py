import sys, time; sys.path.insert(0, "/tmp")
from obs import *
def span_box(page, needle, pageno):
    return page.evaluate("""([needle, pageNo]) => {
      const p = document.querySelector(`.page[data-page-number="${pageNo}"]`);
      const s = Array.from(p.querySelectorAll('.textLayer span')).find(s => (s.textContent||'').includes(needle));
      if (!s) return null; s.scrollIntoView({block:'center'});
      const b = s.getBoundingClientRect(); return {x:b.left, y:b.top, w:b.width, h:b.height, text: s.textContent};
    }""", [needle, pageno])
def ctrl_drag(page, box):
    y = box['y'] + box['h']/2
    page.keyboard.down("Control")
    page.mouse.move(box['x']+2, y); page.mouse.down(); page.mouse.move(box['x']+box['w']*0.6, y, steps=8); page.mouse.move(box['x']+box['w']-2, y, steps=4); page.mouse.up()
    page.keyboard.up("Control")
with sync_playwright() as pw:
    b, page = connect(pw)
    page.evaluate("() => { const l = app.workspace.getLeavesOfType('pdf')[0]; app.workspace.setActiveLeaf(l, {focus:true}); }"); time.sleep(0.5)
    b1 = span_box(page, "Incremental reading is a method", 1); time.sleep(0.3); print("b1", b1 and b1['text'][:50])
    ctrl_drag(page, b1); time.sleep(0.8)
    print("notices A", notices(page)[-2:])
    b2 = span_box(page, "Forgetting curves", 2); time.sleep(0.6); print("b2", b2 and b2['text'][:50])
    ctrl_drag(page, b2); time.sleep(0.8)
    print("notices B", notices(page)[-2:])
    print("held state", pdf_marks(page))
    shot(page, "20-held-two-pages")
    print("extract ->", cmd(page, "incremental-reading:extract-selection")); time.sleep(2)
    print("notices C", notices(page)[-2:])
    print("marks after", pdf_marks(page))
    shot(page, "21-after-multi-extract-p2")
    span_box(page, "Incremental reading is a method", 1); time.sleep(0.8)
    shot(page, "22-after-multi-extract-p1")
    print(page.evaluate("() => { const p = app.plugins.plugins['incremental-reading']; return p.store.load().then(s => Array.from(s.elements.values()).filter(e=>e.type==='extract').map(e => ({text: e.text.slice(0,60), pdf: e.anchor && e.anchor.pdf}))) }"))
