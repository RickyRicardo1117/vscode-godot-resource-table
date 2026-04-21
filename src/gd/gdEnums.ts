import * as fs from "fs/promises";
import * as path from "path";
import {
  escapeGodotString,
  formatVector3Components,
  parseVector3Literal,
  vector3RhsEqual,
} from "../tres/classify";

export interface EnumMember {
  readonly name: string;
  readonly value: number;
}

const BUILTIN_EXTENDS: ReadonlySet<string> = new Set([
  "Object",
  "RefCounted",
  "Resource",
  "Node",
  "Control",
  "CanvasItem",
  "Node2D",
  "Node3D",
]);

const RE_EXTENDS: RegExp =
  /^\s*extends\s+(?:"((?:\\.|[^"\\])*)"|([A-Za-z_][A-Za-z0-9_]*))\s*(?:#.*)?$/;
const RE_EXPORT_LINE_META: RegExp =
  /^@export[\w_]*(?:\([^)]*\))?\s+var\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_.]*))?(?:\s*:=\s*(.+)|\s*=\s*(.+))?$/;
const RE_VAR_AFTER_EXPORT_META: RegExp =
  /^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_.]*))?(?:\s*:=\s*(.+)|\s*=\s*(.+))?$/;

const RE_GD_DEFAULT_STRING: RegExp = /^"((?:\\.|[^"\\])*)"$/;
const RE_ENUM_MEMBER_REF: RegExp = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;

const NON_ENUM_TYPES: ReadonlySet<string> = new Set([
  "int",
  "float",
  "bool",
  "String",
  "StringName",
  "Vector2",
  "Vector2i",
  "Vector3",
  "Vector3i",
  "Vector4",
  "Vector4i",
  "Color",
  "Rect2",
  "Rect2i",
  "Transform2D",
  "Transform3D",
  "Quaternion",
  "Basis",
  "AABB",
  "Plane",
  "Projection",
  "Callable",
  "Signal",
  "Dictionary",
  "Array",
  "PackedByteArray",
  "PackedInt32Array",
  "PackedInt64Array",
  "PackedFloat32Array",
  "PackedFloat64Array",
  "PackedStringArray",
  "PackedVector2Array",
  "PackedVector3Array",
  "PackedColorArray",
  "PackedVector4Array",
  "NodePath",
  "RID",
  "Variant",
  "void",
  "Texture",
  "Texture2D",
  "Texture3D",
  "Image",
  "PackedScene",
  "Resource",
  "Material",
  "Shader",
  "AudioStream",
  "Font",
  "StyleBox",
  "Curve",
  "Gradient",
]);

function stripHashComment(line: string): string {
  const hash: number = line.indexOf("#");
  if (hash < 0) {
    return line.trimEnd();
  }
  return line.slice(0, hash).trimEnd();
}

function findEnumBodyEnd(source: string, openBraceIndex: number): number {
  let depth: number = 0;
  for (let i: number = openBraceIndex; i < source.length; i += 1) {
    const c: string = source[i];
    if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function parseEnumMembersFromBody(body: string): EnumMember[] {
  const normalized: string = body.replace(/\r\n/g, "\n");
  const lines: string[] = normalized.split("\n");
  const parts: string[] = [];
  for (const line of lines) {
    const t: string = stripHashComment(line).trim();
    if (t === "") {
      continue;
    }
    const chunks: string[] = t.split(",");
    for (const ch of chunks) {
      const s: string = ch.trim();
      if (s !== "") {
        parts.push(s);
      }
    }
  }
  const members: EnumMember[] = [];
  let implicitNext: number = 0;
  const memberRe: RegExp = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*(-?\d+))?\s*$/;
  for (const part of parts) {
    const m: RegExpExecArray | null = memberRe.exec(part);
    if (m === null) {
      continue;
    }
    const name: string = m[1]!;
    if (m[2] !== undefined) {
      const v: number = Number(m[2]);
      if (!Number.isFinite(v)) {
        continue;
      }
      implicitNext = v + 1;
      members.push({ name, value: v });
    } else {
      members.push({ name, value: implicitNext });
      implicitNext += 1;
    }
  }
  return members;
}

/**
 * Parse `enum Name { ... }` blocks and member values (decimal literals only on rhs of `=`).
 */
export function parseGdEnumsFromSource(source: string): Map<string, EnumMember[]> {
  const out: Map<string, EnumMember[]> = new Map();
  const re: RegExp = /\benum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const enumName: string = m[1]!;
    const openIdx: number = m.index + m[0].length - 1;
    const closeIdx: number = findEnumBodyEnd(source, openIdx);
    if (closeIdx < 0) {
      continue;
    }
    const body: string = source.slice(openIdx + 1, closeIdx);
    const members: EnumMember[] = parseEnumMembersFromBody(body);
    if (members.length > 0) {
      out.set(enumName, members);
    }
  }
  return out;
}

