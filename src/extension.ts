import * as vscode from "vscode";
import { FigmaAuth } from "./auth/figmaAuth";
import { FigmaApi } from "./figmaApi";
import { RecentStore } from "./recents";
import { DraftStore } from "./drafts";
import { FilesProvider } from "./tree/filesProvider";
import * as commands from "./commands";
import { BridgeHttpServer } from "./mcpServer";
import { parseFigmaFileUrl } from "./figmaUrl";

const bridge = new BridgeHttpServer();

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

  // Barre de statut MCP
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = "figmaViewer.mcpStatus";

  function updateStatusBar(): void {
    if (bridge.isRunning) {
      statusBar.text = `$(plug) MCP :${bridge.port}`;
      statusBar.tooltip = `Figma Bridge MCP actif — ${bridge.endpoint}`;
      statusBar.show();
    } else {
      statusBar.hide();
    }
  }

  async function startMcp(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("figmaViewer.mcp");
    const port = cfg.get<number>("port", 7346);
    const requireAuth = cfg.get<boolean>("requireAuth", false);
    await bridge.start(port, requireAuth);
    updateStatusBar();
    void vscode.window.showInformationMessage(
      `Figma Bridge MCP démarré sur le port ${bridge.port}`
    );
  }

  async function stopMcp(): Promise<void> {
    await bridge.stop();
    updateStatusBar();
    void vscode.window.showInformationMessage("Figma Bridge MCP arrêté.");
  }

  bridge.onAddDraft = async (url: string, name?: string) => {
    const parsed = parseFigmaFileUrl(url);
    if (!parsed) {
      throw new Error(`URL Figma invalide : ${url}`);
    }
    const label = name?.trim() || parsed.name;
    await Promise.all([
      drafts.add({ name: label, url: parsed.url }),
      recents.add({ name: label, url: parsed.url }),
    ]);
    provider.refresh();
  };

  // Démarrage automatique si configuré
  const autoStart = vscode.workspace
    .getConfiguration("figmaViewer.mcp")
    .get<boolean>("autoStart", true);
  if (autoStart) {
    void startMcp();
  }

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
    statusBar,
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
    // Création de fichier désactivée — utiliser figmaViewer.addDraft à la place.
    // vscode.commands.registerCommand("figmaViewer.newFile", () =>
    //   commands.newFile(drafts, recents)
    // ),
    vscode.commands.registerCommand("figmaViewer.addDraft", () =>
      commands.addDraft(drafts)
    ),
    vscode.commands.registerCommand("figmaViewer.removeDraft", (node) =>
      commands.removeDraft(node, drafts)
    ),
    vscode.commands.registerCommand("figmaViewer.mcpStart", () => startMcp()),
    vscode.commands.registerCommand("figmaViewer.mcpStop", () => stopMcp()),
    vscode.commands.registerCommand("figmaViewer.mcpStatus", () => {
      void vscode.window.showInformationMessage(bridge.configSummary());
    })
  );

  void updateContext();
}

export function deactivate(): Promise<void> {
  return bridge.stop();
}
