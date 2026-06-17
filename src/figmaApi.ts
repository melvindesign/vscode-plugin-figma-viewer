import { FigmaAuth } from "./auth/figmaAuth";

const API_BASE = "https://api.figma.com";

export interface FigmaProject {
  id: string;
  name: string;
}

export interface FigmaFile {
  key: string;
  name: string;
  thumbnail_url?: string;
  last_modified?: string;
  editor_type?: string; // 'figma' | 'figjam' | 'slides' | 'make' | 'buzz' | 'sites'
}

/** Erreur API ; `needsAuth` indique un 401/403 (token invalide ou périmé). */
export class FigmaApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
  get needsAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export class FigmaApi {
  constructor(private readonly auth: FigmaAuth) {}

  async getTeamProjects(teamId: string): Promise<{ name: string; projects: FigmaProject[] }> {
    const data = await this.get<{ name: string; projects: FigmaProject[] }>(
      `/v1/teams/${encodeURIComponent(teamId)}/projects`
    );
    return { name: data.name ?? teamId, projects: data.projects ?? [] };
  }

  async getProjectFiles(projectId: string): Promise<FigmaFile[]> {
    const data = await this.get<{ files: FigmaFile[] }>(
      `/v1/projects/${encodeURIComponent(projectId)}/files`
    );
    return data.files ?? [];
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new FigmaApiError("Non connecté à Figma.", 401);
    }
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new FigmaApiError(
        `Erreur API Figma (${res.status}) sur ${path}. ${text}`.trim(),
        res.status
      );
    }
    return (await res.json()) as T;
  }
}

/** URL web d'un fichier Figma à partir de sa clé et de son type d'éditeur. */
export function fileUrl(key: string, editorType?: string): string {
  const segment = editorTypeToUrlSegment(editorType);
  return `https://www.figma.com/${segment}/${key}`;
}

function editorTypeToUrlSegment(editorType?: string): string {
  switch (editorType?.toLowerCase()) {
    case "figma": return "design";
    case "figjam": return "board";
    case "slides": return "slides";
    case "make": return "make";
    case "buzz": return "buzz";
    case "sites": return "sites";
    default: return "design";
  }
}
