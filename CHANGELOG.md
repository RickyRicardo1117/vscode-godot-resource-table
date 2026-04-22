# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.3.1] - 2026-04-22

### Added

- Extension **icon** for the Marketplace (`icon.png` via `package.json` `icon`).
- **Remember last opened folder** for the “Open Godot .tres folder” dialog (`globalState`).
- **Drag column headers** (⋮⋮ handle) to reorder columns; order is saved per opened root folder in **workspace** state and restored on refresh.
- Webview **`color-scheme`** matches the active VS Code light/dark theme, with updates when the theme changes.

### Changed

- `package.json`: **repository** URL for Marketplace / `vsce` metadata.
- `.vscodeignore`: exclude `.cursor/` and `.temp/` from the VSIX, ignore Affinity/SVG icon sources used only for authoring, and keep repo-root Godot fixture filenames out of the package.

## [0.3.0] - 2026-04-21

### Added

- Omitted `.tres` properties that exist on the resource script’s `@export` list are filled from **Godot defaults** when the file does not set a value: `bool` → false, `int` / custom enums → 0, `float` → 0.0, `String` / `StringName` → empty string, `Vector2` / `Vector2i` / `Vector3` / `Vector3i` → zero vectors. Enum columns show the member name for value `0`. These synthetic cells are marked like other script defaults (`at-default` styling).
- `@export var name := …` **without** a `: Type` annotation (for example `grid_size := Vector3(4, 4, 4)`) is recognized for omitted keys: the parsed default expression is applied so the grid shows the intended vector or other supported literal.

### Fixed

- Webview grid treats non-object / missing cell payloads safely when sorting and rendering (`displayText` coerced via `String(… ?? "")`).
- `.vscodeignore` excludes local Godot fixture files at the repo root (`air_lock.tres`, `buildable_data.gd`, `item_data.gd`) so they are not bundled into the `.vsix`.

### Changed

- Heavy **export order** checks that build a temp Godot project now live in `scriptExportOrder.integration.test.ts`; the unit test file stays lighter.

## [0.2.0] - 2026-04-16

### Added

- Boolean `@export` cells use an inline toggle switch instead of opening a text editor.

### Changed

- Multiline quoted string values in `.tres` resources are editable in the grid; display uses the same unquoted, unescaped text as other string cells. Patching a multiline quoted property replaces the full line span in the file so continuation lines are not left behind.
- Column pinning (header context menu) pins **only** the chosen column with horizontal `position: sticky` (like a single sticky column), instead of freezing every column to its left. Menu labels: **Pin column …** and **Unpin column**.

### Fixed

- Pinned column **body** cells use opaque backgrounds (including zebra striping via `color-mix` and `opacity: 1` over readonly styling) so text stays readable when the column overlaps horizontally scrolling content.
