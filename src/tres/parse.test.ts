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
