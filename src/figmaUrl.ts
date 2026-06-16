// Parsing d'URL Figma — module sans dépendances (évite les cycles d'import).

// Segments d'URL des différents éditeurs Figma.
const FILE_PATH =
  /\/(?:file|design|board|proto|slides|deck|buzz|sites?|make)\/([A-Za-z0-9]+)(?:\/([^/?#]+))?/i;

/**
 * Clé d'un fichier Figma extraite d'une URL. Renvoie `undefined` pour les URLs
 * de création (`/…/new`) ou les URLs sans clé de fichier.
 */
export function figmaFileKey(url: string): string | undefined {
  const key = url.match(FILE_PATH)?.[1];
  return key && key.toLowerCase() !== "new" ? key : undefined;
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
