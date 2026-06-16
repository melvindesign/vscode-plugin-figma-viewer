import * as vscode from "vscode";

const KEY = "figmaViewer.draftFiles";

export interface DraftFile {
  name: string;
  url: string;
  addedAt: number;
}

/**
 * Liste de fichiers Figma enregistrés manuellement par l'utilisateur
 * (« Brouillons »/favoris), persistée dans le globalState pour être conservée.
 */
export class DraftStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly state: vscode.Memento) {}

  list(): DraftFile[] {
    return this.state.get<DraftFile[]>(KEY, []);
  }

  has(url: string): boolean {
    return this.list().some((f) => f.url === url);
  }

  async add(file: { name: string; url: string }): Promise<void> {
    if (this.has(file.url)) {
      return;
    }
    const next = [...this.list(), { ...file, addedAt: Date.now() }];
    await this.state.update(KEY, next);
    this._onDidChange.fire();
  }

  async remove(url: string): Promise<void> {
    await this.state.update(
      KEY,
      this.list().filter((f) => f.url !== url)
    );
    this._onDidChange.fire();
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
    this._onDidChange.fire();
  }
}
