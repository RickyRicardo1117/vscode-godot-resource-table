import type { Dirent } from "fs";
import * as fs from "fs/promises";
import * as path from "path";

export async function collectTresFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
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
        await walk(full);
      } else if (e.isFile() && e.name.endsWith(".tres")) {
        out.push(full);
      }
    }
  }
  await walk(rootDir);
  out.sort();
  return out;
}

export function isPathInsideRoot(filePath: string, rootDir: string): boolean {
  const resolvedFile: string = path.resolve(filePath);
  const resolvedRoot: string = path.resolve(rootDir);
  const rel: string = path.relative(resolvedRoot, resolvedFile);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