export function parseExportPropertyMetaFromSource(source: string): {
  types: Map<string, string>;
  defaults: Map<string, string>;
} {
  const types: Map<string, string> = new Map();
  const defaults: Map<string, string> = new Map();
  const normalized: string = source.replace(/\r\n/g, "\n");
  const lines: string[] = normalized.split("\n");
  let pendingExportLine: boolean = false;
  for (let i: number = 0; i < lines.length; i += 1) {
    const trimmed: string = stripHashComment(lines[i]).trim();
    if (trimmed === "") {
      continue;
    }
    if (pendingExportLine) {
      pendingExportLine = false;
      const vm: RegExpExecArray | null = RE_VAR_AFTER_EXPORT_META.exec(trimmed);
      if (vm !== null) {
        if (vm[2] !== undefined) {
          types.set(vm[1]!, vm[2]!);
        }
        const defaultRhs: string | undefined = vm[3] ?? vm[4];
        if (defaultRhs !== undefined) {
          defaults.set(vm[1]!, defaultRhs.trim());
        }
      }
      continue;
    }
    if (/^@export\s*(?:#.*)?$/.test(trimmed)) {
      pendingExportLine = true;
      continue;
    }
    const em: RegExpExecArray | null = RE_EXPORT_LINE_META.exec(trimmed);
    if (em !== null) {
      if (em[2] !== undefined) {
        types.set(em[1]!, em[2]!);
      }
      const defaultRhs: string | undefined = em[3] ?? em[4];
      if (defaultRhs !== undefined) {
        defaults.set(em[1]!, defaultRhs.trim());
      }
    }
  }
  return { types, defaults };
}

/**
 * Map `@export var prop: Type` → `Type` (single identifier or `Outer.Inner`).
 */
export function parseExportPropertyTypesFromSource(source: string): Map<string, string> {
  return parseExportPropertyMetaFromSource(source).types;
}

export function parseExportDefaultExpressionsFromSource(source: string): Map<string, string> {
  return parseExportPropertyMetaFromSource(source).defaults;
}

function mergeEnumMaps(
  parent: ReadonlyMap<string, EnumMember[]>,
  child: ReadonlyMap<string, EnumMember[]>
): Map<string, EnumMember[]> {
  const out: Map<string, EnumMember[]> = new Map(parent);
  for (const [k, v] of child) {
    out.set(k, v);
  }
  return out;
}

function mergePropTypeMaps(
  parent: ReadonlyMap<string, string>,
  child: ReadonlyMap<string, string>
): Map<string, string> {
  const out: Map<string, string> = new Map(parent);
  for (const [k, v] of child) {
    out.set(k, v);
  }
  return out;
}

/**
 * When an `@export` has no `=` / `:=` in source, Godot still applies type defaults (e.g. `bool` →
 * `false`, custom enums → `0`, vectors → zero). Used to populate grid cells for keys omitted from `.tres`.
 */
export function implicitGodotDefaultTresRhs(typeName: string | undefined): string | undefined {
  if (typeName === undefined || typeName === "") {
    return undefined;
  }
  if (typeName === "bool") {
    return "false";
  }
  if (typeName === "int") {
    return "0";
  }
  if (typeName === "float") {
    return "0.0";
  }
  if (typeName === "String" || typeName === "StringName") {
    return escapeGodotString("");
  }
  if (typeName === "Vector2") {
    return "Vector2(0, 0)";
  }
  if (typeName === "Vector2i") {
    return "Vector2i(0, 0)";
  }
  if (typeName === "Vector3") {
    return formatVector3Components({ x: 0, y: 0, z: 0 });
  }
  if (typeName === "Vector3i") {
    return "Vector3i(0, 0, 0)";
  }
  if (isLikelyEnumPropertyType(typeName)) {
    return "0";
  }
  return undefined;
}

/**
 * Turn a GDScript `@export` default expression into a `.tres` rhs when it is a literal bool, number,
 * string, `Vector3(...)`, or `EnumName.MEMBER`. Returns `undefined` for unsupported expressions.
 */
export function defaultExprToTresRhs(
  defaultExpr: string,
  ctx: MergedScriptEnumContext
): string | undefined {
  const expr: string = defaultExpr.trim();
  if (expr === "") {
    return undefined;
  }
  const low: string = expr.toLowerCase();
  if (low === "true" || low === "false") {
    return low;
  }
  if (/^-?\d+$/.test(expr)) {
    return expr;
  }
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(expr) || /^-?\d+[eE][+-]?\d+$/.test(expr)) {
    return expr;
  }
  if (/^-?\d+\.$/.test(expr)) {
    return expr;
  }
  const sm: RegExpExecArray | null = RE_GD_DEFAULT_STRING.exec(expr);
  if (sm !== null) {
    const inner: string = sm[1]!
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
    return escapeGodotString(inner);
  }
  const em: RegExpExecArray | null = RE_ENUM_MEMBER_REF.exec(expr);
  if (em !== null) {
    const enumName: string = em[1]!;
    const memberName: string = em[2]!;
    const members: EnumMember[] | undefined = lookupEnumMembers(ctx.enums, enumName);
    if (members === undefined) {
      return undefined;
    }
    const mem: EnumMember | undefined = members.find((m: EnumMember) => m.name === memberName);
    if (mem === undefined) {
      return undefined;
    }
    return String(mem.value);
  }
  const v3: { x: number; y: number; z: number } | undefined = parseVector3Literal(expr);
  if (v3 !== undefined) {
    return formatVector3Components(v3);
  }
  return undefined;
}

