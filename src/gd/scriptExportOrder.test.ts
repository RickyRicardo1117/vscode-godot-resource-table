import * as fs from "fs/promises";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  buildClassNameToGdPathMap,
  exportOrderForGdFileAt,
  exportOrderForParsedTres,
  findGodotProjectRoot,
  parseExportVarNamesFromGdSource,
} from "./scriptExportOrder";
import { parseTres } from "../tres/parse";

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

describe("inheritance export order (fixture .gd in repo)", async () => {
  const repoRoot: string = path.resolve(__dirname, "..", "..");
  const itemGd: string = path.join(repoRoot, "item_data.gd");
  const buildableGd: string = path.join(repoRoot, "buildable_data.gd");

  let itemNames: string[] = [];
  let canRunIntegration: boolean = false;
  try {
    await fs.access(itemGd);
    await fs.access(buildableGd);
    canRunIntegration = true;
    itemNames = parseExportVarNamesFromGdSource(await fs.readFile(itemGd, "utf8"));
  } catch {
    /* fixtures optional */
  }

  it.skipIf(!canRunIntegration)("BuildableData order is ItemData exports then buildable-only", async () => {
    const classMap: Map<string, string> = await buildClassNameToGdPathMap(repoRoot);
    const memo: Map<string, Promise<string[]>> = new Map();
    const order: string[] = await exportOrderForGdFileAt(
      buildableGd,
      repoRoot,
      classMap,
      memo
    );
    expect(order.length).toBeGreaterThan(itemNames.length);
    expect(order.slice(0, itemNames.length)).toEqual(itemNames);
    expect(order).toContain("tier");
    expect(order.indexOf("tier")).toBeGreaterThan(order.indexOf("shelf_scene"));
  });

  it.skipIf(!canRunIntegration)("air_lock.tres uses script_class when res:// script path is missing", async () => {
    const tresPath: string = path.join(repoRoot, "air_lock.tres");
    const text: string = await fs.readFile(tresPath, "utf8");
    const parsed = parseTres(text);
    expect(parsed).toBeDefined();
    const classMap: Map<string, string> = await buildClassNameToGdPathMap(repoRoot);
    const memo: Map<string, Promise<string[]>> = new Map();
    const order: string[] | undefined = await exportOrderForParsedTres(
      parsed!,
      repoRoot,
      classMap,
      memo
    );
    expect(order).toBeDefined();
    expect(order!.indexOf("internal_development_phase")).toBeLessThan(order!.indexOf("name"));
    expect(order!.indexOf("shelf_scene")).toBeLessThan(order!.indexOf("tier"));
  });
});

describe("findGodotProjectRoot", () => {
  it("returns start path when no project.godot in ancestors", async () => {
    const repoRoot: string = path.resolve(__dirname, "..", "..");
    const got: string = await findGodotProjectRoot(repoRoot);
    expect(got).toBe(path.resolve(repoRoot));
  });
});
