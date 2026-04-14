# Godot Resource Table (VS Code extension)

Spreadsheet-style view for editing many Godot 4 `.tres` files in a folder: sortable columns, resizable headers, and in-place edits for simple primitive fields (`bool`, `int`, `float`, `string`). `ExtResource`, arrays, and other complex values are shown read-only (see [Godot Resources as Sheets](https://github.com/don-tnowe/godot-resources-as-sheets-plugin) for a fuller in-editor workflow).

Inspired by the UX of [jonaraphael/csv](https://github.com/jonaraphael/csv) (table + sort + resize), without CSV as the source of truth—files stay native `.tres`.

## Requirements

- VS Code **1.85+** (or Cursor)

## Development

```bash
cd vscode-godot-resource-table
npm install
npm run compile
npm test
```

Press **F5** in VS Code with this folder open (**Run Extension**). In the Extension Development Host, run **Godot Resource Table: Open Folder** from the Command Palette and choose a folder that contains `.tres` files (for example your game’s `items` tree).

## Package

```bash
npm run package
```

Install the generated `.vsix` with **Extensions: Install from VSIX…**.

## Usage

1. **Godot Resource Table: Open Folder** — pick a directory; all `*.tres` files under it are loaded recursively.
2. Click a column header to sort (toggle direction on repeat click). Drag the right edge of a header to resize; widths are remembered per folder in workspace state.
3. Double-click an editable cell (or focus it and press **Enter**), edit, then blur or **Enter** to save. Invalid values show an error and the table reloads.
4. **Refresh** button or **Godot Resource Table: Refresh** reloads from disk. The host watches the folder and refreshes after external changes (debounced; writes from this view are briefly ignored to avoid feedback loops).

Columns **file** and **script_class** are read-only. Other columns are the union of all `[resource]` property keys across files; missing keys appear as empty editable cells (saved as strings unless you use a typed value Godot accepts on that line).

## Limitations (v0.1)

- Multiline property values are read-only in the grid.
- New empty cells default to **string** typing when you first add a property name column value.
- Does not run Godot; validate important edits in the Godot inspector.

## License

MIT
