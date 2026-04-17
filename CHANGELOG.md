# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.2.0] - 2026-04-16

### Added

- Boolean `@export` cells use an inline toggle switch instead of opening a text editor.

### Changed

- Multiline quoted string values in `.tres` resources are editable in the grid; display uses the same unquoted, unescaped text as other string cells. Patching a multiline quoted property replaces the full line span in the file so continuation lines are not left behind.
- Column pinning (header context menu) pins **only** the chosen column with horizontal `position: sticky` (like a single sticky column), instead of freezing every column to its left. Menu labels: **Pin column …** and **Unpin column**.

### Fixed

- Pinned column **body** cells use opaque backgrounds (including zebra striping via `color-mix` and `opacity: 1` over readonly styling) so text stays readable when the column overlaps horizontally scrolling content.
