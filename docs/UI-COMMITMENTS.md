# UI Commitments

This document is a contract, not an aspiration. Every PR either satisfies
every commitment below, or includes an explicit override note in the PR
description naming the commitment violated and why.

The point: UI polish is the wedge against SuperMemo. UI commitments die one
PR at a time when they are aspirational. They survive only when each
violation is named in writing.

---

## 1. Keyboard-first

Every IR action has a default keyboard binding. Vim mode is respected.
Nothing critical lives behind a mouse-only menu.

**Satisfied when:** every command added to the plugin registers a default
hotkey AND works under the Vim plugin AND has no Vim-incompatible side
effects (no focus traps, no swallowed `Esc`).

**Common violations:** "ribbon-only" actions, mouse-driven drag-to-create
without a keyboard equivalent, modal dialogs that swallow `:`.

## 2. Single review surface

During a review session the user sees one pane: the item or extract under
review, with its source context visible alongside (side panel, not modal).
No new window. No interrupting overlay.

**Satisfied when:** entering review does not open a new tab, modal, or
detached window; the source is reachable in the same surface; closing the
review does not leave orphan panes.

**Common violations:** modal flashcard popovers, full-screen review modes
that hide the rest of Obsidian, dialogs that require a click to dismiss
before the next card.

## 3. Native Obsidian look

The plugin honors the active theme. CSS variables, Obsidian's typography,
and Live Preview compatibility all hold without override.

**Satisfied when:** all custom UI uses Obsidian CSS variables for colors
and spacing; no hardcoded hex colors in component CSS; the plugin looks
correct under at least the default light, default dark, and one popular
community theme (e.g. Minimal).

**Common violations:** bespoke widgets with their own visual language,
inline `style="color: #..."`, fonts forced via `font-family`.

## 4. Glanceable queue load

A persistent indicator shows queue state without requiring a click: due
today, postponed, net inflow this week. Visible without opening the
plugin's main view.

**Satisfied when:** status bar or top-bar element shows current queue
load at all times during plugin activation; numbers update on add /
postpone / review / extract.

**Common violations:** queue state only visible inside a side panel the
user must open; numbers that go stale until manual refresh.

## 5. Tree view that is actually a tree

The element view shows source -> extract -> item as a navigable hierarchy:
expand / collapse, drag-to-reparent, breadcrumb visible in the review pane.
Not a flat list with indentation.

**Satisfied when:** the view supports expand/collapse per node, parent
moves move children, breadcrumb is rendered during review, and the data
model is a real tree (not a flat list rendered with depth).

**Common violations:** indented flat lists that lose hierarchy on filter,
no breadcrumb in review, drag-to-reparent missing or broken.

## 6. No popups that block the document

Plugin UI lives inline (in-document widgets), in the status bar, or in a
side panel. Modal dialogs are reserved for destructive confirmation only
(e.g. "delete extract chain?").

**Satisfied when:** no PR adds a modal dialog for a non-destructive action;
no inline workflow requires dismissing a popup to continue.

**Common violations:** "are you sure?" dialogs for reversible operations,
modal forms for adding extracts, popups for showing review stats.

**Documented exception (0.0.10+):** The optional **cloze hint** prompt
(`src/cloze-hint-modal.ts`) is a small `Modal` shown when creating a cloze
from the **editor** (Alt+Z outside review). It mirrors SuperMemo-style hint
entry, stays skippable (Continue with an empty field), and is not used for
destructive actions. **Partial reversal (post-0.0.10):** the **review view**
now uses an inline hint bar instead of the modal, so cloze creation during
review never blocks the document. The editor path still uses the modal
because there is no persistent inline surface to anchor the prompt to.

## 7. Session audit ("what did I touch")

One command shows the user every item, extract, and source touched in the
current review session, with timestamps. Closes the audit-your-own-pass
loop SuperMemo never made obvious.

**Satisfied when:** a command (default-bound) displays a session log;
the log is this review pass (stamped at Alt+R / Alt+N), not plugin load;
entries jump the review cursor or open the note.

**Common violations:** session state only available via developer
console; log resets between cards.

---

## Override policy

Real overrides exist. Some PRs will legitimately need to violate a
commitment. The contract is not "never violate" but "violations are named."

PR description must include:

```
UI commitment override:
- Commitment violated: #N (name)
- Justification: <one sentence>
- Reversal plan: <when this becomes compliant>
```

If three PRs override the same commitment without a reversal plan landing,
the commitment is dead in practice and this doc should be updated to
reflect what the project actually believes.

---

## Why these seven and not more

These seven map to the loudest UX complaints against SuperMemo and against
the Obsidian competition (see `MARKET-RESEARCH.md` §8). Each one is
testable in a PR review without subjective taste. Adding more commitments
weakens the contract: longer lists get skimmed, shorter lists get followed.
