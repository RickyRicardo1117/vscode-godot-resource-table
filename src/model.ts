import * as fs from "fs/promises";
import * as path from "path";
import {
  defaultExprToTresRhs,
  getMergedEnumContextForScript,
  implicitGodotDefaultTresRhs,
  isLikelyEnumPropertyType,
  lookupEnumMembers,
  tresRhsMatchesScriptDefault,
  type MergedScriptEnumContext,
} from "./gd/gdEnums";
import {
  buildClassNameToGdPathMap,
  exportOrderForParsedTres,
  findGodotProjectRoot,
  resolveResourceScriptGdPath,
} from "./gd/scriptExportOrder";
import {
  classifyValue,
  editableDisplay,
  formatEnumForTres,
  formatForTres,
  readonlyDisplay,
} from "./tres/classify";
import type { CellKind } from "./tres/types";
import { extResourcePathMap, parseTres } from "./tres/parse";
import type { ParsedTres } from "./tres/types";
export const COL_FILE: string = "file";
export const COL_SCRIPT_CLASS: string = "script_class";

/** `[resource]` keys with these names cannot be shown as columns — they would overwrite the path / class columns. */
const RESERVED_RESOURCE_CELL_KEYS: ReadonlySet<string> = new Set([COL_FILE, COL_SCRIPT_CLASS]);

/** Serialized enum choices for `kind: "enum"` cells (webview dropdown). */
export interface GridEnumMemberPayload {
  readonly name: string;
  readonly value: number;
}

