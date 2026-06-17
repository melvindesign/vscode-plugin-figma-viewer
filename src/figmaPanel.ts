import * as vscode from "vscode";
import { parseFigmaFileUrl, figmaFileKey } from "./figmaUrl";

const FIGMA_ORIGINS = ["https://www.figma.com", "https://figma.com"];

/**
 * Panneau navigateur VS Code (WebviewPanel + iframe Figma).
 *
 * Écoute tous les `postMessage` émis par figma.com pour capturer
 * automatiquement la clé de fichier dès que Figma la diffuse.
 * Si Figma n'envoie rien d'exploitable, un bouton "Enregistrer" dans
 * la toolbar permet de coller l'URL manuellement en un clic.
 *
 * Résout avec l'URL capturée, ou `undefined` si le panneau est fermé.
 */
export class FigmaPanel {
  private readonly panel: vscode.WebviewPanel;
  private resolve: ((url: string | undefined) => void) | undefined;

  private constructor(
    extensionUri: vscode.Uri,
    url: string,
    title: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "figmaViewer.browser",
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    this.panel.webview.html = this.buildHtml(
      this.panel.webview,
      extensionUri,
      url
    );
    this.panel.webview.onDidReceiveMessage(this.onMessage, this);
    this.panel.onDidDispose(() => this.resolve?.(undefined));
  }

  /** Ouvre le panneau et attend la capture de l'URL. */
  static open(
    extensionUri: vscode.Uri,
    url: string,
    title: string
  ): Promise<string | undefined> {
    const p = new FigmaPanel(extensionUri, url, title);
    return p.waitForCapture();
  }

  private waitForCapture(): Promise<string | undefined> {
    return new Promise((r) => (this.resolve = r));
  }

  private onMessage(msg: {
    type: string;
    payload?: unknown;
  }): void {
    switch (msg.type) {
      case "figma-post-message":
        this.tryExtractFromFigmaEvent(msg.payload);
        break;

      case "iframe-navigated":
        // La navigation a eu lieu : Figma a peut-être envoyé la clé juste
        // avant via postMessage. Si pas encore capturé, on reste en attente.
        break;

      case "save-url": {
        // L'utilisateur a cliqué "Enregistrer" dans la toolbar.
        const raw =
          typeof msg.payload === "string" ? msg.payload.trim() : "";
        const parsed = parseFigmaFileUrl(raw);
        if (parsed) {
          this.capture(parsed.url);
        }
        break;
      }
    }
  }

  /**
   * Analyse les données brutes d'un postMessage figma.com pour en extraire
   * une clé de fichier ou une URL complète.
   *
   * Figma émet notamment un message `{ type: 'INITIAL_LOAD', fileKey: '...' }`
   * et d'autres événements contenant la clé de façon récursive.
   */
  private tryExtractFromFigmaEvent(payload: unknown): void {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const key = this.findKey(payload as Record<string, unknown>);
    if (key) {
      // On reconstruit l'URL avec la clé ; le segment exact (board/file/…)
      // n'est pas critique pour le stockage (on l'a dans l'URL du panneau).
      this.capture(`https://www.figma.com/board/${key}`);
    }
  }

  /** Cherche `fileKey` récursivement dans un objet JSON. */
  private findKey(obj: Record<string, unknown>, depth = 0): string | undefined {
    if (depth > 4) {
      return undefined;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (
        (k === "fileKey" || k === "file_key") &&
        typeof v === "string" &&
        v.length > 4
      ) {
        return v;
      }
      if (typeof v === "string" && figmaFileKey(v)) {
        return figmaFileKey(v);
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const found = this.findKey(v as Record<string, unknown>, depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  private capture(url: string): void {
    if (!this.resolve) {
      return;
    }
    this.resolve(url);
    this.resolve = undefined;
    // On laisse le panneau ouvert pour que l'utilisateur reste dans Figma.
  }

  private buildHtml(
    _webview: vscode.Webview,
    _extensionUri: vscode.Uri,
    url: string
  ): string {
    const nonce = crypto.randomUUID().replace(/-/g, "");

    // On n'ajoute qu'une restriction minimale : on autorise les scripts
    // (via nonce) et les styles inline, sans bloquer les iframes ni le
    // presse-papiers. Le modèle de sécurité de VS Code s'applique déjà.
    const csp = [
      `script-src 'nonce-${nonce}'`,
      `style-src 'unsafe-inline'`,
      `frame-src https://www.figma.com https://figma.com https://*.figma.com`,
    ].join("; ");

    const originsJson = JSON.stringify(FIGMA_ORIGINS);

    // Permissions accordées à l'iframe Figma (même jeu que le Simple Browser
    // de VS Code, plus les permissions spécifiques à Figma).
    const iframeAllow = [
      "clipboard-read",
      "clipboard-write",
      "fullscreen",
      "camera",
      "microphone",
      "accelerometer",
      "gyroscope",
      "magnetometer",
      "autoplay",
      "encrypted-media",
      "picture-in-picture",
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Figma</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      display: flex;
      flex-direction: column;
      background: #1e1e1e;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 12px;
    }
    #toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      background: var(--vscode-titleBar-activeBackground, #2d2d2d);
      border-bottom: 1px solid var(--vscode-panel-border, #444);
      flex-shrink: 0;
    }
    #status {
      flex: 1;
      color: var(--vscode-descriptionForeground, #999);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #saveBtn {
      display: none;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 2px;
      padding: 4px 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    #saveBtn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
    #frame { flex: 1; border: none; width: 100%; display: block; }
  </style>
</head>
<body>
  <div id="toolbar">
    <span id="status">Créez votre fichier dans Figma…</span>
    <button id="saveBtn">Enregistrer dans les brouillons</button>
  </div>
  <iframe
    id="frame"
    src="${url}"
    allow="${iframeAllow}"
    referrerpolicy="origin"
  ></iframe>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('frame');
    const status = document.getElementById('status');
    const saveBtn = document.getElementById('saveBtn');
    const ORIGINS = ${originsJson};

    let navigated = false;

    // Donne le focus à l'iframe dès que la page est prête pour que
    // le clavier (copier/coller, etc.) fonctionne sans clic préalable.
    window.addEventListener('load', () => frame.focus());

    // Rend le focus à l'iframe si l'utilisateur clique sur la toolbar
    // mais pas sur le bouton (évite de piéger le focus dans la toolbar).
    document.getElementById('toolbar').addEventListener('mousedown', (e) => {
      if (e.target !== saveBtn) {
        e.preventDefault();
        frame.focus();
      }
    });

    // ── Capture des postMessage de Figma ─────────────────────────────────
    window.addEventListener('message', (e) => {
      if (!ORIGINS.some(o => e.origin === o || e.origin.endsWith('.figma.com'))) return;
      vscode.postMessage({ type: 'figma-post-message', payload: e.data });
    });

    // ── Détection de navigation de l'iframe ──────────────────────────────
    frame.addEventListener('load', () => {
      if (!navigated) {
        navigated = true;
        // Focus automatique après chargement initial.
        frame.focus();
        return;
      }
      status.textContent = 'Fichier créé !';
      saveBtn.style.display = 'block';
      vscode.postMessage({ type: 'iframe-navigated' });
    });

    // ── Bouton Enregistrer ───────────────────────────────────────────────
    saveBtn.addEventListener('click', async () => {
      let text = '';
      try {
        text = await navigator.clipboard.readText();
      } catch {
        // Presse-papiers inaccessible dans ce contexte
      }
      vscode.postMessage({ type: 'save-url', payload: text });
    });
  </script>
</body>
</html>`;
  }
}
