import * as fs from "fs/promises";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { formatEnumForTres } from "../tres/classify";
import {
  defaultExprToTresRhs,
  getMergedEnumContextForScript,
  lookupEnumMembers,
  parseExportDefaultExpressionsFromSource,
  parseExportPropertyTypesFromSource,
  parseGdEnumsFromSource,
  tresRhsMatchesScriptDefault,
  type MergedScriptEnumContext,
} from "./gdEnums";
import { buildClassNameToGdPathMap, findGodotProjectRoot } from "./scriptExportOrder";

describe("parseGdEnumsFromSource", () => {
  it("parses implicit and explicit values like Godot", () => {
    const src: string = `
enum E { A, B = 10, C }
`;
    const m: Map<string, { name: string; value: number }[]> = parseGdEnumsFromSource(src);
    expect(m.get("E")).toEqual([
      { name: "A", value: 0 },
      { name: "B", value: 10 },
      { name: "C", value: 11 },
    ]);
  });
});

describe("parseExportPropertyTypesFromSource", () => {
  it("maps var name to type after colon", () => {
    const src: string = `
@export var sold_in_store: Stores
@export
var tier: int
`;
    const m: Map<string, string> = parseExportPropertyTypesFromSource(src);
    expect(m.get("sold_in_store")).toBe("Stores");
    expect(m.get("tier")).toBe("int");
  });
});

describe("parseExportDefaultExpressionsFromSource", () => {
  it("captures = and := defaults", () => {
    const src: string = `
@export var unlock_level: int = 99
@export var tier := 1
`;
    const m: Map<string, string> = parseExportDefaultExpressionsFromSource(src);
    expect(m.get("unlock_level")).toBe("99");
    expect(m.get("tier")).toBe("1");
  });
});

describe("tresRhsMatchesScriptDefault", () => {
  it("matches enum member default to stored int", () => {
    const enums: Map<string, { name: string; value: number }[]> = new Map([
      ["DevelopmentPhase", [{ name: "FINAL", value: 0 }]],
    ]);
    const ctx: MergedScriptEnumContext = {
      enums,
      propTypes: new Map(),
      exportDefaults: new Map(),
    };
    expect(
      tresRhsMatchesScriptDefault("0", "DevelopmentPhase.FINAL", ctx)
    ).toBe(true);
    const rhs: string | undefined = defaultExprToTresRhs("DevelopmentPhase.FINAL", ctx);
    expect(rhs).toBe("0");
  });
});

describe("lookupEnumMembers", () => {
  it("falls back to short name after dot", () => {
    const enums: Map<string, { name: string; value: number }[]> = new Map([
      ["Stores", [{ name: "X", value: 1 }]],
    ]);
    expect(lookupEnumMembers(enums, "ItemData.Stores")).toEqual([{ name: "X", value: 1 }]);
  });
});

describe("formatEnumForTres", () => {
  const members: { name: string; value: number }[] = [
    { name: "SUNNYS_SUPERCENTER", value: 1 },
    { name: "LOWER", value: 0 },
  ];
  it("accepts integer strings", () => {
    expect(formatEnumForTres("1", members)).toBe("1");
  });
  it("accepts member names", () => {
    expect(formatEnumForTres("SUNNYS_SUPERCENTER", members)).toBe("1");
  });
});

describe("merged enum context (repo fixtures)", async () => {
  const repoRoot: string = path.resolve(__dirname, "..", "..");
  const itemGd: string = path.join(repoRoot, "item_data.gd");
  let canRun: boolean = false;
  try {
    await fs.access(itemGd);
    canRun = true;
  } catch {
    /* optional */
  }

  it.skipIf(!canRun)("ItemData exposes Stores and sold_in_store maps to it", async () => {
    const projectRoot: string = await findGodotProjectRoot(repoRoot);
    const classMap: Map<string, string> = await buildClassNameToGdPathMap(projectRoot);
    const memo: Map<string, Promise<MergedScriptEnumContext>> = new Map();
    const ctx = await getMergedEnumContextForScript(itemGd, projectRoot, classMap, memo);
    expect(ctx.propTypes.get("sold_in_store")).toBe("Stores");
    const stores = lookupEnumMembers(ctx.enums, "Stores");
    expect(stores?.map((s) => s.name).includes("SUNNYS_SUPERCENTER")).toBe(true);
  });
});