export interface GridCellPayload {
  readonly displayText: string;
  readonly rawValue: string | undefined;
  readonly kind: CellKind;
  readonly editable: boolean;
  /**
   * `false` when this column is not an `@export` on this row’s script (column exists only because
   * other resources use it). Omitted when `true`.
   */
  readonly applicable?: boolean;
  /** Present when the `.tres` value matches an explicit `@export` default from the script. */
  readonly atScriptDefault?: boolean;
  /** Set for `enum` cells: all known members for the property’s enum type. */
  readonly enumMembers?: readonly GridEnumMemberPayload[];
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

function markAtScriptDefault(
  cell: GridCellPayload,
  tresRhs: string,
  propKey: string,
  enumCtx: MergedScriptEnumContext | undefined
): GridCellPayload {
  if (enumCtx === undefined) {
    return cell;
  }
  const defEx: string | undefined = enumCtx.exportDefaults.get(propKey);
  if (defEx === undefined) {
    return cell;
  }
  if (!tresRhsMatchesScriptDefault(tresRhs, defEx, enumCtx)) {
    return cell;
  }
  return { ...cell, atScriptDefault: true };
}

function cellForProperty(
  raw: string,
  extPaths: ReadonlyMap<string, string>,
  propKey: string,
  enumCtx: MergedScriptEnumContext | undefined
): GridCellPayload {
  const kind: CellKind = classifyValue(raw);
  if (kind === "int" && enumCtx !== undefined) {
    const typeName: string | undefined = enumCtx.propTypes.get(propKey);
    if (typeName !== undefined && isLikelyEnumPropertyType(typeName)) {
      const members = lookupEnumMembers(enumCtx.enums, typeName);
      if (members !== undefined && members.length > 0) {
        const n: number = Number.parseInt(raw.trim(), 10);
        if (!Number.isNaN(n)) {
          const mem = members.find((m) => m.value === n);
          return markAtScriptDefault(
            {
              displayText: mem !== undefined ? mem.name : String(n),
              rawValue: raw.trim(),
              kind: "enum",
              editable: true,
              enumMembers: members.map((m) => ({ name: m.name, value: m.value })),
            },
            raw.trim(),
            propKey,
            enumCtx
          );
        }
      }
    }
  }
  const editable: boolean = kind !== "readonly";
  const displayText: string = editable
    ? editableDisplay(kind, raw)
    : readonlyDisplay(raw, extPaths);
  return markAtScriptDefault(
    {
      displayText,
      rawValue: raw,
      kind,
      editable,
    },
    raw.trim(),
    propKey,
    enumCtx
  );
}

function cellForOmittedProperty(
  propKey: string,
  enumCtx: MergedScriptEnumContext | undefined,
  extPaths: ReadonlyMap<string, string>
): GridCellPayload {
  if (enumCtx === undefined) {
    return emptyCell();
  }
  const knownOnScript: boolean =
    enumCtx.propTypes.has(propKey) || enumCtx.exportDefaults.has(propKey);
  if (!knownOnScript) {
    return notApplicableCell();
  }
  const defEx: string | undefined = enumCtx.exportDefaults.get(propKey);
  let rhs: string | undefined;
  if (defEx !== undefined) {
    rhs = defaultExprToTresRhs(defEx, enumCtx);
  }
  let filledFromImplicitTypeDefault: boolean = false;
  if (rhs === undefined) {
    const typeName: string | undefined = enumCtx.propTypes.get(propKey);
    const implicitRhs: string | undefined = implicitGodotDefaultTresRhs(typeName);
    if (implicitRhs !== undefined) {
      rhs = implicitRhs;
      filledFromImplicitTypeDefault = true;
    }
  }
  if (rhs === undefined) {
    return emptyCell();
  }
  const cell: GridCellPayload = cellForProperty(rhs, extPaths, propKey, enumCtx);
  if (filledFromImplicitTypeDefault) {
    return { ...cell, atScriptDefault: true };
  }
  return cell;
}

function emptyCell(): GridCellPayload {
  return {
    displayText: "",
    rawValue: undefined,
    kind: "string",
    editable: true,
  };
}

function notApplicableCell(): GridCellPayload {
  return {
    displayText: "",
    rawValue: undefined,
    kind: "readonly",
    editable: false,
    applicable: false,
  };
}

function buildFirstSeenPositions(fileKeyOrders: readonly (readonly string[])[]): Map<string, number> {
  const firstSeen: Map<string, number> = new Map();
  let seq: number = 0;
  for (const ord of fileKeyOrders) {
    for (const k of ord) {
      if (!firstSeen.has(k)) {
        firstSeen.set(k, seq);
      }
      seq += 1;
    }
  }
  return firstSeen;
}

function compareKeysByFirstSeen(
  a: string,
  b: string,
  firstSeen: ReadonlyMap<string, number>
): number {
  const da: number = firstSeen.get(a) ?? 0;
  const db: number = firstSeen.get(b) ?? 0;
  if (da !== db) {
    return da - db;
  }
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * Merge per-file key sequences into one column order. Each file contributes "previous key before
 * next key" constraints. Cycles are broken using first-seen position (folder walk order, then
 * position in each list). Used to combine script `@export` orders across resources.
 */
export function orderPropertyKeysFromFileOrders(fileKeyOrders: readonly (readonly string[])[]): string[] {
  const allKeys: Set<string> = new Set();
  for (const ord of fileKeyOrders) {
    for (const k of ord) {
      allKeys.add(k);
    }
  }
  const nodes: string[] = Array.from(allKeys);
  const preds: Map<string, Set<string>> = new Map();
  for (const k of nodes) {
    preds.set(k, new Set());
  }
  for (const ord of fileKeyOrders) {
    let prev: string | undefined;
    for (const k of ord) {
      if (prev !== undefined && prev !== k) {
        preds.get(k)!.add(prev);
      }
      prev = k;
    }
  }
  const firstSeen: Map<string, number> = buildFirstSeenPositions(fileKeyOrders);
  const result: string[] = [];
  const inResult: Set<string> = new Set();
  const remaining: Set<string> = new Set(nodes);
  while (remaining.size > 0) {
    const candidates: string[] = [...remaining].filter((k: string) => {
      for (const p of preds.get(k) ?? []) {
        if (!inResult.has(p)) {
          return false;
        }
      }
      return true;
    });
    let pick: string;
    if (candidates.length > 0) {
      candidates.sort((a: string, b: string) => compareKeysByFirstSeen(a, b, firstSeen));
      pick = candidates[0]!;
    } else {
      const rest: string[] = [...remaining];
      rest.sort((a: string, b: string) => compareKeysByFirstSeen(a, b, firstSeen));
      pick = rest[0]!;
    }
    result.push(pick);
    inResult.add(pick);
    remaining.delete(pick);
  }
  return result;
}

export async function buildGridPayload(rootPath: string, absPaths: readonly string[]): Promise<GridPayload> {
  const rows: GridRowPayload[] = [];
  const errors: { relPath: string; message: string }[] = [];
  const keySet: Set<string> = new Set();
  const fileKeyOrders: string[][] = [];
  const projectRoot: string = await findGodotProjectRoot(rootPath);
  const classNameToPath: Map<string, string> = await buildClassNameToGdPathMap(projectRoot);
  const exportMemo: Map<string, Promise<string[]>> = new Map();
  const enumMemo: Map<string, Promise<MergedScriptEnumContext>> = new Map();
  const enumCtxByAbs: Map<string, MergedScriptEnumContext | undefined> = new Map();
  const extPathsByAbs: Map<string, Map<string, string>> = new Map();
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
    const scriptOrder: string[] | undefined = await exportOrderForParsedTres(
      parsed,
      projectRoot,
      classNameToPath,
      exportMemo
    );
    if (scriptOrder !== undefined) {
      fileKeyOrders.push(scriptOrder.filter((k: string) => !RESERVED_RESOURCE_CELL_KEYS.has(k)));
    } else {
      fileKeyOrders.push(
        parsed.properties.map((p) => p.key).filter((k: string) => !RESERVED_RESOURCE_CELL_KEYS.has(k))
      );
    }
    for (const p of parsed.properties) {
      if (!RESERVED_RESOURCE_CELL_KEYS.has(p.key)) {
        keySet.add(p.key);
      }
    }
    const scriptGd: string | undefined = await resolveResourceScriptGdPath(
      parsed,
      projectRoot,
      classNameToPath
    );
    let enumCtx: MergedScriptEnumContext | undefined;
    if (scriptGd !== undefined) {
      enumCtx = await getMergedEnumContextForScript(scriptGd, projectRoot, classNameToPath, enumMemo);
    }
    enumCtxByAbs.set(abs, enumCtx);
    extPathsByAbs.set(abs, extPaths);
    const cells: Record<string, GridCellPayload> = {};
    for (const p of parsed.properties) {
      if (RESERVED_RESOURCE_CELL_KEYS.has(p.key)) {
        continue;
      }
      cells[p.key] = cellForProperty(p.rawValue, extPaths, p.key, enumCtx);
    }
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
    rows.push({ absPath: abs, relPath: rel, cells });
  }
  const propColumns: string[] = orderPropertyKeysFromFileOrders(fileKeyOrders).filter(
    (k: string) => !RESERVED_RESOURCE_CELL_KEYS.has(k)
  );
  const colSet: Set<string> = new Set(propColumns);
  const missing: string[] = [];
  for (const k of keySet) {
    if (!colSet.has(k)) {
      missing.push(k);
    }
  }
  if (missing.length > 0) {
    missing.sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    propColumns.push(...missing);
  }
  const columns: string[] = [COL_FILE, COL_SCRIPT_CLASS, ...propColumns];
  for (const row of rows) {
    const rowCtx: MergedScriptEnumContext | undefined = enumCtxByAbs.get(row.absPath);
    const rowExt: Map<string, string> = extPathsByAbs.get(row.absPath) ?? new Map();
    for (const col of propColumns) {
      if (row.cells[col] === undefined) {
        row.cells[col] = cellForOmittedProperty(col, rowCtx, rowExt);
      }
    }
  }
  return { rootPath, columns, rows, errors };
}

