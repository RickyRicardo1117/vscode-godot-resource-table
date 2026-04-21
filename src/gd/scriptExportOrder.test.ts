import * as path from "path";
import { describe, expect, it } from "vitest";
import { findGodotProjectRoot, parseExportVarNamesFromGdSource } from "./scriptExportOrder";

describe("parseExportVarNamesFromGdSource", () => {
  it("collects @export vars in file order", () => {
    const src: string = `
@export var alpha: int
@export_multiline var beta: String
@export_group("G")
@export var gamma := 1
`;
    expect(parseExportVarNamesFromGdSource(src)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("handles @export on its own line before var", () => {
    const src: string = `
@export
var spaced: int
`;
    expect(parseExportVarNamesFromGdSource(src)).toEqual(["spaced"]);
  });

  it("ignores non-export vars", () => {
    const src: string = `
var plain: int
@export var ex: bool
`;
    expect(parseExportVarNamesFromGdSource(src)).toEqual(["ex"]);
  });
});

describe("findGodotProjectRoot", () => {
  it("returns start path when no project.godot in ancestors", async () => {
    const repoRoot: string = path.resolve(__dirname, "..", "..");
    const got: string = await findGodotProjectRoot(repoRoot);
    expect(got).toBe(path.resolve(repoRoot));
  });
});
