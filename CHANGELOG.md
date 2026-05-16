# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Topic mark** (MVP item 1): command *"Mark current note as IR topic"* and a ribbon action that set `ir-type: topic` + `ir-priority` and seed a fresh FSRS card in note frontmatter. Idempotent — re-marking an existing topic is a no-op.
- Settings tab with a configurable default topic priority (0–100 slider).
- Frontmatter/FSRS serialization layer (`src/fsrs.ts`, `src/ir-note.ts`, `src/types.ts`) — the shared foundation later IR features build on.
- Initial repository scaffold: Obsidian plugin skeleton, TypeScript + esbuild build pipeline, `ts-fsrs` dependency for scheduling, MIT license, CI build workflow, issue templates.

[Unreleased]: https://github.com/RecursiveFunctions/obsidian-incremental-reading/commits/main
