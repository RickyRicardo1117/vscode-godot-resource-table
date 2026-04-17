import { describe, expect, it } from "vitest";
import { extResourcePathMap, parseTres } from "./parse";
import { patchResourceProperty } from "./patch";

const SAMPLE: string = `[gd_resource type="Resource" script_class="OreItemData" load_steps=2 format=3 uid="uid://test"]

[ext_resource type="Script" path="res://items/ore_item_data.gd" id="1_x"]

[resource]
script = ExtResource("1_x")
name = "Iron ore"
sell_price = 1.0
unlocked = true
`;

describe("parseTres", () => {
  it("parses ext_resource and resource properties", () => {
    const p = parseTres(SAMPLE);
    expect(p).toBeDefined();
    expect(p?.scriptClass).toBe("OreItemData");
    expect(p?.properties.map((x) => x.key)).toEqual(["script", "name", "sell_price", "unlocked"]);
    const paths = extResourcePathMap(p!);
    expect(paths.get("1_x")).toBe("res://items/ore_item_data.gd");
  });
});

const MULTILINE_DESC: string = `[gd_resource type="Resource" format=3]

[resource]
description = "line one
line two"
foo = 1
`;

describe("parseTres multiline quoted values", () => {
  it("records line span for values split across lines", () => {
    const p = parseTres(MULTILINE_DESC);
    expect(p).toBeDefined();
    const desc = p!.properties.find((x) => x.key === "description");
    expect(desc?.rawValue).toBe('"line one\nline two"');
    expect(desc?.lineIndex).toBe(3);
    expect(desc?.lineIndexEnd).toBe(4);
  });

  it("patch replaces the full span without leaving continuation lines", () => {
    const p = parseTres(MULTILINE_DESC)!;
    const next = patchResourceProperty(p, "description", '"single"');
    expect(next).toBeDefined();
    expect(next!.split("\n")).toEqual([
      "[gd_resource type=\"Resource\" format=3]",
      "",
      "[resource]",
      'description = "single"',
      "foo = 1",
      "",
    ]);
  });
});

describe("patchResourceProperty", () => {
  it("replaces an existing primitive value", () => {
    const p = parseTres(SAMPLE)!;
    const next = patchResourceProperty(p, "sell_price", "2.5");
    expect(next).toBeDefined();
    expect(next).toContain("sell_price = 2.5");
    const again = parseTres(next!);
    expect(again?.properties.find((x) => x.key === "sell_price")?.rawValue).toBe("2.5");
  });

  it("inserts a new key when missing", () => {
    const p = parseTres(SAMPLE)!;
    const next = patchResourceProperty(p, "unlock_level", "3");
    expect(next).toContain("unlock_level = 3");
  });
});
