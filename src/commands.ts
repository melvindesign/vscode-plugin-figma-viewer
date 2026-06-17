import * as vscode from "vscode";
import { AuthError, FigmaAuth } from "./auth/figmaAuth";
import { openInIntegratedBrowser } from "./browser";
import { parseFigmaFileUrl } from "./figmaUrl";
import { RecentStore } from "./recents";
import { DraftStore } from "./drafts";
import { FileNode, TeamNode } from "./tree/filesProvider";

/* Création de fichier désactivée — utiliser « Ajouter le lien d'un fichier » à la place.
const NEW_FILE_TYPES: { label: string; url: string; name: string }[] = [
  { label: "$(file) Nouveau fichier Design", url: "https://www.figma.com/file/new", name: "Design sans titre" },
  { label: "$(comment-discussion) Nouveau FigJam", url: "https://www.figma.com/board/new", name: "FigJam sans titre" },
  { label: "$(preview) Nouvelles Slides", url: "https://www.figma.com/slides/new", name: "Slides sans titre" },
  { label: "$(megaphone) Nouveau Buzz", url: "https://www.figma.com/buzz/new", name: "Buzz sans titre" },
  { label: "$(globe) Nouveau Site", url: "https://www.figma.com/site/new", name: "Site sans titre" },
  { label: "$(sparkle) Nouveau Make", url: "https://www.figma.com/make/new", name: "Make sans titre" },
];
*/

/** Extrait un ID d'équipe depuis une URL Figma ou une saisie brute. */
export function parseTeamId(input: string): string | undefined {
  const trimmed = input.trim();
  const match = trimmed.match(/\/team\/(\d+)/);
  if (match) {
    return match[1];
  }
  // ID collé directement.
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

export async function signIn(auth: FigmaAuth): Promise<void> {
  try {
    await auth.signIn();
  } catch (err) {
    if (err instanceof AuthError) {
      vscode.window.showErrorMessage(err.message);
    } else {
      vscode.window.showErrorMessage(
        `Connexion à Figma impossible : ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

export async function signOut(
  auth: FigmaAuth,
  recents: RecentStore,
  drafts: DraftStore
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    "Se déconnecter de Figma ? Cela effacera aussi vos fichiers récents, vos brouillons et vos équipes.",
    { modal: true },
    "Se déconnecter"
  );
  if (confirm !== "Se déconnecter") {
    return;
  }
  await auth.signOut();
  await recents.clear();
  await drafts.clear();
  await vscode.workspace
    .getConfiguration("figmaViewer")
    .update("teams", [], vscode.ConfigurationTarget.Global);
}

export async function addTeam(): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: "Ajouter une équipe Figma",
    prompt: "Collez l'URL de l'équipe (figma.com/files/team/…) ou son ID.",
    placeHolder: "https://www.figma.com/files/team/123456789/Mon-equipe",
    ignoreFocusOut: true,
  });
  if (!input) {
    return;
  }
  const teamId = parseTeamId(input);
  if (!teamId) {
    vscode.window.showErrorMessage(
      "ID d'équipe introuvable dans la saisie. Attendu : une URL contenant /team/<id> ou un ID numérique."
    );
    return;
  }
  const config = vscode.workspace.getConfiguration("figmaViewer");
  const teams = config.get<string[]>("teams", []);
  if (teams.includes(teamId)) {
    vscode.window.showInformationMessage("Cette équipe est déjà ajoutée.");
    return;
  }
  await config.update(
    "teams",
    [...teams, teamId],
    vscode.ConfigurationTarget.Global
  );
}

export async function removeTeam(node: TeamNode): Promise<void> {
  const config = vscode.workspace.getConfiguration("figmaViewer");
  const teams = config.get<string[]>("teams", []);
  await config.update(
    "teams",
    teams.filter((id) => id !== node.teamId),
    vscode.ConfigurationTarget.Global
  );
}

export async function openFile(
  node: FileNode,
  recents: RecentStore
): Promise<void> {
  await openInIntegratedBrowser(node.url);
  await recents.add({ name: node.fileName, url: node.url });
}

export async function addDraft(drafts: DraftStore): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: "Ajouter un brouillon",
    prompt: "Collez le lien d'un fichier Figma existant.",
    placeHolder: "https://www.figma.com/design/AbC123.../Mon-fichier",
    ignoreFocusOut: true,
  });
  if (!input) {
    return;
  }
  const parsed = parseFigmaFileUrl(input);
  if (!parsed) {
    vscode.window.showErrorMessage(
      "Lien Figma invalide. Attendu une URL de fichier (figma.com/file/… ou /design/…)."
    );
    return;
  }
  const name = await vscode.window.showInputBox({
    title: "Nom du brouillon",
    prompt: "Nom affiché dans la liste.",
    value: parsed.name,
    ignoreFocusOut: true,
  });
  if (name === undefined) {
    return;
  }
  await drafts.add({ name: name.trim() || parsed.name, url: parsed.url });
}

export async function removeDraft(
  node: FileNode,
  drafts: DraftStore
): Promise<void> {
  await drafts.remove(node.url);
}

export async function openFileExternal(node: FileNode): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(node.url));
}


/* Création de fichier désactivée — utiliser « Ajouter le lien d'un fichier » à la place.
export async function newFile(drafts: DraftStore, recents: RecentStore): Promise<void> {
  const pick = await vscode.window.showQuickPick(NEW_FILE_TYPES, {
    title: "Nouveau fichier Figma",
    placeHolder: "Type de fichier à créer",
  });
  if (!pick) {
    return;
  }

  await openInIntegratedBrowser(pick.url);

  const status = vscode.window.setStatusBarMessage(
    "$(loading~spin) Création du fichier Figma en cours…"
  );
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  status.dispose();

  const input = await vscode.window.showInputBox({
    title: "Fichier créé ?",
    prompt: "Copiez l'URL depuis la barre d'adresse du navigateur et collez-la ici.",
    placeHolder: "https://www.figma.com/design/AbC123…/Mon-fichier",
    ignoreFocusOut: true,
  });
  if (!input) {
    return;
  }

  const parsed = parseFigmaFileUrl(input);
  if (!parsed) {
    vscode.window.showErrorMessage(
      "Lien Figma invalide. Attendu une URL de fichier (figma.com/design/… ou /file/…)."
    );
    return;
  }

  const name = parsed.name || pick.name;
  await Promise.all([
    drafts.add({ name, url: parsed.url }),
    recents.add({ name, url: parsed.url }),
  ]);
  vscode.window.setStatusBarMessage(`$(bookmark) « ${name} » ajouté aux brouillons et récents`, 5000);
}
*/
