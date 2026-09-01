"""Extract fidelity + highlights in the IR review card and reading view.

Two bugs this pins down (both fixed in 0.7.5):
  * `offsetAtBoundary` counted text-node lengths while `renderedPlainText`
    also inserts a newline per block / `<br>`, so every mapped selection
    drifted one char per boundary: the extract stored a shifted span.
  * The DOM painter only ever tried the whole extract as one needle, so a
    list or multi-span extract (whose stored text carries `- ` chrome or a
    blank-line join that no rendered block contains) painted nothing.

  ./scripts/e2e/make-vault.sh && ./scripts/e2e/launch-obs.sh && python3 scripts/e2e/t11.py
"""
import sys, time, shutil, os, glob; sys.path.insert(0, "/tmp")
from obs import *

CTRL_MOUSEUP = """() => {
  const body = document.querySelector('.ir-review-main-body');
  body.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, ctrlKey: true, button: 0}));
  return true;
}"""

def reset(page):
    """Drop the store AND the notes earlier cases created, so runs repeat."""
    page.evaluate("() => app.plugins.disablePlugin('incremental-reading')"); time.sleep(1)
    shutil.rmtree('/tmp/ir-vault/.ir', ignore_errors=True)
    for f in glob.glob('/tmp/ir-vault/*.md'):
        if os.path.basename(f) not in ("Reading.md", "Notes.md"):
            os.remove(f)
    page.evaluate("() => app.plugins.enablePlugin('incremental-reading')"); time.sleep(3)
    # Deleting the notes earlier cases made raises "Source note is gone".
    dismiss_modals(page); time.sleep(0.3)


def cloze_marks(page):
    return page.evaluate("() => Array.from(document.querySelectorAll('.ir-review-main-body mark.ir-cloze-source')).map(m => m.textContent)")


def cloze_hint_ok(page):
    return page.evaluate("""() => { const b = Array.from(document.querySelectorAll('.ir-hint-bar-btn')).find(b => b.textContent === 'OK'); if (!b) return 'no bar'; b.click(); return 'ok'; }""")

def fresh_card(page):
    reset(page)
    open_file(page, "Reading.md"); time.sleep(1)
    cmd(page, "incremental-reading:mark-as-ir-topic"); time.sleep(0.8)
    custom_review(page, "e.notePath === 'Reading.md'"); activate_review(page); time.sleep(0.5)

def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    return ok

def same_words(a, b):
    return a.replace("\n", " ").split() == b.replace("\n", " ").split()

