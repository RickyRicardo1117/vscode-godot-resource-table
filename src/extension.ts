import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { COL_FILE, COL_SCRIPT_CLASS, buildGridPayload, type GridPayload } from "./model";
import { formatForTres } from "./tres/classify";
import { parseTres } from "./tres/parse";
import { patchResourceProperty } from "./tres/patch";
import { collectTresFiles, isPathInsideRoot } from "./tres/walk";

const PANEL_VIEW_TYPE: string = "godotResourceTable.panel";
const CTX_ACTIVE: string = "godotResourceTable.panelActive";

interface PanelSession {
  readonly rootPath: string;
  panel: vscode.WebviewPanel;
  disposeWatch: vscode.Disposable;
}

let session: PanelSession | undefined;
let ignoreWatchUntilMs: number = 0;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("godotResourceTable.openFolder", async () => {
      const picked: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Open Godot .tres folder",
      });
      if (picked === undefined || picked.length === 0) {
        return;
      }
      const rootPath: string = picked[0].fsPath;
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

  const disposeWatch: vscode.Disposable = startFolderWatch(rootPath, async () => {
    if (Date.now() < ignoreWatchUntilMs) {
      return;
    }
    await pushData(context, rootPath, panel);
  });

  panel.onDidDispose(() => {
    disposeWatch.dispose();
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

async function pushData(
  context: vscode.ExtensionContext,
  rootPath: string,
  panel: vscode.WebviewPanel
): Promise<void> {
  const files: string[] = await collectTresFiles(rootPath);
  const payload: GridPayload = await buildGridPayload(rootPath, files);
  const colWidths: Record<string, number> | undefined = context.workspaceState.get(colWidthKey(rootPath));
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
    columns: payload.columns,
    rows: payload.rows,
    colWidths: colWidths ?? {},
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
    return;
  }
  let text: string;
  try {
    text = await fs.readFile(msg.absPath, "utf8");
  } catch (e) {
    void vscode.window.showErrorMessage(`Read failed: ${String(e)}`);
    return;
  }
  const parsed = parseTres(text);
  if (parsed === undefined) {
    void vscode.window.showErrorMessage("Could not parse .tres file.");
    return;
  }
  const kind = msg.kind as "bool" | "int" | "float" | "string" | "readonly";
  if (kind === "readonly") {
    return;
  }
  const formatted: string | undefined = formatForTres(kind, msg.newText);
  if (formatted === undefined) {
    void vscode.window.showErrorMessage(`Invalid value for type ${kind}.`);
    await pushData(context, rootPath, panel);
    return;
  }
  const next: string | undefined = patchResourceProperty(parsed, msg.col, formatted);
  if (next === undefined) {
    void vscode.window.showErrorMessage("Could not patch file.");
    return;
  }
  try {
    await fs.writeFile(msg.absPath, next, "utf8");
    ignoreWatchUntilMs = Date.now() + 400;
  } catch (e) {
    void vscode.window.showErrorMessage(`Write failed: ${String(e)}`);
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
  return `<!DOCTYPE html>
<html lang="en">
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
