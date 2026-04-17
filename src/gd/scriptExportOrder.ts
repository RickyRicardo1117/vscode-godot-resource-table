import type { Dirent } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import type { ParsedTres } from "../tres/types";

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

const RE_EXT_RESOURCE_ID: RegExp = /ExtResource\s*\(\s*"([^"]+)"\s*\)/;
const RE_CLASS_NAME: RegExp = /^\s*class_name\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
const RE_EXTENDS: RegExp =
  /^\s*extends\s+(?:"((?:\\.|[^"\\])*)"|([A-Za-z_][A-Za-z0-9_]*))\s*(?:#.*)?$/;
const RE_EXPORT_LINE: RegExp =
  /^@export[\w_]*(?:\([^)]*\))?\s+var\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
const RE_VAR_AFTER_EXPORT: RegExp = /^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\b/;

function stripHashComment(line: string): string {
  const hash: number = line.indexOf("#");
  if (hash < 0) {
    return line.trimEnd();
  }
  return line.slice(0, hash).trimEnd();
}

/**
 * @export property names in source order for one `.gd` file (not including `extends` chain).
 */
export function parseExportVarNamesFromGdSource(source: string): string[] {
  const normalized: string = source.replace(/\r\n/g, "\n");
  const lines: string[] = normalized.split("\n");
  const names: string[] = [];
  let pendingExportLine: boolean = false;
  for (let i: number = 0; i < lines.length; i += 1) {
    const trimmed: string = stripHashComment(lines[i]).trim();
    if (trimmed === "") {
      continue;
    }
    if (pendingExportLine) {
      pendingExportLine = false;
      const vm: RegExpExecArray | null = RE_VAR_AFTER_EXPORT.exec(trimmed);
      if (vm !== null) {
        names.push(vm[1]!);
      }
      continue;
    }
    if (/^@export\s*(?:#.*)?$/.test(trimmed)) {
      pendingExportLine = true;
      continue;
    }
    const em: RegExpExecArray | null = RE_EXPORT_LINE.exec(trimmed);
    if (em !== null) {
      names.push(em[1]!);
    }
  }
  return names;
}

function parseClassNameFromGdSource(source: string): string | undefined {
  const normalized: string = source.replace(/\r\n/g, "\n");
  for (const line of normalized.split("\n")) {
    const trimmed: string = stripHashComment(line).trim();
    if (trimmed === "") {
      continue;
    }
    const m: RegExpExecArray | null = RE_CLASS_NAME.exec(trimmed);
    if (m !== null) {
      return m[1];
    }
  }
  return undefined;
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

function mergeParentThenChild(parent: readonly string[], child: readonly string[]): string[] {
  const seen: Set<string> = new Set(parent);
  const out: string[] = [...parent];
  for (const k of child) {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export async function findGodotProjectRoot(startPath: string): Promise<string> {
  let dir: string = path.resolve(startPath);
  const rootDrive: string = path.parse(dir).root;
  while (dir !== rootDrive) {
    try {
      await fs.access(path.join(dir, "project.godot"));
      return dir;
    } catch {
      /* continue */
    }
    dir = path.dirname(dir);
  }
  return path.resolve(startPath);
}

const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([".git", "node_modules", ".godot"]);

export async function buildClassNameToGdPathMap(projectRoot: string): Promise<Map<string, string>> {
  const map: Map<string, string> = new Map();
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full: string = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(e.name)) {
          await walk(full);
        }
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".gd")) {
        continue;
      }
      let text: string;
      try {
        text = await fs.readFile(full, "utf8");
      } catch {
        continue;
      }
      const cn: string | undefined = parseClassNameFromGdSource(text);
      if (cn !== undefined && !map.has(cn)) {
        map.set(cn, full);
      }
    }
  }
  await walk(projectRoot);
  return map;
}

