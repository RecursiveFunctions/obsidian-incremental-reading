# Scope: remove the three modals (UI commitments #2 + #6)

Handoff for the next implementation pass. Read `docs/UI-COMMITMENTS.md`
first; the contract is what this work satisfies.

## What violates the contract right now

| Modal | Used by | Lines | Risk |
|---|---|---|---|
| `src/priority-modal.ts` (PriorityModal) | `set-ir-priority` command, file-menu entry, review-pane priority editor (already inline there) | ~65 | Low |
| `src/stats-modal.ts` (StatsModal) | `show-stats` command (Alt+S) | ~68 | Low |
| `src/review.ts` (ReviewModal) | `start-review` command (Alt+R) | ~750 | High; touches the whole review loop |

All three break commitment #2 (single review surface) and / or #6 (no
blocking popups). The fix in all three is the same shape: replace the
`Modal` subclass with an `ItemView` workspace leaf, or in PriorityModal's
case, an inline / status-bar prompt. Both `IrTreeView` (`src/tree-view.ts`)
and `IrSessionView` (`src/session-view.ts`) are good templates: study
those before starting.

## Recommended sequence

Do them in this order. Each is its own commit; release a 0.0.5 after all
three are in.

### Phase A: StatsModal -> IrStatsView (easiest, lowest risk)

`src/stats-modal.ts` is a one-shot async render of a five-row table; no
interaction beyond display. Move it verbatim into an `ItemView` that
mirrors `IrTreeView` / `IrSessionView`. No new pure module needed; the
`computeStats` core in `src/ir/stats.ts` is already pure and tested.

Steps:
1. Create `src/stats-view.ts` with `IR_STATS_VIEW_TYPE = "ir-stats-view"`
   and class `IrStatsView extends ItemView`. Constructor: `(leaf, store)`.
2. `getViewType / getDisplayText / getIcon` (icon: `bar-chart-3`).
3. `async onOpen() { await this.render(); }`. `render()` is the body of
   the current `StatsModal.onOpen`.
4. Add a "Refresh" button in the header (like `IrTreeView`).
5. In `main.ts`:
   - Import + `registerView(IR_STATS_VIEW_TYPE, leaf => new IrStatsView(...))`.
   - Add `detachLeavesOfType(IR_STATS_VIEW_TYPE)` to `onunload`.
   - Change the `show-stats` command's callback from
     `new StatsModal(...).open()` to `void this.openStatsView()`.
   - Implement `openStatsView()` by analogy with `openTreeView()` /
     `openSessionView()`.
6. Delete `src/stats-modal.ts`.
7. No CSS changes needed (existing `.ir-stats-table` rules carry over).

Acceptance: Alt+S opens the stats view in the right sidebar; reopening
reveals the existing leaf; closing the leaf and reopening re-renders fresh.

### Phase B: PriorityModal -> in-tree-view editor (decision required)

PriorityModal needs a non-modal replacement. Two viable shapes; pick one
before coding:

**Option B1: side-panel control in the tree view.**
The tree-view rows already show priority (`p<NN>`). Make the priority span
clickable; click swaps it for an inline `<input type=number>`; Enter or
blur commits via `setPriority`. The `set-ir-priority` command's behavior
becomes "reveal the tree view, scroll to and focus-edit the row for the
active file." Cleanest fit with commitment #6 ("inline / status bar /
side panel"); requires the tree view to be the priority-editing surface.
Best long-term home, more wiring.

**Option B2: status-bar transient input.**
The `set-ir-priority` hotkey expands the status bar's IR area into a small
input. Type number, Enter to commit, Esc to cancel. No new view; reuses
the status bar element from commitment #4. Simplest to ship; survives
across context (works whether tree view is open or not).

Recommendation: ship **B2** first as the universal answer, then add **B1**
incrementally because in-tree editing is a separate ergonomic win the
user will want anyway. They are not exclusive.

