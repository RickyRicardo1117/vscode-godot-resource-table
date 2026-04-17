import type { CellKind } from "./types";

/**
 * Parse a `Vector3(x, y, z)` literal as used in `.tres` / GDScript (constructor name is case-insensitive).
 */
export function parseVector3Literal(rhs: string): { x: number; y: number; z: number } | undefined {
  const t: string = rhs.trim();
  const m: RegExpExecArray | null = /^Vector3\s*\(\s*([\s\S]*?)\s*\)$/i.exec(t);
  if (m === null) {
    return undefined;
  }
  const inner: string = m[1]!.trim();
  if (inner === "") {
    return undefined;
  }
  const parts: string[] = inner
    .split(",")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  if (parts.length !== 3) {
    return undefined;
  }
  const x: number = Number(parts[0]);
  const y: number = Number(parts[1]);
  const z: number = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return undefined;
  }
  return { x, y, z };
}

export function formatVector3Components(v: { x: number; y: number; z: number }): string {
  return `Vector3(${String(v.x)}, ${String(v.y)}, ${String(v.z)})`;
}

/** True if both sides parse as Vector3 and components are numerically equal. */
export function vector3RhsEqual(a: string, b: string): boolean {
  const va: { x: number; y: number; z: number } | undefined = parseVector3Literal(a.trim());
  const vb: { x: number; y: number; z: number } | undefined = parseVector3Literal(b.trim());
  if (va === undefined || vb === undefined) {
    return false;
  }
  return va.x === vb.x && va.y === vb.y && va.z === vb.z;
}

/**
 * Classify a Godot `.tres` value string (right-hand side of `key =`) for editing.
 */
export function classifyValue(rhs: string): CellKind {
  const t: string = rhs.trim();
  if (t === "true" || t === "false") {
    return "bool";
  }
  if (/^-?\d+$/.test(t)) {
    return "int";
  }
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(t) || /^-?\d+[eE][+-]?\d+$/.test(t)) {
    return "float";
  }
  if (/^-?\d+\.$/.test(t)) {
    return "float";
  }
  if (t.startsWith('"')) {
    return "string";
  }
  if (parseVector3Literal(t) !== undefined) {
    return "vector3";
  }
  return "readonly";
}

/** Plain text for grid when value is readonly (e.g. show ExtResource path). */
export function readonlyDisplay(rhs: string, extPathById: ReadonlyMap<string, string>): string {
  const t: string = rhs.trim();
  const extMatch: RegExpMatchArray | null = /^ExtResource\s*\(\s*"([^"]+)"\s*\)$/.exec(t);
  if (extMatch) {
    const id: string = extMatch[1];
    const p: string | undefined = extPathById.get(id);
    if (p !== undefined) {
      return p;
    }
  }
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

/** Text shown in an editable cell (unquoted for strings). */
export function editableDisplay(kind: CellKind, rhs: string): string {
  const t: string = rhs.trim();
  if (kind === "string" && t.startsWith('"') && t.endsWith('"')) {
    return unescapeGodotString(t.slice(1, -1));
  }
  if (kind === "vector3") {
    const v: { x: number; y: number; z: number } | undefined = parseVector3Literal(t);
    return v !== undefined ? formatVector3Components(v) : t;
  }
  return t;
}

function unescapeGodotString(inner: string): string {
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

export function escapeGodotString(s: string): string {
  const escaped: string = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** Map enum member name (or integer string) to `.tres` integer rhs. */
export function formatEnumForTres(
  input: string,
  members: readonly { readonly name: string; readonly value: number }[]
): string | undefined {
  const t: string = input.trim();
  if (/^-?\d+$/.test(t)) {
    return t;
  }
  const exact = members.find((m: { readonly name: string; readonly value: number }) => m.name === t);
  if (exact !== undefined) {
    return String(exact.value);
  }
  const lower: string = t.toLowerCase();
  const ci = members.find(
    (m: { readonly name: string; readonly value: number }) => m.name.toLowerCase() === lower
  );
  if (ci !== undefined) {
    return String(ci.value);
  }
  return undefined;
}

/** Format user input for writing into `.tres` based on cell kind. */
export function formatForTres(kind: CellKind, input: string): string | undefined {
  const t: string = input.trim();
  if (kind === "bool") {
    const lower: string = t.toLowerCase();
    if (lower === "true" || lower === "1" || lower === "yes") {
      return "true";
    }
    if (lower === "false" || lower === "0" || lower === "no") {
      return "false";
    }
    return undefined;
  }
  if (kind === "int") {
    if (!/^-?\d+$/.test(t)) {
      return undefined;
    }
    return t;
  }
  if (kind === "float") {
    const n: number = Number(t);
    if (!Number.isFinite(n)) {
      return undefined;
    }
    return String(n);
  }
  if (kind === "string") {
    return escapeGodotString(input);
  }
  if (kind === "vector3") {
    return formatVector3ForTres(t);
  }
  if (kind === "enum") {
    return undefined;
  }
  return undefined;
}

/**
 * Accept `Vector3(x,y,z)` or three comma-separated numbers; returns normalized `.tres` rhs.
 */
export function formatVector3ForTres(input: string): string | undefined {
  const t: string = input.trim();
  const asLit: { x: number; y: number; z: number } | undefined = parseVector3Literal(t);
  if (asLit !== undefined) {
    return formatVector3Components(asLit);
  }
  const parts: string[] = t
    .split(",")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  if (parts.length !== 3) {
    return undefined;
  }
  const x: number = Number(parts[0]);
  const y: number = Number(parts[1]);
  const z: number = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return undefined;
  }
  return formatVector3Components({ x, y, z });
}
