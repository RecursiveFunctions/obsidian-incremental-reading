# Scope: review-feel patch + mobile queue badge

Handoff for the next implementation pass, from the 2026-09-03 UX audit.
Read `docs/UI-COMMITMENTS.md` first; phases A-E close gaps against
commitments #3, #4, and #6, plus the loudest feedback holes in the
review loop.

Two releases:

- **Release 1 (phases A-E):** the "review-feel" patch. All small, all
  user-visible, one commit per phase.
- **Release 2 (phase F):** FAB due-count badge. Its own release because
  commitment #4 currently has NO mobile implementation and the change
  touches the FAB lifecycle, not the review loop.

Ship each release as a patch bump per the release policy (minor bumps
are reserved for user-verified features).

---

## Phase A: style the grade buttons

The classes already exist and were clearly meant to be styled:
`src/review-view.ts` emits `ir-review-grade-btn--again|hard|good|easy`
on both the mobile bar and the desktop bar (around lines 2075 and 2100),
and `grep grade styles.css` finds no rule for any of them. Again / Hard /
Good / Easy render as four identical grey buttons everywhere.

Steps:

1. In `styles.css`, add base rules for `.ir-review-grade-btn` and one
   rule per `--again/--hard/--good/--easy` modifier.
2. Obsidian CSS variables only (commitment #3, no hardcoded hex):
   `--color-red`, `--color-orange`, `--color-green`, `--color-cyan` (or
   `--color-blue`) are theme-provided. Keep it native: tint the label
   text and add a 2px bottom border in the grade color; do NOT do full
   colored fills, which fight themes.
3. Color must not be the only signal (existing labels + hotkey text in
   the button already satisfy this; don't remove them).
4. Check the mobile bar (`.ir-review--mobile .ir-review-buttons`,
   `styles.css:806+`) and landscape variant (`:977+`) still lay out.

Acceptance: the four grade buttons are visually distinct under default
light, default dark, and Minimal; `grep -E '#[0-9a-fA-F]{3,6}' styles.css`
gains no new hits in the added rules.

## Phase B: silent actions get feedback + undo

Two feedback holes and an undo hole in `src/review-view.ts`:

- `later()` (~line 3804) gives no feedback at all; the card just
  disappears.
- `dismiss()` (~line 3835) flashes only when a next card exists
  (`if (this.index + 1 < this.queue.length)`).
- Undo covers only grades (`commitUndoLastGrade`) and source deletion.
  Dismiss and Later today are irreversible in the UI even though both
  are cheap to reverse.

Steps:

1. `later()`: after the emit, `this.flash("Later today · N left")`
   mirroring the dismiss flash.
2. `dismiss()`: drop the has-next guard. On the last card the dock is
   replaced by the session-complete screen, so route the message there:
   `renderSessionComplete` (the "You finished N elements" screen) should
   render `this.pendingFlash` as a line if set. Keep `flash()` itself
   unchanged.
3. Single-level session undo for later/dismiss, mirroring the
   `commitUndoLastGrade` shape:
   - Track `lastReversible: { kind: "later" | "dismiss"; slotId; prevElement }`
     in the view; set it inside `later()` / `dismiss()`, clear it on
     grade / extract / close.
   - A new `undoLastAction()` reverses it: for dismiss, emit
     `dismiss-set` false + `setDismissed(app, file, false)`; for later,
     emit `topic-advanced` with the saved prior schedule and rewrite the
     frontmatter (same `quietFrontmatterWrite` wrappers the forward
     paths use).
   - Reuse the existing Undo affordances: the desktop "Undo last grade"
     button and mobile overflow "Undo" become "Undo" and prefer
     `lastReversible` when it is newer than the last grade. `Z`
     stays the key.
   - After undo, step the cursor back to the restored card (the
     `tryUndoLastGrade` cursor logic at ~2488 is the template).
4. Accessibility rider (2 lines): give `.ir-review-flash` a
   `role="status"` + `aria-live="polite"` attribute where it is created
   in `paintFlash()`.

Acceptance: Later today and Dismiss both flash; dismissing the LAST card
shows the message on the completion screen; Z after a dismiss restores
the card un-dismissed and shows it; Z after Later today restores the
prior due time. Grade undo unchanged. Events in `.ir/` log reflect the
reversals (no state rewrite, append-only as always).

## Phase C: a real "nothing due" surface

`startReview()` in `main.ts` (~2588) toasts
`"nothing due for review."` and returns. Separately, the review view
silently detaches itself on empty restore (`src/review-view.ts:359-368`
and ~1770). The user gets no next-due time and no sense of load.

Steps:

1. Extract a small pure helper (near `computeLoad` in
   `src/status-bar.ts`, which already walks due times): given elements +
   now, return `{ nextDueMs?: number; dueTomorrow: number; due7d: number }`.
   Unit-test it alongside the existing `computeLoad` tests.
2. New render path in the review view, `renderNothingDue(info)`, styled
   like `renderEmptyCollection` (~2271): heading, "Nothing due right
   now", next due element in humanized local time ("tomorrow 09:00",
   "in 3 h"), due-tomorrow and due-in-7-days counts, and buttons:
   **Open element tree** and **Close**. No new modal (commitment #6).
3. `startReview()`: when `queue.length === 0` but elements exist, open
   the review leaf into this state instead of toasting.
4. Replace both silent `leaf.detach()` paths with the same panel so a
   restored-empty session explains itself instead of vanishing.

Out of scope (deliberately): a "review ahead of schedule" queue. Note it
in the panel copy only if trivial ("next due: tomorrow 09:00"); building
an ahead-of-time queue touches the scheduler and is its own feature.

Acceptance: Alt+R with a non-empty collection and zero due opens a panel
showing next-due time and counts; workspace restore of a stale review
tab shows the panel, not a vanishing tab; Alt+R with a truly empty
collection still shows the existing empty-collection screen.

## Phase D: replace the two native confirm() calls

`src/tree-view.ts:1171` (bulk delete) and `:1819` (single delete) use
window `confirm()`: an unthemed OS dialog, a commitment #3 violation,
and inconsistent with `nuke-confirm-modal.ts` / `relink-confirm-modal.ts`
/ `source-gone-modal.ts`. A modal is fine here; destructive confirmation
is commitment #6's documented carve-out.

Steps:

1. New `src/confirm-modal.ts` exporting
   `promptConfirm(app, { title, body, ctaText }): Promise<boolean>`,
   modeled on `promptStateResetConfirm` in `src/nuke-confirm-modal.ts`
   (single confirm button, `mod-warning`, Esc cancels, resolve-once
   guard).
2. Swap both call sites; the message strings stay as they are (they
   already name the reparent behavior).
3. The call sites are inside sync handlers; make them `await` the
   promise inside the existing `void (async () => ...)` wrappers.

Acceptance: both delete flows show a themed modal; Esc/click-out
cancels; Enter or the CTA confirms; no `confirm(` remains in `src/`.

## Phase E: two mobile bug fixes

**E1. Priority prompt is dead on mobile.** `promptPriority` in `main.ts`
(~3098) only guards `if (!this.statusBarEl)`; on mobile the element
exists but Obsidian never shows a status bar, so Alt+P / "Set IR
priority" for a file with no store element opens an invisible input
that blur-cancels immediately.

Fix: in `promptPriority`, branch on `Platform.isMobile`. The
resolve-to-element path already prefers the tree view's inline editor;
for the no-element mobile fallback, skip the status-bar prompt and show
a Notice: "Mark the note as a topic first (it has no IR element yet)",
or route to the tree view when the element exists. Do not build a new
mobile input surface in this pass.

**E2. The swipe coach toast repeats forever for button-users.**
`swipeLegendDismissed` is persisted only inside `handleSwipeOutcome`
(`src/review-view.ts:778-785`), so a mobile user who taps buttons gets
the 8-second coach Notice every session (`maybeShowSwipeCoachMark`,
~1005; `swipeCoachShownThisSession` dies with each leaf).

Fix: persist a show-count in `localStorage` under a sibling of
`IR_SWIPE_LEGEND_KEY`; increment in `maybeShowSwipeCoachMark`; stop
showing after 3 total shows even if the user never swipes. An actual
swipe still dismisses immediately (existing path unchanged).

Acceptance: on mobile, Alt+P on an unmarked note produces a visible
outcome instead of a focus-stealing no-op; the swipe coach appears at
most 3 times ever for a button-only user.

## Release 1 checkpoint

- [ ] `npm run build` clean, `npm test` all pass.
- [ ] Per-phase acceptance above, plus the standing checklist from
      `SCOPE-MODAL-REMOVAL.md` (hotkeys, status-bar refresh chain,
      session log, tree/stats views).
- [ ] `npm version patch`, tag, `gh release create <ver> main.js
      manifest.json styles.css` (BRAT reads releases, not commits).

---

## Phase F (Release 2): FAB due-count badge

Commitment #4 (glanceable queue load) has no mobile implementation:
Obsidian mobile has no status bar, so `renderStatusBar` paints into an
invisible element, and the FAB (`src/ir-mobile-fab.ts`) shows only the
brain icon.

Steps:

1. Badge element inside the FAB: a small pill, absolutely positioned
   top-right, `var(--interactive-accent)` background with
   `var(--text-on-accent)` text (commitment #3). Shows `due` from
   `computeLoad`; hidden when 0; cap display at "99+".
2. Wiring: `main.ts` already calls `renderStatusBar` with a computed
   `QueueLoad` on every mutation (`refreshStatusBar`). Extend the
   existing `notifyWorkspaceFabSync()` precedent: export a
   `setWorkspaceFabLoad(load: QueueLoad)` from `ir-mobile-fab.ts` that
   stores the latest load and updates the badge; call it from
   `refreshStatusBar`. Do NOT compute load inside the FAB's 500 ms
   `sync()` interval; `sync()` is layout-only.
3. Update the FAB's `aria-label`/`title` to "Incremental Reading · N
   due" alongside the badge.
4. Badge must not intercept taps (`pointer-events: none`).

Acceptance: on mobile (or with the mobile emulation toggle), the FAB
shows the due count; grading/postponing/dismissing updates it without
reopening the app; zero due hides the badge; the FAB tap target is
unchanged. Desktop remains FAB-free.

Then: patch bump, tag, release, same dance.

---

## Gotchas

1. **Don't break `recordElement` → `refreshStatusBar`.** Phases B and F
   both hang off that chain; preserve every existing callback.
2. **Append-only event log.** Undo in phase B appends reversing events
   (`dismiss-set` false, `topic-advanced` with the prior schedule); it
   never edits or removes logged events.
3. **`quietFrontmatterWrite` labels.** New frontmatter writes in phase B
   need their own label strings so the reconcile suppression stays
   scoped.
4. **Theme variables differ.** `--color-red` etc. exist in default
   themes; verify under Minimal before release (commitment #3's stated
   bar).
5. **The stale `main` worktree.** A Cursor-lane worktree pins `main` at
   0.6.29 (`git worktree list`); most others are prunable. Commit on a
   branch or push `HEAD:main`; don't yank the worktrees mid-flight
   without checking the cursor lane is idle.
