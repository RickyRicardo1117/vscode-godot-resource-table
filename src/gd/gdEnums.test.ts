import { describe, expect, it } from "vitest";
import { formatEnumForTres } from "../tres/classify";
import {
  defaultExprToTresRhs,
  implicitGodotDefaultTresRhs,
  lookupEnumMembers,
  parseExportDefaultExpressionsFromSource,
  parseExportPropertyTypesFromSource,
  parseGdEnumsFromSource,
  tresRhsMatchesScriptDefault,
  type MergedScriptEnumContext,
} from "./gdEnums";

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
@export var item_slot: SlotKind
@export
var tier: int
`;
    const m: Map<string, string> = parseExportPropertyTypesFromSource(src);
    expect(m.get("item_slot")).toBe("SlotKind");
    expect(m.get("tier")).toBe("int");
  });
});

describe("implicitGodotDefaultTresRhs", () => {
  it("maps common @export types to Godot’s implicit defaults", () => {
    expect(implicitGodotDefaultTresRhs("bool")).toBe("false");
    expect(implicitGodotDefaultTresRhs("int")).toBe("0");
    expect(implicitGodotDefaultTresRhs("float")).toBe("0.0");
    expect(implicitGodotDefaultTresRhs("String")).toBe('""');
    expect(implicitGodotDefaultTresRhs("StringName")).toBe('""');
    expect(implicitGodotDefaultTresRhs("ItemData.Type")).toBe("0");
    expect(implicitGodotDefaultTresRhs("Vector3")).toBe("Vector3(0, 0, 0)");
    expect(implicitGodotDefaultTresRhs("Vector2")).toBe("Vector2(0, 0)");
    expect(implicitGodotDefaultTresRhs("Vector2i")).toBe("Vector2i(0, 0)");
    expect(implicitGodotDefaultTresRhs("Vector3i")).toBe("Vector3i(0, 0, 0)");
    expect(implicitGodotDefaultTresRhs(undefined)).toBeUndefined();
    expect(implicitGodotDefaultTresRhs("PackedScene")).toBeUndefined();
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
      ["SlotKind", [{ name: "X", value: 1 }]],
    ]);
    expect(lookupEnumMembers(enums, "InventoryRow.SlotKind")).toEqual([{ name: "X", value: 1 }]);
  });
});

describe("formatEnumForTres", () => {
  const members: { name: string; value: number }[] = [
    { name: "NORTH", value: 1 },
    { name: "SOUTH", value: 0 },
  ];
  it("accepts integer strings", () => {
    expect(formatEnumForTres("1", members)).toBe("1");
  });
  it("accepts member names", () => {
    expect(formatEnumForTres("NORTH", members)).toBe("1");
  });
});