export function tresRhsMatchesScriptDefault(
  tresRhsTrimmed: string,
  defaultExpr: string,
  ctx: MergedScriptEnumContext
): boolean {
  const expected: string | undefined = defaultExprToTresRhs(defaultExpr, ctx);
  if (expected === undefined) {
    return false;
  }
  const a: string = tresRhsTrimmed.trim();
  const b: string = expected.trim();
  if (a === b) {
    return true;
  }
  if (vector3RhsEqual(a, b)) {
    return true;
  }
  if (/^-?\d/.test(a) && /^-?\d/.test(b)) {
    const na: number = Number(a);
    const nb: number = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na === nb) {
      return true;
    }
  }
  return false;
}

function parseExtendsFromGdSource(source: string): { pathRes?: string; className?: string } {
  const normalized: string = source.replace(/\r\n/g, "\n");
  for (const line of normalized.split("\n")) {
    const trimmed: string = stripHashComment(line).trim();
    if (trimmed === "") {
      continue;
    }
    const m: RegExpExecArray | null = RE_EXTENDS.exec(trimmed);
    if (m === null) {
      continue;
    }
    if (m[1] !== undefined && m[1] !== "") {
      const unescaped: string = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      return { pathRes: unescaped };
    }
    if (m[2] !== undefined) {
      return { className: m[2] };
    }
  }
  return {};
}

function resPathToAbsolute(projectRoot: string, resPath: string): string | undefined {
  if (!resPath.startsWith("res://")) {
    return undefined;
  }
  const rel: string = resPath.slice("res://".length).replace(/\//g, path.sep);
  return path.join(projectRoot, rel);
}

async function readGdIfExists(absPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return undefined;
  }
}

