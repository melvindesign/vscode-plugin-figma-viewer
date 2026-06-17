import * as vscode from "vscode";

const DEFAULT_OPEN_COMMAND = "workbench.action.browser.open";

/**
 * Ouvre une URL dans le navigateur intégré VS Code via la commande configurée.
 * Repli sur `env.openExternal` si la commande échoue.
 */
export async function openInIntegratedBrowser(url: string): Promise<void> {
  const command = vscode.workspace
    .getConfiguration("figmaViewer")
    .get<string>("openCommand", DEFAULT_OPEN_COMMAND);

  try {
    await vscode.commands.executeCommand(command, url);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

