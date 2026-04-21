import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGridPayload } from "./model";

/** Minimal Godot-style resource script generated in a temp project (no game assets). */
const FIXTURE_GD: string = `extends Resource
class_name GrtFixtureResource

enum Mode {
	ALPHA,
	BETA,
}
@export var label: String = ""
@export var mode: Mode
@export var archived: bool
`;

describe("buildGridPayload (integration)", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir !== undefined) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function writeFixtureProject(dir: string): Promise<string> {
    await fs.writeFile(
      path.join(dir, "project.godot"),
      "config_version=5\n",
      "utf8"
    );
    const gdRel: string = "grt_fixture_resource.gd";
    await fs.writeFile(path.join(dir, gdRel), FIXTURE_GD, "utf8");
    return gdRel;
  }

  it("resolves enum int 0 to the first member name", async () => {
    const dir: string = await fs.mkdtemp(path.join(os.tmpdir(), "grt-enum0-"));
    tmpDir = dir;
    const gdRel: string = await writeFixtureProject(dir);
    const tresName: string = "enum_zero.tres";
    const tresPath: string = path.join(dir, tresName);
    const tres: string = `[gd_resource type="Resource" script_class="GrtFixtureResource" format=3]

[ext_resource type="Script" path="res://${gdRel}" id="1_x"]

[resource]
script = ExtResource("1_x")
label = "fixture"
mode = 0
`;
    await fs.writeFile(tresPath, tres, "utf8");
    const payload = await buildGridPayload(dir, [tresPath]);
    expect(payload.errors).toEqual([]);
    expect(payload.rows.length).toBe(1);
    const cell = payload.rows[0]!.cells["mode"];
    expect(cell).toBeDefined();
    expect(cell!.kind).toBe("enum");
    expect(cell!.displayText).toBe("ALPHA");
    expect(cell!.rawValue).toBe("0");
  });

  it("fills omitted grid_size from := Vector3(...) when there is no : type annotation", async () => {
    const dir: string = await fs.mkdtemp(path.join(os.tmpdir(), "grt-gridvec-"));
    tmpDir = dir;
    const gdRel: string = "grt_grid_vec.gd";
    await fs.writeFile(
      path.join(dir, "project.godot"),
      "config_version=5\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(dir, gdRel),
      `extends Resource
class_name GrtGridVecResource

@export var grid_size := Vector3(4, 4, 4)
`,
      "utf8"
    );
    const tresPath: string = path.join(dir, "no_grid.tres");
    await fs.writeFile(
      tresPath,
      `[gd_resource type="Resource" script_class="GrtGridVecResource" format=3]

[ext_resource type="Script" path="res://${gdRel}" id="1_x"]

[resource]
script = ExtResource("1_x")
`,
      "utf8"
    );
    const payload = await buildGridPayload(dir, [tresPath]);
    expect(payload.errors).toEqual([]);
    const cell = payload.rows[0]!.cells["grid_size"];
    expect(cell).toBeDefined();
    expect(cell!.kind).toBe("vector3");
    expect(cell!.displayText).toBe("Vector3(4, 4, 4)");
    expect(cell!.atScriptDefault).toBe(true);
  });

  it("fills omitted enum and bool keys with Godot implicit defaults from export types", async () => {
    const dir: string = await fs.mkdtemp(path.join(os.tmpdir(), "grt-omitdef-"));
    tmpDir = dir;
    const gdRel: string = await writeFixtureProject(dir);
    const tresPath: string = path.join(dir, "omit_defaults.tres");
    const tres: string = `[gd_resource type="Resource" script_class="GrtFixtureResource" format=3]

[ext_resource type="Script" path="res://${gdRel}" id="1_x"]

[resource]
script = ExtResource("1_x")
label = "only_label"
`;
    await fs.writeFile(tresPath, tres, "utf8");
    const payload = await buildGridPayload(dir, [tresPath]);
    expect(payload.errors).toEqual([]);
    expect(payload.rows[0]!.cells["mode"]!.kind).toBe("enum");
    expect(payload.rows[0]!.cells["mode"]!.displayText).toBe("ALPHA");
    expect(payload.rows[0]!.cells["mode"]!.rawValue).toBe("0");
    expect(payload.rows[0]!.cells["mode"]!.atScriptDefault).toBe(true);
    expect(payload.rows[0]!.cells["archived"]!.kind).toBe("bool");
    expect(payload.rows[0]!.cells["archived"]!.displayText).toBe("false");
    expect(payload.rows[0]!.cells["archived"]!.rawValue).toBe("false");
    expect(payload.rows[0]!.cells["archived"]!.atScriptDefault).toBe(true);
  });

  it("ignores a [resource] line named file so it cannot replace the path column", async () => {
    const dir: string = await fs.mkdtemp(path.join(os.tmpdir(), "grt-filecol-"));
    tmpDir = dir;
    const gdRel: string = await writeFixtureProject(dir);
    const tresName: string = "file_key_collision.tres";
    const tresPath: string = path.join(dir, tresName);
    const tres: string = `[gd_resource type="Resource" script_class="GrtFixtureResource" format=3]

[ext_resource type="Script" path="res://${gdRel}" id="1_x"]

[resource]
script = ExtResource("1_x")
label = "collision"
file = 0
mode = 0
`;
    await fs.writeFile(tresPath, tres, "utf8");
    const payload = await buildGridPayload(dir, [tresPath]);
    expect(payload.errors).toEqual([]);
    const fileColCount = payload.columns.filter((c) => c === "file").length;
    expect(fileColCount).toBe(1);
    const pathCell = payload.rows[0]!.cells["file"];
    expect(pathCell!.kind).toBe("readonly");
    expect(pathCell!.displayText).toContain(tresName);
    expect(payload.rows[0]!.cells["mode"]!.displayText).toBe("ALPHA");
  });
});