async function isReadableFile(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export type MergedScriptEnumContext = {
  readonly enums: ReadonlyMap<string, EnumMember[]>;
  readonly propTypes: ReadonlyMap<string, string>;
  /** GDScript rhs of `=` / `:=` on `@export` lines (trimmed). */
  readonly exportDefaults: ReadonlyMap<string, string>;
};

export function lookupEnumMembers(
  enums: ReadonlyMap<string, EnumMember[]>,
  typeName: string
): EnumMember[] | undefined {
  const direct: EnumMember[] | undefined = enums.get(typeName);
  if (direct !== undefined) {
    return direct;
  }
  const dot: number = typeName.lastIndexOf(".");
  if (dot >= 0) {
    const short: string = typeName.slice(dot + 1);
    return enums.get(short);
  }
  return undefined;
}

export function isLikelyEnumPropertyType(typeName: string): boolean {
  if (NON_ENUM_TYPES.has(typeName)) {
    return false;
  }
  if (typeName.includes("[") || typeName.includes("]")) {
    return false;
  }
  return true;
}

async function mergedScriptEnumContextAt(
  absGdPath: string,
  projectRoot: string,
  classNameToPath: ReadonlyMap<string, string>,
  memo: Map<string, Promise<MergedScriptEnumContext>>
): Promise<MergedScriptEnumContext> {
  const cached: Promise<MergedScriptEnumContext> | undefined = memo.get(absGdPath);
  if (cached !== undefined) {
    return cached;
  }
  const promise: Promise<MergedScriptEnumContext> = (async (): Promise<MergedScriptEnumContext> => {
    const source: string | undefined = await readGdIfExists(absGdPath);
    if (source === undefined) {
      return { enums: new Map(), propTypes: new Map(), exportDefaults: new Map() };
    }
    const { pathRes, className } = parseExtendsFromGdSource(source);
    let parentEnums: Map<string, EnumMember[]> = new Map();
    let parentPropTypes: Map<string, string> = new Map();
    let parentDefaults: Map<string, string> = new Map();
    if (pathRes !== undefined) {
      const parentAbs: string | undefined = resPathToAbsolute(projectRoot, pathRes);
      if (parentAbs !== undefined) {
        const pctx: MergedScriptEnumContext = await mergedScriptEnumContextAt(
          parentAbs,
          projectRoot,
          classNameToPath,
          memo
        );
        parentEnums = new Map(pctx.enums);
        parentPropTypes = new Map(pctx.propTypes);
        parentDefaults = new Map(pctx.exportDefaults);
      }
    } else if (className !== undefined && !BUILTIN_EXTENDS.has(className)) {
      const parentPath: string | undefined = classNameToPath.get(className);
      if (parentPath !== undefined) {
        const pctx: MergedScriptEnumContext = await mergedScriptEnumContextAt(
          parentPath,
          projectRoot,
          classNameToPath,
          memo
        );
        parentEnums = new Map(pctx.enums);
        parentPropTypes = new Map(pctx.propTypes);
        parentDefaults = new Map(pctx.exportDefaults);
      }
    }
    const childEnums: Map<string, EnumMember[]> = parseGdEnumsFromSource(source);
    const childMeta = parseExportPropertyMetaFromSource(source);
    return {
      enums: mergeEnumMaps(parentEnums, childEnums),
      propTypes: mergePropTypeMaps(parentPropTypes, childMeta.types),
      exportDefaults: mergePropTypeMaps(parentDefaults, childMeta.defaults),
    };
  })();
  memo.set(absGdPath, promise);
  return promise;
}

/**
 * Cached enum + `@export` type map for a resource script (includes parent classes).
 */
export async function getMergedEnumContextForScript(
  scriptGdAbsPath: string,
  projectRoot: string,
  classNameToPath: ReadonlyMap<string, string>,
  memo: Map<string, Promise<MergedScriptEnumContext>>
): Promise<MergedScriptEnumContext> {
  return mergedScriptEnumContextAt(scriptGdAbsPath, projectRoot, classNameToPath, memo);
}
