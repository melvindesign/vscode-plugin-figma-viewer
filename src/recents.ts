import * as vscode from "vscode";

const KEY = "figmaViewer.recentFiles";
const MAX = 5;

export interface RecentFile {
  name: string;
  url: string;
  openedAt: number;
}

/** Historique des fichiers récemment ouverts, persisté dans le workspaceState. */
export class RecentStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly state: vscode.Memento) {}

  list(): RecentFile[] {
    return this.state.get<RecentFile[]>(KEY, []);
  }

  /** Ajoute (ou remonte) un fichier en tête, limité à MAX entrées. */
  async add(file: { name: string; url: string }): Promise<void> {
    const without = this.list().filter((f) => f.url !== file.url);
    const next = [{ ...file, openedAt: Date.now() }, ...without].slice(0, MAX);
    await this.state.update(KEY, next);
    this._onDidChange.fire();
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
    this._onDidChange.fire();
  }
}
