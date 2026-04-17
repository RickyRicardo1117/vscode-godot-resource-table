import type { ExtResourceEntry, ParsedTres, ResourceProperty } from "./types";

const SECTION_HEADER: RegExp = /^\[[^\]]+\]\s*$/;

function parseBracketAttributes(inner: string): Map<string, string> {
  const map: Map<string, string> = new Map();
  const re: RegExp = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

function bracketInner(line: string, prefix: string): string | undefined {
  const t: string = line.trim();
  if (!t.startsWith(prefix) || !t.endsWith("]")) {
    return undefined;
  }
  return t.slice(prefix.length, -1);
}

function parseGdResourceLine(line: string): { scriptClass?: string; resourceType?: string } {
  const inner: string | undefined = bracketInner(line, "[gd_resource");
  if (inner === undefined) {
    return {};
  }
  const attrs: Map<string, string> = parseBracketAttributes(inner);
  return {
    scriptClass: attrs.get("script_class"),
    resourceType: attrs.get("type"),
  };
}

function parseExtResourceLine(line: string): ExtResourceEntry | undefined {
  const inner: string | undefined = bracketInner(line, "[ext_resource");
  if (inner === undefined) {
    return undefined;
  }
  const attrs: Map<string, string> = parseBracketAttributes(inner);
  const id: string | undefined = attrs.get("id");
  if (id === undefined) {
    return undefined;
  }
  return {
    id,
    type: attrs.get("type"),
    path: attrs.get("path"),
  };
}

/**
 * Parse `[resource]` block: lines are `key = value` with possible multiline quoted strings.
 */
function parseResourceProperties(
  lines: readonly string[],
  startLine: number,
  endLine: number
): ResourceProperty[] {
  const props: ResourceProperty[] = [];
  let i: number = startLine;
  while (i <= endLine) {
    const line: string = lines[i];
    const eq: number = line.indexOf("=");
    if (eq <= 0) {
      i += 1;
      continue;
    }
    const key: string = line.slice(0, eq).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      i += 1;
      continue;
    }
    let valuePart: string = line.slice(eq + 1).trimStart();
    let endIdx: number = i;
    if (valuePart.startsWith('"')) {
      let combined: string = valuePart;
      let quoteCount: number = countUnescapedQuotes(combined);
      while (quoteCount % 2 === 1 && endIdx < endLine) {
        endIdx += 1;
        combined += "\n" + lines[endIdx];
        quoteCount = countUnescapedQuotes(combined);
      }
      props.push({ key, rawValue: combined, lineIndex: i, lineIndexEnd: endIdx });
      i = endIdx + 1;
      continue;
    }
    props.push({ key, rawValue: valuePart, lineIndex: i, lineIndexEnd: i });
    i += 1;
  }
  return props;
}

function countUnescapedQuotes(s: string): number {
  let n: number = 0;
  let esc: boolean = false;
  for (let j: number = 0; j < s.length; j += 1) {
    const c: string = s[j];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      n += 1;
    }
  }
  return n;
}

export function parseTres(text: string): ParsedTres | undefined {
  const normalized: string = text.replace(/\r\n/g, "\n");
  const lines: string[] = normalized.split("\n");
  const sectionStarts: number[] = [];
  for (let i: number = 0; i < lines.length; i += 1) {
    if (SECTION_HEADER.test(lines[i])) {
      sectionStarts.push(i);
    }
  }
  let gdLine: string | undefined;
  const extMap: Map<string, ExtResourceEntry> = new Map();
  let resourceIdx: number = -1;
  for (let s: number = 0; s < sectionStarts.length; s += 1) {
    const lineIdx: number = sectionStarts[s];
    const hdr: string = lines[lineIdx].trim();
    if (hdr.startsWith("[gd_resource")) {
      gdLine = lines[lineIdx];
    } else if (hdr.startsWith("[ext_resource")) {
      const e: ExtResourceEntry | undefined = parseExtResourceLine(lines[lineIdx]);
      if (e !== undefined) {
        extMap.set(e.id, e);
      }
    } else if (hdr === "[resource]") {
      resourceIdx = lineIdx;
      break;
    }
  }
  if (resourceIdx < 0) {
    return undefined;
  }
  const nextSection: number | undefined = sectionStarts.find((idx: number) => idx > resourceIdx);
  const resourceEndLine: number = nextSection !== undefined ? nextSection - 1 : lines.length - 1;
  const resourceStartLine: number = resourceIdx + 1;
  if (resourceStartLine > resourceEndLine) {
    return {
      rawText: text,
      gdResourceLine: gdLine,
      scriptClass: gdLine !== undefined ? parseGdResourceLine(gdLine).scriptClass : undefined,
      resourceType: gdLine !== undefined ? parseGdResourceLine(gdLine).resourceType : undefined,
      extResources: extMap,
      resourceStartLine: resourceIdx,
      resourceEndLine: resourceIdx,
      properties: [],
    };
  }
  const meta: { scriptClass?: string; resourceType?: string } =
    gdLine !== undefined ? parseGdResourceLine(gdLine) : {};
  const properties: ResourceProperty[] = parseResourceProperties(
    lines,
    resourceStartLine,
    resourceEndLine
  );
  return {
    rawText: normalized,
    gdResourceLine: gdLine,
    scriptClass: meta.scriptClass,
    resourceType: meta.resourceType,
    extResources: extMap,
    resourceStartLine: resourceIdx,
    resourceEndLine,
    properties,
  };
}

export function extResourcePathMap(parsed: ParsedTres): Map<string, string> {
  const m: Map<string, string> = new Map();
  for (const e of parsed.extResources.values()) {
    if (e.path !== undefined) {
      m.set(e.id, e.path);
    }
  }
  return m;
}