/**
 * Turn edited cell text into a `.tres` rhs string. For `enum` cells, resolves names via the
 * resource script’s `@export` types and parsed `enum` blocks.
 */
export async function formatPropertyValueForTresEdit(
  rootPath: string,
  parsed: ParsedTres,
  propKey: string,
  newText: string,
  kind: CellKind
): Promise<string | undefined> {
  if (kind === "readonly") {
    return undefined;
  }
  if (kind !== "enum") {
    return formatForTres(kind, newText);
  }
  const projectRoot: string = await findGodotProjectRoot(rootPath);
  const classNameToPath: Map<string, string> = await buildClassNameToGdPathMap(projectRoot);
  const scriptGd: string | undefined = await resolveResourceScriptGdPath(
    parsed,
    projectRoot,
    classNameToPath
  );
  if (scriptGd === undefined) {
    return formatForTres("int", newText);
  }
  const enumMemo: Map<string, Promise<MergedScriptEnumContext>> = new Map();
  const ctx: MergedScriptEnumContext = await getMergedEnumContextForScript(
    scriptGd,
    projectRoot,
    classNameToPath,
    enumMemo
  );
  const typeName: string | undefined = ctx.propTypes.get(propKey);
  if (typeName === undefined || !isLikelyEnumPropertyType(typeName)) {
    return formatForTres("int", newText);
  }
  const members = lookupEnumMembers(ctx.enums, typeName);
  if (members === undefined || members.length === 0) {
    return formatForTres("int", newText);
  }
  return formatEnumForTres(newText, members);
}