function resPathToAbsolute(projectRoot: string, resPath: string): string | undefined {
  if (!resPath.startsWith("res://")) {
    return undefined;
  }
  const rel: string = resPath.slice("res://".length).replace(/\//g, path.sep);
  const abs: string = path.join(projectRoot, rel);
  return abs;
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

export async function exportOrderForGdFileAt(
  absGdPath: string,
  projectRoot: string,
  classNameToPath: ReadonlyMap<string, string>,
  memo: Map<string, Promise<string[]>>
): Promise<string[]> {
  const cached: Promise<string[]> | undefined = memo.get(absGdPath);
  if (cached !== undefined) {
    return cached;
  }
  const promise: Promise<string[]> = (async (): Promise<string[]> => {
    const source: string | undefined = await readGdIfExists(absGdPath);
    if (source === undefined) {
      return [];
    }
    const { pathRes, className } = parseExtendsFromGdSource(source);
    let parentOrder: string[] = [];
    if (pathRes !== undefined) {
      const parentAbs: string | undefined = resPathToAbsolute(projectRoot, pathRes);
      if (parentAbs !== undefined) {
        parentOrder = await exportOrderForGdFileAt(parentAbs, projectRoot, classNameToPath, memo);
      }
    } else if (className !== undefined && !BUILTIN_EXTENDS.has(className)) {
      const parentPath: string | undefined = classNameToPath.get(className);
      if (parentPath !== undefined) {
        parentOrder = await exportOrderForGdFileAt(
          parentPath,
          projectRoot,
          classNameToPath,
          memo
        );
      }
    }
    const own: string[] = parseExportVarNamesFromGdSource(source);
    return mergeParentThenChild(parentOrder, own);
  })();
  memo.set(absGdPath, promise);
  return promise;
}

function scriptExtResourceId(parsed: ParsedTres): string | undefined {
  for (const p of parsed.properties) {
    if (p.key !== "script") {
      continue;
    }
    const m: RegExpExecArray | null = RE_EXT_RESOURCE_ID.exec(p.rawValue);
    return m !== null ? m[1] : undefined;
  }
  return undefined;
}

function scriptAbsPath(
  parsed: ParsedTres,
  projectRoot: string
): string | undefined {
  const id: string | undefined = scriptExtResourceId(parsed);
  if (id === undefined) {
    return undefined;
  }
  const entry = parsed.extResources.get(id);
  const resPath: string | undefined = entry?.path;
  if (resPath === undefined) {
    return undefined;
  }
  return resPathToAbsolute(projectRoot, resPath);
}

/**
 * Ordered export names for the `.tres` resource's attached script (base class exports first),
 * or `undefined` if the script path cannot be resolved.
 */
/**
 * Absolute path to the `.gd` attached to this resource, when the file exists.
 */
export async function resolveResourceScriptGdPath(
  parsed: ParsedTres,
  projectRoot: string,
  classNameToPath: ReadonlyMap<string, string>
): Promise<string | undefined> {
  let abs: string | undefined = scriptAbsPath(parsed, projectRoot);
  if (abs !== undefined && !(await isReadableFile(abs))) {
    abs = undefined;
  }
  if (abs === undefined && parsed.scriptClass !== undefined) {
    abs = classNameToPath.get(parsed.scriptClass);
  }
  if (abs === undefined || !(await isReadableFile(abs))) {
    return undefined;
  }
  return abs;
}

export async function exportOrderForParsedTres(
  parsed: ParsedTres,
  projectRoot: string,
  classNameToPath: ReadonlyMap<string, string>,
  memo: Map<string, Promise<string[]>>
): Promise<string[] | undefined> {
  const abs: string | undefined = await resolveResourceScriptGdPath(
    parsed,
    projectRoot,
    classNameToPath
  );
  if (abs === undefined) {
    return undefined;
  }
  const order: string[] = await exportOrderForGdFileAt(abs, projectRoot, classNameToPath, memo);
  if (order.length === 0) {
    return undefined;
  }
  return order;
}
