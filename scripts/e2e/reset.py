import sys, time, shutil; sys.path.insert(0, "/tmp")
from obs import *
def reset_store(page):
    page.evaluate("() => app.plugins.disablePlugin('incremental-reading')"); time.sleep(1)
    shutil.rmtree('/tmp/ir-vault/.ir', ignore_errors=True)
    page.evaluate("() => app.plugins.enablePlugin('incremental-reading')"); time.sleep(3)
def pdf_topic_and_extract(page):
    page.evaluate("() => app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('pdf')[0], {focus:true})"); time.sleep(0.5)
    page.evaluate("() => document.querySelector('.page[data-page-number=\"1\"]').scrollIntoView()"); wait_pdf(page); time.sleep(0.5)
    cmd(page, "incremental-reading:mark-as-ir-topic"); time.sleep(0.5)
    select_pdf(page, "Spaced repetition", 1); time.sleep(0.3)
    cmd(page, "incremental-reading:extract-selection"); time.sleep(1.5)