with sync_playwright() as pw:
    b, page = connect(pw)
    page.evaluate("""() => { const btn = Array.from(document.querySelectorAll('.modal button')).find(b => /trust/i.test(b.textContent)); if (btn) btn.click(); }""")
    time.sleep(1)
    print("plugin", plugin_state(page))
    ok = True

    # 1. Inside one paragraph, across a soft line break.
    fresh_card(page)
    sel = select_across(page, "forgetting curve", "extract target")
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2)
    st = stored_extracts(page)
    ok &= check("soft-break extract stores the selected span", bool(st) and same_words(st[0], sel), repr(st))
    ok &= check("soft-break extract is highlighted", len(card_marks(page)) > 0)

    # 2. Across two paragraphs (the mapper's per-block drift).
    fresh_card(page)
    sel = select_across(page, "Gamma paragraph", "select across")
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2)
    st = stored_extracts(page)
    ok &= check("later-block extract stores the selected span", bool(st) and same_words(st[0], sel), repr(st))
    ok &= check("later-block extract is highlighted", len(card_marks(page)) > 0)

    # 3. Across two list items: stored text keeps the `- ` the DOM never shows.
    fresh_card(page)
    select_across(page, "first bullet", "priority slider")
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2)
    marks = card_marks(page)
    ok &= check("both list items are highlighted", len(marks) == 2, repr(marks))

    # 4. Ctrl multi-select: two spans, one extract, stored joined by a blank line.
    fresh_card(page)
    select_across(page, "Alpha paragraph", "curve in"); page.evaluate(CTRL_MOUSEUP); time.sleep(0.8)
    select_across(page, "Gamma paragraph", "third block"); page.evaluate(CTRL_MOUSEUP); time.sleep(0.8)
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2.5)
    marks = card_marks(page)
    ok &= check("both held spans are highlighted", len(marks) == 2, repr(marks))
    shot(page, "54-multispan-extract")

    # 5. Same note in reading view (MarkdownView preview, not the review card).
    reset(page)
    page.evaluate("""async () => {
      app.workspace.detachLeavesOfType('ir-review-view');
      const leaf = app.workspace.getLeaf('tab');
      await leaf.openFile(app.vault.getAbstractFileByPath('Reading.md'));
      await leaf.setViewState({...leaf.getViewState(), state: {...leaf.getViewState().state, mode: 'preview'}});
    }"""); time.sleep(1.5)
    cmd(page, "incremental-reading:mark-as-ir-topic"); time.sleep(1)
    sel = select_across(page, "Gamma paragraph", "select across", root=".markdown-preview-view")
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2.5)
    st = stored_extracts(page)
    ok &= check("reading-view extract stores the selected span", bool(st) and same_words(st[0], sel), repr(st))
    pv = page.evaluate("() => Array.from(app.workspace.activeLeaf.view.contentEl.querySelectorAll('mark.ir-extract-source')).map(m => m.textContent)")
    ok &= check("reading-view extract is highlighted", len(pv) > 0, repr(pv))
    shot(page, "55-reading-view-extract")

    # 6. Cloze on text that is also a link: the stored quote is the whole
    #    `[label](url)`, which no rendered text node contains.
    fresh_card(page)
    select_across(page, "the anchor", "anchor guide")
    cmd(page, "incremental-reading:cloze-selection"); time.sleep(1)
    cloze_hint_ok(page); time.sleep(2.5)
    cm = cloze_marks(page)
    ok &= check("cloze on link text is highlighted", cm == ["the anchor guide"], repr(cm))

    # 7. Cloze on a wikilink.
    fresh_card(page)
    select_across(page, "Notes", "Notes")
    cmd(page, "incremental-reading:cloze-selection"); time.sleep(1)
    cloze_hint_ok(page); time.sleep(2.5)
    cm = cloze_marks(page)
    ok &= check("cloze on a wikilink is highlighted", cm == ["Notes"], repr(cm))

    # 8. Extract across a link: used to fail to map at all, so nothing was
    #    created and nothing was painted.
    fresh_card(page)
    select_across(page, "Delta paragraph", "anchor guide")
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2)
    st = stored_extracts(page)
    ok &= check(
        "extract across a link is created with the link intact",
        bool(st) and st[0] == "Delta paragraph points at [the anchor guide](https://example.com/anchors)",
        repr(st),
    )
    ok &= check("extract across a link is highlighted", len(card_marks(page)) == 2, repr(card_marks(page)))
    # The "source note is gone" modal lands a beat after reset deletes the
    # notes earlier cases made; clear it so the shot shows the card.
    dismiss_modals(page); time.sleep(0.5)
    shot(page, "56-link-extract")

    # 9. A sentence that repeats in the note: the extract used to fail to map
    #    at all, and the painter marked whichever twin came first.
    fresh_card(page)
    sel = select_across(page, "the tuning knob", "in this note", nth=1)
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2)
    st = stored_extracts(page)
    ok &= check("repeated sentence extracts at all", bool(st) and same_words(st[0], sel), repr(st))
    marked = page.evaluate("""() => Array.from(document.querySelectorAll('.ir-review-main-body p')).filter(p => p.querySelector('mark.ir-extract-source')).map(p => (p.textContent||'').slice(0, 4))""")
    ok &= check("only the extracted twin is highlighted in the card", marked == ["Eta "], repr(marked))

    # 10. Same note in reading view: the post-processor runs per block, so it
    #     has to count occurrences inside the block it was handed.
    page.evaluate("""async () => {
      app.workspace.detachLeavesOfType('ir-review-view');
      const leaf = app.workspace.getLeaf('tab');
      await leaf.openFile(app.vault.getAbstractFileByPath('Reading.md'));
      await leaf.setViewState({...leaf.getViewState(), state: {...leaf.getViewState().state, mode: 'preview'}});
    }"""); time.sleep(2)
    marked = page.evaluate("""() => Array.from(app.workspace.activeLeaf.view.contentEl.querySelectorAll('p')).filter(p => p.querySelector('mark.ir-extract-source')).map(p => (p.textContent||'').slice(0, 4))""")
    ok &= check("only the extracted twin is highlighted in reading view", marked == ["Eta "], repr(marked))
    shot(page, "57-duplicate-phrase")

    # 11. A figure carries no text, so the painter flags the <img> itself.
    fresh_card(page)
    select_across(page, "Epsilon paragraph", "with its own text")
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2)
    imgs = page.evaluate("() => Array.from(document.querySelectorAll('.ir-review-main-body img')).map(i => i.className)")
    ok &= check("an embedded figure inside the extract is flagged", imgs == ["ir-extract-source ir-source-image"], repr(imgs))
    shot(page, "58-image-extract")

    # 12. Multi-span extract: every span is anchored, so the editor paints
    #     all of them, not just the first.
    fresh_card(page)
    select_across(page, "Alpha paragraph", "curve in"); page.evaluate(CTRL_MOUSEUP); time.sleep(0.8)
    select_across(page, "Gamma paragraph", "third block"); page.evaluate(CTRL_MOUSEUP); time.sleep(0.8)
    cmd(page, "incremental-reading:extract-selection"); time.sleep(2.5)
    spans = page.evaluate("() => app.plugins.plugins['incremental-reading'].store.load().then(s => Array.from(s.elements.values()).filter(e => e.type === 'extract').map(e => (e.anchor.spans || []).length))")
    ok &= check("both spans are anchored", spans == [2], repr(spans))
    page.evaluate("""async () => {
      app.workspace.detachLeavesOfType('ir-review-view');
      const leaf = app.workspace.getLeaf('tab');
      await leaf.openFile(app.vault.getAbstractFileByPath('Reading.md'));
      await leaf.setViewState({...leaf.getViewState(), state: {...leaf.getViewState().state, mode: 'source', source: false}});
    }"""); time.sleep(2.5)
    em = page.evaluate("() => Array.from(app.workspace.activeLeaf.view.contentEl.querySelectorAll('mark.ir-extract-source')).map(m => m.textContent.slice(0, 5))")
    ok &= check("the editor paints both spans", len(em) == 2, repr(em))
    shot(page, "59-editor-multispan")

    print("ALL PASS" if ok else "FAILURES ABOVE")
