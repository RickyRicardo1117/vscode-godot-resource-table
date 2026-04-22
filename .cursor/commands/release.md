---
description: Ship a new VS Code extension version (compile, test, bump, changelog, package, commit, push, GitHub release)
---

# Release Godot Resource Table

Run this workflow from the repo root (`vscode-godot-resource-table`).

## Preconditions

- Clean working tree except intentional release edits (or commit what is ready).
- `gh` CLI installed and authenticated (`gh auth status`) if you will create the GitHub release from the terminal.
- Node 18+ (per `package.json`); use Node 20+ for `vsce package` if you hit tooling issues.

## Steps

1. **Compile and test**

   ```bash
   npm run compile
   npm test
   ```

2. **Version**

   - Bump `"version"` in `package.json` (semver: patch for fixes/small UX, minor for features, major for breaking changes).

3. **Changelog**

   - In `CHANGELOG.md`, add a `## [X.Y.Z] - YYYY-MM-DD` section under `[Unreleased]`, then clear `[Unreleased]` or leave a stub for the next cycle.
   - Mirror the user-facing highlights (Added / Changed / Fixed).

4. **Package**

   ```bash
   npm run package
   ```

   Produces `godot-resource-table-X.Y.Z.vsix` (ignored by git per `.gitignore`). Scan the `vsce` “Files included” list: `.cursor/`, `.temp/`, design sources, and local fixtures must **not** appear—tighten `.vscodeignore` if they do.

5. **Commit and tag**

   ```bash
   git add package.json CHANGELOG.md .vscodeignore media/ src/ icon.png .cursor/commands/
   git commit -m "chore(release): vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```

6. **Push**

   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

7. **GitHub release** (attach the VSIX)

   ```bash
   gh release create vX.Y.Z godot-resource-table-X.Y.Z.vsix --title "vX.Y.Z" --generate-notes
   ```

   Adjust `--notes-file` or body flags if you prefer release notes from `CHANGELOG.md` instead of auto-generated commits.

   Upload `godot-resource-table-X.Y.Z.vsix` manually to the Visual Studio Marketplace and/or Open VSX if you use those registries.

## Optional checks

- Confirm `.vscodeignore` does not exclude files required at runtime (`media/**`, compiled `out/**` via prepublish, etc.).
