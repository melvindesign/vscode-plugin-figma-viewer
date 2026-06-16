import * as vscode from "vscode";
import { figmaFileKey } from "./figmaUrl";

const DEFAULT_OPEN_COMMAND = "workbench.action.browser.open";
const DEFAULT_BRIDGE_PORT = 3788;

interface BridgeTab {
  tabId: string;
  url: string;
  active?: boolean;
}

async function fetchWithTimeout(
  url: string,
  init: { method?: string } = {},
  ms = 1000
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function bridgeBase(): string {
  const port = vscode.workspace
    .getConfiguration("browserBridge")
    .get<number>("httpPort", DEFAULT_BRIDGE_PORT);
  return `http://localhost:${port}`;
}

/** Liste des onglets du navigateur intégré (via l'API HTTP du bridge). */
async function getBridgeTabs(): Promise<BridgeTab[] | undefined> {
  try {
    const res = await fetchWithTimeout(`${bridgeBase()}/tabs`, {});
    if (!res.ok) {
      return undefined;
    }
    const json = (await res.json()) as { ok?: boolean; data?: BridgeTab[] };
    return json.data ?? [];
  } catch {
    return undefined;
  }
}

/** URL de l'onglet actif du navigateur intégré, ou `undefined` si injoignable. */
export async function getIntegratedActiveUrl(): Promise<string | undefined> {
  const tabs = await getBridgeTabs();
  return tabs?.find((t) => t.active)?.url;
}

/**
 * Si le fichier est déjà ouvert dans le navigateur intégré, active l'onglet
 * existant (via l'API HTTP du bridge) au lieu d'en ouvrir un nouveau.
 * Best-effort : renvoie `false` si le bridge est injoignable ou l'onglet absent.
 */
async function activateExistingTab(url: string): Promise<boolean> {
  const key = figmaFileKey(url);
  if (!key) {
    return false;
  }
  const tabs = await getBridgeTabs();
  const tab = tabs?.find((t) => figmaFileKey(t.url) === key);
  if (!tab) {
    return false;
  }
  try {
    const act = await fetchWithTimeout(
      `${bridgeBase()}/tab/activate/${encodeURIComponent(tab.tabId)}`,
      { method: "POST" }
    );
    return act.ok;
  } catch {
    return false;
  }
}

/**
 * Ouvre une URL dans le navigateur via VS Code. On délègue à la commande native
 * `workbench.action.browser.open`, qui route l'URL vers le navigateur configuré.
 * Avant d'ouvrir, on tente de réutiliser un onglet déjà ouvert sur le même
 * fichier. Repli sur `env.openExternal` si la commande échoue.
 */
export async function openInIntegratedBrowser(url: string): Promise<void> {
  if (await activateExistingTab(url)) {
    return;
  }

  const command = vscode.workspace
    .getConfiguration("figmaViewer")
    .get<string>("openCommand", DEFAULT_OPEN_COMMAND);

  try {
    await vscode.commands.executeCommand(command, url);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
