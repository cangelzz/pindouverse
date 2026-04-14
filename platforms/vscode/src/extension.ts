import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    PindouEditorProvider.register(context)
  );

  // Command: new project (opens blank canvas immediately, no save dialog)
  context.subscriptions.push(
    vscode.commands.registerCommand("pindouverse.newProject", async () => {
      const tmpDir = context.globalStorageUri;
      await vscode.workspace.fs.createDirectory(tmpDir);
      const tmpUri = vscode.Uri.joinPath(tmpDir, `untitled_${Date.now()}.pindou`);

      const emptyProject = {
        version: 1,
        canvasSize: { width: 52, height: 52 },
        canvasData: Array.from({ length: 52 }, () =>
          Array.from({ length: 52 }, () => ({ colorIndex: null }))
        ),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await vscode.workspace.fs.writeFile(
        tmpUri,
        Buffer.from(JSON.stringify(emptyProject, null, 2))
      );
      await vscode.commands.executeCommand("vscode.openWith", tmpUri, "pindouverse.editor");
    })
  );

  // Command: open existing .pindou file
  context.subscriptions.push(
    vscode.commands.registerCommand("pindouverse.openProject", async () => {
      const uris = await vscode.window.showOpenDialog({
        filters: { "PindouVerse Project": ["pindou"] },
        canSelectMany: false,
      });
      if (!uris || uris.length === 0) return;
      await vscode.commands.executeCommand("vscode.openWith", uris[0], "pindouverse.editor");
    })
  );
}

export function deactivate() {}

class PindouEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType = "pindouverse.editor";

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      PindouEditorProvider.viewType,
      new PindouEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
      ],
    };

    // Set webview HTML
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Send initial document content to webview
    const sendDocument = () => {
      webviewPanel.webview.postMessage({
        type: "loadDocument",
        content: document.getText(),
        path: document.uri.fsPath,
      });
    };

    // Listen for document changes (external edits)
    const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendDocument();
      }
    });

    // Listen for messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          sendDocument();
          break;

        case "save": {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            msg.content
          );
          await vscode.workspace.applyEdit(edit);
          await document.save();
          break;
        }

        case "showSaveDialog": {
          const filters: Record<string, string[]> = {};
          for (const f of msg.filters || []) {
            filters[f.name] = f.extensions;
          }
          const uri = await vscode.window.showSaveDialog({
            filters,
            defaultUri: msg.defaultPath ? vscode.Uri.file(msg.defaultPath) : undefined,
          });
          webviewPanel.webview.postMessage({
            type: "dialogResult",
            requestId: msg.requestId,
            path: uri?.fsPath || null,
          });
          break;
        }

        case "showOpenDialog": {
          const filters: Record<string, string[]> = {};
          for (const f of msg.filters || []) {
            filters[f.name] = f.extensions;
          }
          const uris = await vscode.window.showOpenDialog({
            filters,
            canSelectMany: msg.multiple || false,
          });
          webviewPanel.webview.postMessage({
            type: "dialogResult",
            requestId: msg.requestId,
            path: uris?.[0]?.fsPath || null,
          });
          break;
        }

        case "writeFile": {
          try {
            const uri = vscode.Uri.file(msg.path);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(msg.data, "base64"));
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: true,
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: false,
              error: e.message,
            });
          }
          break;
        }

        case "readFile": {
          try {
            const uri = vscode.Uri.file(msg.path);
            const data = await vscode.workspace.fs.readFile(uri);
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: true,
              data: Buffer.from(data).toString("base64"),
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: false,
              error: e.message,
            });
          }
          break;
        }

        case "getAutosaveDir": {
          const dir = path.join(
            path.dirname(document.uri.fsPath),
            ".pindou_autosave"
          );
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          webviewPanel.webview.postMessage({
            type: "fileResult",
            requestId: msg.requestId,
            success: true,
            data: dir,
          });
          break;
        }

        case "info":
          vscode.window.showInformationMessage(msg.message);
          break;

        case "error":
          vscode.window.showErrorMessage(msg.message);
          break;

        case "getGitHubToken": {
          try {
            // Use VS Code's built-in GitHub authentication
            // createIfNone: true prompts user to sign in if not already
            const session = await vscode.authentication.getSession(
              "github",
              ["gist"],
              { createIfNone: msg.createIfNone ?? false },
            );
            webviewPanel.webview.postMessage({
              type: "githubToken",
              requestId: msg.requestId,
              token: session?.accessToken || null,
              account: session ? { label: session.account.label, id: session.account.id } : null,
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "githubToken",
              requestId: msg.requestId,
              token: null,
              account: null,
              error: e.message,
            });
          }
          break;
        }

        case "clearGitHubToken": {
          // VS Code doesn't have a direct "logout" — we just tell the webview to clear
          webviewPanel.webview.postMessage({
            type: "githubTokenCleared",
            requestId: msg.requestId,
          });
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocSub.dispose();
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");

    // Vite builds a single IIFE bundle with deterministic filenames
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "assets", "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "assets", "style.css"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="zh" style="height:100%;margin:0;padding:0;overflow:hidden">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; connect-src https://api.github.com;">
  <link rel="stylesheet" href="${styleUri}">
  <title>PindouVerse</title>
  <style>html,body{height:100%;margin:0;padding:0;overflow:hidden}#root{height:100%;overflow:hidden}#root>div{height:100%!important;max-height:100%!important}</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
