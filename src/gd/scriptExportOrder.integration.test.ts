import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseTres } from "../tres/parse";
import {
  buildClassNameToGdPathMap,
  exportOrderForGdFileAt,
  exportOrderForParsedTres,
} from "./scriptExportOrder";

const PARENT_GD: string = `extends Resource
class_name GrtExportParent

@export var parent_a: int
@export var parent_b: String
`;

const CHILD_GD: string = `extends GrtExportParent
class_name GrtExportChild

@export var child_x: bool
@export var child_y: float
`;

describe("export order (integration, temp project)", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir !== undefined) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("merges parent @export order before child-only exports", async () => {
    const dir: string = await fs.mkdtemp(path.join(os.tmpdir(), "grt-export-"));
    tmpDir = dir;
    await fs.writeFile(path.join(dir, "project.godot"), "config_version=5\n", "utf8");
    await fs.writeFile(path.join(dir, "grt_export_parent.gd"), PARENT_GD, "utf8");
    await fs.writeFile(path.join(dir, "grt_export_child.gd"), CHILD_GD, "utf8");
    const childPath: string = path.join(dir, "grt_export_child.gd");
    const classMap: Map<string, string> = await buildClassNameToGdPathMap(dir);
    const memo: Map<string, Promise<string[]>> = new Map();
    const order: string[] = await exportOrderForGdFileAt(childPath, dir, classMap, memo);
    expect(order).toEqual(["parent_a", "parent_b", "child_x", "child_y"]);
  });

  it("resolves script_class when the ext_resource script path does not exist on disk", async () => {
    const dir: string = await fs.mkdtemp(path.join(os.tmpdir(), "grt-export-tres-"));
    tmpDir = dir;
    await fs.writeFile(path.join(dir, "project.godot"), "config_version=5\n", "utf8");
    await fs.writeFile(path.join(dir, "grt_export_parent.gd"), PARENT_GD, "utf8");
    await fs.writeFile(path.join(dir, "grt_export_child.gd"), CHILD_GD, "utf8");
    const tresPath: string = path.join(dir, "fixture.tres");
    const tres: string = `[gd_resource type="Resource" script_class="GrtExportChild" format=3]

[ext_resource type="Script" path="res://no_such_script.gd" id="1_x"]

[resource]
script = ExtResource("1_x")
child_x = false
`;
    await fs.writeFile(tresPath, tres, "utf8");
    const parsed = parseTres(await fs.readFile(tresPath, "utf8"));
    expect(parsed).toBeDefined();
    const classMap: Map<string, string> = await buildClassNameToGdPathMap(dir);
    const memo: Map<string, Promise<string[]>> = new Map();
    const order: string[] | undefined = await exportOrderForParsedTres(parsed!, dir, classMap, memo);
    expect(order).toEqual(["parent_a", "parent_b", "child_x", "child_y"]);
  });
});