**Status (2026-05):** B2 (status-bar prompt) and **B1** (click `pNN` in the
element tree → inline numeric field, Enter/blur commit, Esc cancel) are
implemented. **Alt+P** opens (or reveals) the IR tree and auto-opens that
inline editor for the active note when it maps to a store element; otherwise
the status-bar prompt runs unchanged. The review leaf shows a **source column**
(parent note body or stored parent text) next to the card under review
(UI commitment #2 — single surface, no modal).

Steps for B2:
1. New file `src/priority-prompt.ts` (or extend `status-bar.ts`). Export
   a pure helper that, given current value, validates a candidate number
   and clamps it (priority helpers already exist in `src/ir/model.ts`).
2. Add a method on the plugin: `promptPriority(file: TFile, current: number)`.
   It hides the current status-bar text, inserts an `<input type=number>`,
   focuses it, binds Enter (commit) + Esc (cancel + restore text).
3. Replace both `new PriorityModal(...).open()` call sites in `main.ts`
   (command `set-ir-priority` + the file-menu handler) with calls into the
   new prompt.
4. Delete `src/priority-modal.ts`.
5. The in-review priority editor (`renderPriorityRow` in `src/review.ts`)
   already does NOT use PriorityModal; it has its own inline input. Leave
   it alone.

Acceptance: Alt+P on an IR note focuses a numeric input in the status
bar; type-N-Enter persists the priority; Esc cancels; status bar restores
its normal display.

### Phase C: ReviewModal -> IrReviewView (the big one)

This is the biggest UX payoff and the biggest refactor. `src/review.ts`
is ~750 lines of modal logic that needs to become an `ItemView`. **Do not
combine this with A or B in a single commit.** Ship A and B first; then
take C as a dedicated PR.

Plan the refactor as four sub-steps, committed separately so any one of
them can be reverted without losing the others:

**C1. Extract the pure helpers.**
Move `dueQueue`, `dueMsOf`, `scheduleToTopicState`, `topicStateToSchedule`
out of `review.ts` and into `src/ir/queue-adapter.ts` (or similar). They
already have no Obsidian dependency beyond `App`/`TFile` for the dueQueue
case; that one can stay near the view since it builds `ReviewSlot[]`.
This step is mostly mechanical and reduces the surface area of C2.

**C2. New `IrReviewView` in `src/review-view.ts`.**
- `extends ItemView` with `IR_REVIEW_VIEW_TYPE = "ir-review-view"`.
- Constructor parameters mirror the current `ReviewModal` constructor:
  `(leaf, plugin-as-Component, settings, store, queue, elementsById, onChange)`.
- Move the entire `onOpen` / `renderCard` / `grade` / `next` / `later` /
  `dismiss` / `handleExtract` / `handleCloze` body verbatim. The key
  changes from `Modal`:
  - Replace `this.modalEl.addClass(...)` with `this.containerEl.addClass(...)`.
  - Replace `this.scope.register([], "key", ...)` with
    `this.registerDomEvent(this.contentEl, "keydown", handler)`. The
    handler reads `evt.key`, branches on it, calls `evt.preventDefault()`.
    Be careful: `this.scope` worked because the modal grabbed focus; the
    view does not, so the contentEl needs `tabIndex = -1` and focus()
    inside onOpen so keys land. The Vim plugin should be untouched
    because keys are bound to the view's contentEl, not globally.
  - The textarea-typing guard (`isTypingInTextarea`) keeps working; reading
    cards default to **rendered** markdown (click body or **Edit** for the
    raw textarea). **Ctrl+Enter** advances a reading card while the textarea
    is focused.
  - `MarkdownRenderer.render` already takes a Component; pass `this`
    (ItemView extends Component) or pass the plugin as before.
  - `onClose()` should fire the `onChange?.()` callback (same as today's
    `onClose`) AND call `store.reconcile().catch(...)` (same).
- Source preview alongside (commitment #2 "source visible on the side"):
  in the same view, render the source note's body in a side pane within
  the leaf. Simplest is a CSS flex split inside `contentEl`: card on the
  left, source on the right. Use Obsidian's `MarkdownRenderer.render`
  again for the source. Skip this for the first commit if it complicates
  the keyboard wiring; add as a follow-up.

**C3. Wire the new view in `main.ts`.**
- `registerView(IR_REVIEW_VIEW_TYPE, leaf => new IrReviewView(...))` but
  with deferred queue / state: the view needs to be reconstructed each
  time a review starts (the queue changes). Two options:
  a) Make the view ephemeral: `startReview` detaches any existing review
     leaf, then opens a new one with a fresh queue.
  b) Add a `setSession(queue, elementsById)` method on the view that
     resets internal state. Cleaner; lets the leaf survive across runs.
  Go with (a) first. (b) is an optimization.
