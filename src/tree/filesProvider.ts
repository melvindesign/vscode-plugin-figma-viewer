import * as vscode from "vscode";
import { FigmaApi, FigmaApiError, fileUrl } from "../figmaApi";
import { FigmaAuth } from "../auth/figmaAuth";
import { RecentStore } from "../recents";
import { DraftStore } from "../drafts";

type Node =
  | RecentsNode
  | DraftsNode
  | TeamsNode
  | TeamNode
  | ProjectNode
  | FileNode
  | NewFileNode
  | AddDraftNode
  | AddTeamNode
  | MessageNode;

/** Section « Récents » : fichiers récemment ouverts. */
export class RecentsNode extends vscode.TreeItem {
  constructor() {
    super("Récents", vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "figmaRecents";
    this.iconPath = new vscode.ThemeIcon("history");
  }
}

/** Section « Brouillons » : fichiers Figma enregistrés manuellement. */
export class DraftsNode extends vscode.TreeItem {
  constructor() {
    super("Brouillons", vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "figmaDraftsFolder";
    this.iconPath = new vscode.ThemeIcon("bookmark");
  }
}

/** Section « Équipes » : regroupe les équipes configurées. */
export class TeamsNode extends vscode.TreeItem {
  constructor() {
    super("Équipes", vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "figmaTeamsFolder";
    this.iconPath = new vscode.ThemeIcon("organization");
  }
}

export class TeamNode extends vscode.TreeItem {
  constructor(readonly teamId: string) {
    super(`Équipe ${teamId}`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "figmaTeam";
    this.iconPath = new vscode.ThemeIcon("organization");
  }
}

export class ProjectNode extends vscode.TreeItem {
  constructor(readonly projectId: string, name: string) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "figmaProject";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

export class FileNode extends vscode.TreeItem {
  constructor(
    readonly fileName: string,
    readonly url: string,
    icon: vscode.Uri,
    lastModified?: string,
    contextValue = "figmaFile"
  ) {
    super(fileName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = contextValue;
    this.iconPath = icon;
    this.description = lastModified
      ? new Date(lastModified).toLocaleDateString()
      : undefined;
    this.tooltip = this.url;
    this.command = {
      command: "figmaViewer.openFile",
      title: "Ouvrir le fichier",
      arguments: [this],
    };
  }
}

/**
 * Action « Nouveau fichier » — volontairement distincte d'un FileNode (icône +
 * verte) pour signifier qu'il s'agit d'une création, pas d'un fichier existant.
 */
export class NewFileNode extends vscode.TreeItem {
  constructor() {
    super("Nouveau fichier", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "figmaNewFile";
    this.iconPath = new vscode.ThemeIcon(
      "add",
      new vscode.ThemeColor("charts.green")
    );
    this.description = "créer";
    this.tooltip = "Créer un nouveau fichier Figma";
    this.command = {
      command: "figmaViewer.newFile",
      title: "Nouveau fichier",
    };
  }
}

/** Action « Ajouter le lien d'un fichier » dans la section Brouillons. */
export class AddDraftNode extends vscode.TreeItem {
  constructor() {
    super("Ajouter le lien d'un fichier", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "figmaAddDraft";
    this.iconPath = new vscode.ThemeIcon("link");
    this.tooltip = "Coller le lien d'un fichier Figma existant";
    this.command = {
      command: "figmaViewer.addDraft",
      title: "Ajouter le lien d'un fichier",
    };
  }
}

/** Action « Ajouter une équipe » dans la section Équipes. */
export class AddTeamNode extends vscode.TreeItem {
  constructor() {
    super("Ajouter une équipe", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "figmaAddTeam";
    this.iconPath = new vscode.ThemeIcon(
      "add",
      new vscode.ThemeColor("charts.green")
    );
    this.tooltip = "Coller l'URL (ou l'ID) d'une équipe Figma";
    this.command = {
      command: "figmaViewer.addTeam",
      title: "Ajouter une équipe",
    };
  }
}

/** Élément non interactif (erreur, état vide). */
class MessageNode extends vscode.TreeItem {
  constructor(label: string, icon = "info") {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class FilesProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    Node | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly figmaIcon: vscode.Uri;

  constructor(
    private readonly api: FigmaApi,
    extensionUri: vscode.Uri,
    private readonly recents: RecentStore,
    private readonly drafts: DraftStore,
    private readonly auth: FigmaAuth
  ) {
    this.figmaIcon = vscode.Uri.joinPath(extensionUri, "media", "figma.svg");
    this.recents.onDidChange(() => this.refresh());
    this.drafts.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    try {
      if (!element) {
        return await this.getRoot();
      }
      if (element instanceof RecentsNode) {
        return this.getRecents();
      }
      if (element instanceof DraftsNode) {
        return this.getDrafts();
      }
      if (element instanceof TeamsNode) {
        return this.getTeams();
      }
      if (element instanceof TeamNode) {
        return await this.getTeamChildren(element.teamId);
      }
      if (element instanceof ProjectNode) {
        return await this.getProjectChildren(element.projectId);
      }
      return [];
    } catch (err) {
      if (err instanceof FigmaApiError && err.needsAuth) {
        return [new MessageNode("Session expirée — reconnectez-vous.", "warning")];
      }
      const message = err instanceof Error ? err.message : String(err);
      return [new MessageNode(message, "error")];
    }
  }

  private async getRoot(): Promise<Node[]> {
    // Déconnecté : vue vide → le panneau « Se connecter » (viewsWelcome) s'affiche.
    if (!(await this.auth.isAuthenticated())) {
      return [];
    }
    const nodes: Node[] = [];
    if (this.recents.list().length > 0) {
      nodes.push(new RecentsNode());
    }
    // Sections toujours visibles (points d'ajout).
    nodes.push(new DraftsNode());
    nodes.push(new TeamsNode());
    return nodes;
  }

  private getRecents(): Node[] {
    return this.recents
      .list()
      .map((f) => new FileNode(f.name, f.url, this.figmaIcon));
  }

  private getDrafts(): Node[] {
    // Actions en tête (ajouter un lien existant, créer un nouveau fichier),
    // puis les brouillons enregistrés.
    const nodes: Node[] = [new AddDraftNode(), new NewFileNode()];
    nodes.push(
      ...this.drafts
        .list()
        .map(
          (f) =>
            new FileNode(f.name, f.url, this.figmaIcon, undefined, "figmaDraftFile")
        )
    );
    return nodes;
  }

  private getTeams(): Node[] {
    const teams = vscode.workspace
      .getConfiguration("figmaViewer")
      .get<string[]>("teams", []);
    if (teams.length === 0) {
      // Explication + bouton d'ajout quand aucune équipe n'est configurée.
      return [
        new MessageNode(
          "Dans Figma, ouvrez votre équipe (barre latérale gauche).",
          "info"
        ),
        new MessageNode(
          "Copiez l'URL : figma.com/files/team/123456789/Nom",
          "link"
        ),
        new MessageNode("Le numéro est l'identifiant de l'équipe.", "info"),
        new AddTeamNode(),
      ];
    }
    return teams.map((id) => new TeamNode(id));
  }

  private async getTeamChildren(teamId: string): Promise<Node[]> {
    const projects = await this.api.getTeamProjects(teamId);
    // Action de création tout en haut de l'équipe uniquement.
    const nodes: Node[] = [new NewFileNode()];
    if (projects.length === 0) {
      nodes.push(new MessageNode("Aucun projet dans cette équipe."));
    } else {
      nodes.push(...projects.map((p) => new ProjectNode(p.id, p.name)));
    }
    return nodes;
  }

  private async getProjectChildren(projectId: string): Promise<Node[]> {
    const files = await this.api.getProjectFiles(projectId);
    if (files.length === 0) {
      return [new MessageNode("Aucun fichier dans ce projet.")];
    }
    return files.map(
      (f) => new FileNode(f.name, fileUrl(f.key), this.figmaIcon, f.last_modified)
    );
  }
}
