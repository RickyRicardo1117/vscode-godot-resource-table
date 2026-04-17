import { describe, expect, it } from "vitest";
import {
  classifyValue,
  editableDisplay,
  formatForTres,
  formatVector3ForTres,
  parseVector3Literal,
  vector3RhsEqual,
} from "./classify";

describe("parseVector3Literal", () => {
  it("parses Godot-style Vector3 literals", () => {
    expect(parseVector3Literal("Vector3(4, 4, 4)")).toEqual({ x: 4, y: 4, z: 4 });
    expect(parseVector3Literal("vector3(1.5, -2, 3e2)")).toEqual({ x: 1.5, y: -2, z: 300 });
  });

  it("rejects invalid input", () => {
    expect(parseVector3Literal("Vector3()")).toBeUndefined();
    expect(parseVector3Literal("Vector3(1, 2)")).toBeUndefined();
    expect(parseVector3Literal("(1, 2, 3)")).toBeUndefined();
  });
});

describe("classifyValue / formatVector3ForTres", () => {
  it("classifies Vector3 as vector3", () => {
    expect(classifyValue("Vector3(1, 2, 3)")).toBe("vector3");
  });

  it("normalizes shorthand and full form", () => {
    expect(formatVector3ForTres("1, 2, 3")).toBe("Vector3(1, 2, 3)");
    expect(formatVector3ForTres("Vector3(1,2,3)")).toBe("Vector3(1, 2, 3)");
  });
});

describe("vector3RhsEqual", () => {
  it("compares numeric equality", () => {
    expect(vector3RhsEqual("Vector3(4, 4, 4)", "Vector3(4.0, 4.0, 4.0)")).toBe(true);
    expect(vector3RhsEqual("Vector3(1, 2, 3)", "Vector3(1, 2, 4)")).toBe(false);
  });
});

describe("multiline string cells", () => {
  it("classifies quoted values that contain newlines as string", () => {
    expect(classifyValue('"a\nb"')).toBe("string");
  });

  it("editableDisplay strips quotes and decodes escapes", () => {
    expect(editableDisplay("string", '"a\nb"')).toBe("a\nb");
  });

  it("formatForTres re-escapes newlines for a single .tres line", () => {
    expect(formatForTres("string", "a\nb")).toBe('"a\\nb"');
  });
});