- `detachLeavesOfType(IR_REVIEW_VIEW_TYPE)` in `onunload`.
- `startReview()` replaces the `new ReviewModal(...).open()` call with
  the workspace-leaf path.

**C4. Delete ReviewModal.**
Once IrReviewView is working, delete the ReviewModal class and its
imports. Run `npm run build` and the full test suite.

## Per-phase acceptance checklist

For every phase, the PR template's UI commitment checklist must be checked
end-to-end. Specifically:

- [ ] No new modals introduced, except the [documented cloze-hint exception](UI-COMMITMENTS.md#6-no-popups-that-block-the-document) in UI commitment #6 (reversed 0.6.7: editor uses the inline hint bar).
- [ ] Existing keyboard shortcuts still work (Alt+X, Alt+Z in editor;
      in-review keys 1-4, Space, Enter, L, D, `[` Previous, Alt+X, Alt+Z).
- [ ] Status bar continues to refresh after grading / postponing /
      dismissing (`refreshStatusBar` callback wiring intact).
- [ ] Session log (Alt+L) continues to populate (event wiring intact).
- [ ] Tree view (Alt+I) and stats view still open.
- [ ] `npm run build` clean. `npm test` 202+ pass.
- [ ] Manual smoke test in a real vault: extract a selection, grade an
      item, postpone a topic, dismiss, change priority, open stats.

## Gotchas to remember

1. **Don't break the `recordElement` -> `refreshStatusBar` chain.** Every
   mutation path currently triggers a status-bar refresh; preserve that.
2. **`MarkdownRenderer.render` requires a live Component.** The view is a
   Component, but the Component the view passes to `MarkdownRenderer`
   must outlive the rendered markdown (or the markdown leaks event
   listeners).
3. **`processFrontMatter` writes vs `vault.modify` writes.** The review
   flow uses both: `processFrontMatter` for `ir-*` keys, `vault.modify`
   for the body (`saveBody` helper). The refactor must keep that
   separation; mixing them risks frontmatter loss.
4. **Vim compatibility (commitment #1).** Currently the review modal's
   keys are scope-bound (modal-only). When the view binds keys on
   `contentEl`, double-check that Vim's normal-mode keys still reach
   editors *outside* the review view.
5. **Cloze answer reveal.** The reveal mechanism uses a single boolean
   `this.revealed` plus a re-render. Preserve exactly.
6. **`onChange` callback firing.** The status-bar callback is fired in
   `onClose().finally(...)`. The view's equivalent is its own `onClose()`
   (ItemView lifecycle). Don't drop this.

## After: cut 0.0.5

Bump version. Build. Tag. `gh release create 0.0.5 main.js manifest.json
styles.css --title "0.0.5 — Modal removal, single review surface" ...`.
BRAT will pick it up. (Same dance as 0.0.3 and 0.0.4.)

Run `npm version patch` before tagging a release (or bump `manifest.json`,
`package.json`, and `versions.json` in lockstep); `version-bump.mjs` keeps
BRAT-facing metadata aligned with `package.json`.
