import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  COL_FILE,
  COL_SCRIPT_CLASS,
  buildGridPayload,
  formatPropertyValueForTresEdit,
  type GridPayload,
} from "./model";
import type { CellKind } from "./tres/types";
import { parseTres } from "./tres/parse";
import { patchResourceProperty } from "./tres/patch";
import { collectTresFiles, isPathInsideRoot } from "./tres/walk";

const PANEL_VIEW_TYPE: string = "godotResourceTable.panel";
const CTX_ACTIVE: string = "godotResourceTable.panelActive";
const LAST_ROOT_FOLDER_KEY: string = "godotResourceTable.lastRootFolder";

interface PanelSession {
  readonly rootPath: string;
  panel: vscode.WebviewPanel;
  disposeWatch: vscode.Disposable;
}

let session: PanelSession | undefined;
let ignoreWatchUntilMs: number = 0;

/** Align native form controls (e.g. `<select>`) with the active VS Code light/dark theme. */
function webviewColorScheme(): "light" | "dark" {
  const k: vscode.ColorThemeKind = vscode.window.activeColorTheme.kind;
  if (
    k === vscode.ColorThemeKind.Light ||
    k === vscode.ColorThemeKind.HighContrastLight
  ) {
    return "light";
  }
  return "dark";
}

async function defaultFolderUriForOpenDialog(context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
  const last: string | undefined = context.globalState.get<string>(LAST_ROOT_FOLDER_KEY);
  if (last === undefined || last.length === 0) {
    return undefined;
  }
  try {
    const st: fsSync.Stats = await fs.stat(last);
    if (!st.isDirectory()) {
      return undefined;
    }
    return vscode.Uri.file(last);
  } catch {
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("godotResourceTable.openFolder", async () => {
      const defaultUri: vscode.Uri | undefined = await defaultFolderUriForOpenDialog(context);
      const picked: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Open Godot .tres folder",
        defaultUri,
      });
      if (picked === undefined || picked.length === 0) {
        return;
      }
      const rootPath: string = picked[0].fsPath;
      await context.globalState.update(LAST_ROOT_FOLDER_KEY, rootPath);
      await openPanel(context, rootPath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("godotResourceTable.refresh", async () => {
      if (session === undefined) {
        return;
      }
      await pushData(context, session.rootPath, session.panel);
    })
  );
}

export function deactivate(): void {
  session?.disposeWatch.dispose();
  session?.panel.dispose();
  session = undefined;
}

async function openPanel(context: vscode.ExtensionContext, rootPath: string): Promise<void> {
  if (session !== undefined) {
    session.disposeWatch.dispose();
    session.panel.dispose();
  }

  const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel(
    PANEL_VIEW_TYPE,
    `Godot resources · ${path.basename(rootPath)}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    }
  );

  panel.webview.html = getHtml(panel.webview, context.extensionUri);

  const themeListener: vscode.Disposable = vscode.window.onDidChangeActiveColorTheme(() => {
    void panel.webview.postMessage({
      type: "themeColorScheme",
      colorScheme: webviewColorScheme(),
    });
  });

  const disposeWatch: vscode.Disposable = startFolderWatch(rootPath, async () => {
    if (Date.now() < ignoreWatchUntilMs) {
      return;
    }
    await pushData(context, rootPath, panel);
  });

  panel.onDidDispose(() => {
    disposeWatch.dispose();
    themeListener.dispose();
    if (session?.panel === panel) {
      session = undefined;
      void vscode.commands.executeCommand("setContext", CTX_ACTIVE, false);
    }
  });

  session = { rootPath, panel, disposeWatch };
  void vscode.commands.executeCommand("setContext", CTX_ACTIVE, true);

  panel.webview.onDidReceiveMessage(
    async (msg: WebviewMessage) => {
      if (msg.type === "refresh") {
        await pushData(context, rootPath, panel);
      }
      if (msg.type === "colWidths" && msg.colWidths !== undefined) {
        await context.workspaceState.update(colWidthKey(rootPath), msg.colWidths);
      }
      if (msg.type === "frozenColumns") {
        await context.workspaceState.update(
          frozenThroughColKey(rootPath),
          msg.frozenThroughCol === null || msg.frozenThroughCol === ""
            ? undefined
            : msg.frozenThroughCol
        );
      }
      if (msg.type === "columnOrder" && Array.isArray(msg.columns)) {
        await context.workspaceState.update(columnOrderKey(rootPath), msg.columns);
      }
      if (msg.type === "applyEdit") {
        await handleApplyEdit(context, rootPath, panel, msg);
      }
    },
    undefined,
    context.subscriptions
  );

  await pushData(context, rootPath, panel);
}

type WebviewMessage =
  | { type: "refresh" }
  | { type: "colWidths"; colWidths: Record<string, number> }
  | { type: "frozenColumns"; frozenThroughCol: string | null }
  | { type: "columnOrder"; columns: string[] }
  | {
      type: "applyEdit";
      absPath: string;
      col: string;
      newText: string;
      prevDisplay: string;
      kind: string;
    };

function colWidthKey(rootPath: string): string {
  return `godotResourceTable.colWidths:${rootPath}`;
}

function frozenThroughColKey(rootPath: string): string {
  return `godotResourceTable.frozenThroughCol:${rootPath}`;
}

function columnOrderKey(rootPath: string): string {
  return `godotResourceTable.columnOrder:${rootPath}`;
}

/** Apply saved column order; unknown keys are dropped, new keys keep model order after merged tail. */
function mergeColumnOrder(base: readonly string[], saved: readonly string[] | undefined): string[] {
  if (saved === undefined || saved.length === 0) {
    return [...base];
  }
  const baseSet: Set<string> = new Set(base);
  const seen: Set<string> = new Set();
  const out: string[] = [];
  for (const k of saved) {
    if (baseSet.has(k) && !seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  for (const k of base) {
    if (!seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  return out;
}

async function pushData(
  context: vscode.ExtensionContext,
  rootPath: string,
  panel: vscode.WebviewPanel
): Promise<void> {
  const files: string[] = await collectTresFiles(rootPath);
  const payload: GridPayload = await buildGridPayload(rootPath, files);
  const colWidths: Record<string, number> | undefined = context.workspaceState.get(colWidthKey(rootPath));
  let frozenThroughCol: string | undefined = context.workspaceState.get<string>(frozenThroughColKey(rootPath));
  const savedOrder: string[] | undefined = context.workspaceState.get<string[]>(columnOrderKey(rootPath));
  const columnsOrdered: string[] = mergeColumnOrder(payload.columns, savedOrder);
  if (
    frozenThroughCol !== undefined &&
    !columnsOrdered.includes(frozenThroughCol)
  ) {
    frozenThroughCol = undefined;
    await context.workspaceState.update(frozenThroughColKey(rootPath), undefined);
  }
  if (payload.errors.length > 0) {
    const sample: string = payload.errors
      .slice(0, 3)
      .map((e: { relPath: string; message: string }) => `${e.relPath}: ${e.message}`)
      .join("\n");
    void vscode.window.showWarningMessage(
      `Some files were skipped (${payload.errors.length}). Example:\n${sample}`
    );
  }
  void panel.webview.postMessage({
    type: "data",
    rootPath,
    columns: columnsOrdered,
    rows: payload.rows,
    colWidths: colWidths ?? {},
    frozenThroughCol: frozenThroughCol ?? null,
  });
}

async function handleApplyEdit(
  context: vscode.ExtensionContext,
  rootPath: string,
  panel: vscode.WebviewPanel,
  msg: Extract<WebviewMessage, { type: "applyEdit" }>
): Promise<void> {
  if (msg.col === COL_FILE || msg.col === COL_SCRIPT_CLASS) {
    return;
  }
  if (!isPathInsideRoot(msg.absPath, rootPath)) {
    void vscode.window.showErrorMessage("Invalid path.");
    await pushData(context, rootPath, panel);
    return;
  }
  let text: string;
  try {
    text = await fs.readFile(msg.absPath, "utf8");
  } catch (e) {
    void vscode.window.showErrorMessage(`Read failed: ${String(e)}`);
    await pushData(context, rootPath, panel);
    return;
  }
  const parsed = parseTres(text);
  if (parsed === undefined) {
    void vscode.window.showErrorMessage("Could not parse .tres file.");
    await pushData(context, rootPath, panel);
    return;
  }
  const kind = msg.kind as CellKind;
  if (kind === "readonly") {
    await pushData(context, rootPath, panel);
    return;
  }
  const formatted: string | undefined = await formatPropertyValueForTresEdit(
    rootPath,
    parsed,
    msg.col,
    msg.newText,
    kind
  );
  if (formatted === undefined) {
    void vscode.window.showErrorMessage(`Invalid value for type ${kind}.`);
    await pushData(context, rootPath, panel);
    return;
  }
  const next: string | undefined = patchResourceProperty(parsed, msg.col, formatted);
  if (next === undefined) {
    void vscode.window.showErrorMessage("Could not patch file.");
    await pushData(context, rootPath, panel);
    return;
  }
  try {
    await fs.writeFile(msg.absPath, next, "utf8");
    ignoreWatchUntilMs = Date.now() + 400;
  } catch (e) {
    void vscode.window.showErrorMessage(`Write failed: ${String(e)}`);
    await pushData(context, rootPath, panel);
    return;
  }
  await pushData(context, rootPath, panel);
}

function startFolderWatch(rootPath: string, onChange: () => void | Promise<void>): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void Promise.resolve(onChange());
    }, 350);
  };
  let w: fsSync.FSWatcher;
  try {
    w = fsSync.watch(rootPath, { recursive: true }, (_evt: string, name: string | Buffer | null) => {
      const n: string = name !== null && typeof name === "string" ? name : "";
      if (n.endsWith(".tres") || n === "") {
        debounced();
      }
    });
  } catch {
    return new vscode.Disposable(() => undefined);
  }
  return new vscode.Disposable(() => {
    w.close();
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri: vscode.Uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "grid.js"));
  const styleUri: vscode.Uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "grid.css"));
  const csp: string = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src ${webview.cspSource}`,
  ].join("; ");
  const colorScheme: "light" | "dark" = webviewColorScheme();
  return `<!DOCTYPE html>
<html lang="en" style="color-scheme: ${colorScheme};">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Godot Resource Table</title>
</head>
<body>
  <div class="toolbar" id="toolbar">
    <button type="button" id="btnRefresh">Refresh</button>
    <span class="hint" id="meta"></span>
  </div>
  <div class="wrap">
    <table id="grid">
      <thead><tr></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
