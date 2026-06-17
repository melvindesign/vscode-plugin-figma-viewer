// Parsing d'URL Figma — module sans dépendances (évite les cycles d'import).

// Segments d'URL des différents éditeurs Figma.
const FILE_PATH =
  /\/(?:file|design|board|proto|slides|deck|buzz|sites?|make)\/([A-Za-z0-9]+)(?:\/([^/?#]+))?/i;

export type FigmaFileType = "design" | "figjam" | "slides" | "make" | "buzz" | "sites";

/** Déduit le type d'éditeur Figma à partir de l'URL ou de l'editor_type API. */
export function figmaFileType(urlOrEditorType: string): FigmaFileType {
  const val = urlOrEditorType.toLowerCase();
  // Segment de chemin URL (ex: figma.com/board/…)
  if (/\/board\/|^figjam$/.test(val)) return "figjam";
  if (/\/(?:slides|deck)\/|^slides$/.test(val)) return "slides";
  if (/\/make\/|^make$/.test(val)) return "make";
  if (/\/buzz\/|^buzz$/.test(val)) return "buzz";
  if (/\/sites?\/|^sites?$/.test(val)) return "sites";
  return "design";
}

/** Nom du fichier SVG correspondant au type de fichier Figma. */
export function figmaFileIcon(type: FigmaFileType): string {
  return `${type}.svg`;
}

/**
 * Analyse une URL Figma collée par l'utilisateur. Renvoie la clé et un nom
 * lisible (déduit du slug de l'URL), ou `undefined` si ce n'est pas une URL de
 * fichier Figma valide.
 */
export function parseFigmaFileUrl(
  input: string
): { key: string; name: string; url: string } | undefined {
  const trimmed = input.trim();
  if (!/figma\.com\//i.test(trimmed)) {
    return undefined;
  }
  const match = trimmed.match(FILE_PATH);
  const key = match?.[1];
  if (!key || key.toLowerCase() === "new") {
    return undefined;
  }
  let name = "Fichier Figma";
  if (match?.[2]) {
    try {
      name = decodeURIComponent(match[2]).replace(/-/g, " ").trim() || name;
    } catch {
      name = match[2].replace(/-/g, " ");
    }
  }
  return { key, name, url: trimmed };
}
