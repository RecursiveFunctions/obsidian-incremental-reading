<!--
Thanks for contributing. This template is short on purpose. The UI
commitment checklist is the part that matters; everything else is light.
-->

## What this changes

<!-- One or two sentences. The PR title should already say the rest. -->

## Why

<!-- The user-visible problem this solves, or the internal invariant it
preserves. Skip if obvious from the diff. -->

## UI commitments checklist

See `docs/UI-COMMITMENTS.md`. Check every box OR fill out the override
block below.

- [ ] 1. Keyboard-first (default hotkey, Vim-compatible)
- [ ] 2. Single review surface (no new windows or blocking modals during review)
- [ ] 3. Native Obsidian look (CSS variables, theme-respecting)
- [ ] 4. Glanceable queue load (status indicator stays accurate)
- [ ] 5. Tree view stays a real tree (parent/child, breadcrumb, drag-to-reparent)
- [ ] 6. No blocking popups (inline / status bar / side panel only; modals reserved for destructive ops)
- [ ] 7. Session audit reachable (command + log not broken)
- [ ] N/A: this PR does not touch user-facing UI

### UI commitment override (if any)

<!-- Only fill this in if a checkbox above is unchecked. -->

- Commitment violated: #N (name)
- Justification:
- Reversal plan:

## Test plan

<!-- How you verified this. "Built, loaded in a vault, ran review through
five cards" is fine for small PRs. -->

- [ ]
- [ ]
