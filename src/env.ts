import * as fs from "fs";
import * as path from "path";

export interface FigmaEnv {
  clientId?: string;
  clientSecret?: string;
  callbackPort: number;
  scopes: string;
}

const DEFAULT_PORT = 53111;
// `projects:read` est nécessaire pour lister équipes → projets → fichiers, et
// n'est disponible que pour les apps OAuth *privées* (à activer dans l'app).
const DEFAULT_SCOPES = "projects:read";

/**
 * Parse minimaliste d'un fichier `.env` (KEY=VALUE par ligne, `#` = commentaire).
 * Aucune dépendance externe.
 */
function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Retire les guillemets entourants éventuels.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Charge les identifiants OAuth (les nôtres) depuis le `.env` embarqué à la
 * racine de l'extension, avec repli sur `process.env`. L'utilisateur final n'a
 * rien à configurer : ce `.env` est fourni par le plugin.
 *
 * @param extensionPath chemin d'installation de l'extension (context.extensionPath)
 */
export function loadEnv(extensionPath: string): FigmaEnv {
  const fromFile: Record<string, string> = {};

  const envPath = path.join(extensionPath, ".env");
  try {
    if (fs.existsSync(envPath)) {
      Object.assign(fromFile, parseDotenv(fs.readFileSync(envPath, "utf8")));
    }
  } catch {
    // .env illisible : on ignore et on tentera process.env.
  }

  const pick = (key: string): string | undefined => {
    const value = fromFile[key] ?? process.env[key];
    return value && value.trim() ? value.trim() : undefined;
  };

  const portRaw = pick("FIGMA_CALLBACK_PORT");
  const port = portRaw ? Number.parseInt(portRaw, 10) : DEFAULT_PORT;

  return {
    clientId: pick("FIGMA_CLIENT_ID"),
    clientSecret: pick("FIGMA_CLIENT_SECRET"),
    callbackPort: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
    scopes: pick("FIGMA_SCOPES") ?? DEFAULT_SCOPES,
  };
}
