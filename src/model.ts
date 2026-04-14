import * as fs from "fs/promises";
import * as path from "path";
import { classifyValue, editableDisplay, readonlyDisplay } from "./tres/classify";
import type { CellKind } from "./tres/types";
import { extResourcePathMap, parseTres } from "./tres/parse";
import type { ParsedTres } from "./tres/types";
export const COL_FILE: string = "file";
export const COL_SCRIPT_CLASS: string = "script_class";

export interface GridCellPayload {
  readonly displayText: string;
  readonly rawValue: string | undefined;
  readonly kind: CellKind;
  readonly editable: boolean;
}

export interface GridRowPayload {
  readonly absPath: string;
  readonly relPath: string;
  readonly cells: Record<string, GridCellPayload>;
}

export interface GridPayload {
  readonly rootPath: string;
  readonly columns: readonly string[];
  readonly rows: readonly GridRowPayload[];
  readonly errors: readonly { relPath: string; message: string }[];
}

function cellForProperty(raw: string, extPaths: ReadonlyMap<string, string>): GridCellPayload {
  if (raw.includes("\n")) {
    return {
      displayText: raw.replace(/\s+/g, " ").trim().slice(0, 200),
      rawValue: raw,
      kind: "readonly",
      editable: false,
    };
  }
  const kind: CellKind = classifyValue(raw);
  const editable: boolean = kind !== "readonly";
  const displayText: string = editable
    ? editableDisplay(kind, raw)
    : readonlyDisplay(raw, extPaths);
  return {
    displayText,
    rawValue: raw,
    kind,
    editable,
  };
}

function emptyCell(): GridCellPayload {
  return {
    displayText: "",
    rawValue: undefined,
    kind: "string",
    editable: true,
  };
}

export async function buildGridPayload(rootPath: string, absPaths: readonly string[]): Promise<GridPayload> {
  const rows: GridRowPayload[] = [];
  const errors: { relPath: string; message: string }[] = [];
  const keySet: Set<string> = new Set();
  for (const abs of absPaths) {
    const rel: string = path.relative(rootPath, abs);
    let text: string;
    try {
      text = await fs.readFile(abs, "utf8");
    } catch (e) {
      errors.push({ relPath: rel, message: String(e) });
      continue;
    }
    const parsed: ParsedTres | undefined = parseTres(text);
    if (parsed === undefined) {
      errors.push({ relPath: rel, message: "No [resource] section" });
      continue;
    }
    const extPaths: Map<string, string> = extResourcePathMap(parsed);
    for (const p of parsed.properties) {
      keySet.add(p.key);
    }
    const cells: Record<string, GridCellPayload> = {};
    cells[COL_FILE] = {
      displayText: rel.replace(/\\/g, "/"),
      rawValue: rel,
      kind: "readonly",
      editable: false,
    };
    cells[COL_SCRIPT_CLASS] = {
      displayText: parsed.scriptClass ?? "",
      rawValue: parsed.scriptClass,
      kind: "readonly",
      editable: false,
    };
    for (const p of parsed.properties) {
      cells[p.key] = cellForProperty(p.rawValue, extPaths);
    }
    rows.push({ absPath: abs, relPath: rel, cells });
  }
  const propColumns: string[] = Array.from(keySet).sort((a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const columns: string[] = [COL_FILE, COL_SCRIPT_CLASS, ...propColumns];
  for (const row of rows) {
    for (const col of propColumns) {
      if (row.cells[col] === undefined) {
        row.cells[col] = emptyCell();
      }
    }
  }
  return { rootPath, columns, rows, errors };
}
