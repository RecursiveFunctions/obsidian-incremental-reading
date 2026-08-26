import sys, time, json
from playwright.sync_api import sync_playwright

def connect(pw):
    b = pw.chromium.connect_over_cdp("http://127.0.0.1:9333")
    ctx = b.contexts[0]
    page = [p for p in ctx.pages if "Obsidian" in (p.title() or "") or p.url.startswith("app://")][0]
    return b, page

def shot(page, name):
    page.screenshot(path=f"/tmp/shots/{name}.png")
    print("shot", name)

def cmd(page, cid):
    return page.evaluate("id => app.commands.executeCommandById(id)", cid)

def notices(page):
    return page.evaluate("() => Array.from(document.querySelectorAll('.notice')).map(n => n.textContent)")

def dismiss_modals(page):
    page.evaluate("""() => { document.querySelectorAll('.modal-close-button').forEach(b => b.click()); }""")

JS_SELECT_PDF = """([needle, pageNo]) => {
  const page = document.querySelector(`.page[data-page-number="${pageNo}"]`);
  if (!page) return 'no page';
  const spans = Array.from(page.querySelectorAll('.textLayer span'));
  const hit = spans.find(s => (s.textContent||'').includes(needle));
  if (!hit) return 'no span: ' + spans.length;
  const r = document.createRange(); r.selectNodeContents(hit);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  return sel.toString();
}"""

def select_pdf(page, needle, pageno=1):
    return page.evaluate(JS_SELECT_PDF, [needle, pageno])

def pdf_marks(page):
    return page.evaluate("""() => Array.from(document.querySelectorAll('.page')).map(p => ({page: p.dataset.pageNumber, marks: p.querySelectorAll('.ir-pdf-mark').length, held: p.querySelectorAll('.ir-pdf-held-rect').length, spans: p.querySelectorAll('.textLayer span').length}))""")

def open_file(page, path, newtab=False):
    page.evaluate("([p, t]) => app.workspace.openLinkText(p, '', t ? 'tab' : false)", [path, newtab])

def wait_pdf(page, pageno=1, timeout=15000):
    page.wait_for_selector(f'.page[data-page-number="{pageno}"] .textLayer span', timeout=timeout)

def plugin_state(page):
    return page.evaluate("() => { const p = app.plugins.plugins['incremental-reading']; return p ? {ver: p.manifest.version} : null }")

def custom_review(page, js_filter):
    """Open a review leaf with a hand-picked queue. js_filter: JS predicate over element `e`."""
    return page.evaluate("""async (filt) => {
      app.workspace.detachLeavesOfType('ir-review-view');
      const p = app.plugins.plugins['incremental-reading']; const s = await p.store.load();
      const els = Array.from(s.elements.values()); const byId = new Map(els.map(e=>[e.id,e]));
      const pred = new Function('e', 'return (' + filt + ')');
      const pick = els.filter(pred);
      const file = (e) => { if (!e.notePath) return null; const f = app.vault.getAbstractFileByPath(e.notePath); return f || null; };
      p.irReviewSession = { queue: pick.map(e => ({id: e.id, element: e, file: file(e)})), elementsById: byId, isNeural: false, emptyVault: false };
      const leaf = app.workspace.getLeaf('tab'); await leaf.setViewState({type:'ir-review-view', active:true});
      await new Promise(r => setTimeout(r, 1500));
      return pick.map(e => e.notePath || e.text.slice(0,20));
    }""", js_filter)
