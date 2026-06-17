import * as vscode from "vscode";
import { FigmaAuth } from "./auth/figmaAuth";
import { FigmaApi } from "./figmaApi";
import { RecentStore } from "./recents";
import { DraftStore } from "./drafts";
import { FilesProvider } from "./tree/filesProvider";
import * as commands from "./commands";

export function activate(context: vscode.ExtensionContext): void {
  const auth = new FigmaAuth(context.secrets, context.extensionPath);
  const api = new FigmaApi(auth);
  const recents = new RecentStore(context.workspaceState);
  const drafts = new DraftStore(context.globalState);
  const provider = new FilesProvider(
    api,
    context.extensionUri,
    recents,
    drafts,
    auth
  );

  const view = vscode.window.createTreeView("figmaViewer.files", {
    treeDataProvider: provider,
  });

  async function updateContext(): Promise<void> {
    const authed = await auth.isAuthenticated();
    await vscode.commands.executeCommand(
      "setContext",
      "figmaViewer.authenticated",
      authed
    );
  }

  const refreshAll = async () => {
    await updateContext();
    provider.refresh();
  };

  context.subscriptions.push(
    view,
    auth.onDidChangeSession(() => void refreshAll()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("figmaViewer.teams")) {
        void refreshAll();
      }
    }),
    vscode.commands.registerCommand("figmaViewer.signIn", () =>
      commands.signIn(auth)
    ),
    vscode.commands.registerCommand("figmaViewer.signOut", () =>
      commands.signOut(auth, recents, drafts)
    ),
    vscode.commands.registerCommand("figmaViewer.refresh", () =>
      provider.refresh()
    ),
    vscode.commands.registerCommand("figmaViewer.addTeam", () =>
      commands.addTeam()
    ),
    vscode.commands.registerCommand("figmaViewer.removeTeam", (node) =>
      commands.removeTeam(node)
    ),
    vscode.commands.registerCommand("figmaViewer.openFile", (node) =>
      commands.openFile(node, recents)
    ),
    vscode.commands.registerCommand("figmaViewer.openFileExternal", (node) =>
      commands.openFileExternal(node)
    ),
    vscode.commands.registerCommand("figmaViewer.newFile", () =>
      commands.newFile(drafts, context.extensionUri)
    ),
    vscode.commands.registerCommand("figmaViewer.addDraft", () =>
      commands.addDraft(drafts)
    ),
    vscode.commands.registerCommand("figmaViewer.removeDraft", (node) =>
      commands.removeDraft(node, drafts)
    )
  );

  void updateContext();
}

export function deactivate(): void {
  // Rien à nettoyer : tout est dans context.subscriptions.
}
