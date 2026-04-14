import type { CellKind } from "./types";

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
  return undefined;
}
