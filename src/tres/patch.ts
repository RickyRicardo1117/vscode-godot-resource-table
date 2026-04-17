import type { ParsedTres, ResourceProperty } from "./types";

/**
 * Apply a single property change inside `[resource]` using surgical line edit.
 * Returns new file text or undefined if invalid.
 */
export function patchResourceProperty(
  parsed: ParsedTres,
  key: string,
  newRhs: string
): string | undefined {
  const lines: string[] = parsed.rawText.split("\n");
  const prop: ResourceProperty | undefined = parsed.properties.find((p: ResourceProperty) => p.key === key);
  if (prop !== undefined) {
    const startIdx: number = prop.lineIndex;
    const endIdx: number = prop.lineIndexEnd;
    const oldLine: string = lines[startIdx];
    const eq: number = oldLine.indexOf("=");
    if (eq <= 0) {
      return undefined;
    }
    const lhs: string = oldLine.slice(0, eq + 1);
    const newLine: string = `${lhs} ${newRhs}`;
    const span: number = endIdx - startIdx + 1;
    lines.splice(startIdx, span, newLine);
    return lines.join("\n");
  }
  return insertPropertyBeforeEnd(parsed, key, newRhs, lines);
}

function insertPropertyBeforeEnd(
  parsed: ParsedTres,
  key: string,
  newRhs: string,
  lines: string[]
): string | undefined {
  const insertAfter: number =
    parsed.properties.length > 0
      ? Math.max(...parsed.properties.map((p: ResourceProperty) => p.lineIndexEnd))
      : parsed.resourceStartLine;
  const nextLine: string = `${key} = ${newRhs}`;
  lines.splice(insertAfter + 1, 0, nextLine);
  return lines.join("\n");
}
