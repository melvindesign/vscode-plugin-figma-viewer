import * as http from "http";
import { AddressInfo } from "net";
import * as vscode from "vscode";
import { loadEnv } from "../env";
import { openInIntegratedBrowser } from "../browser";
import { createPkce, randomState } from "./pkce";

const SECRET_KEY = "figmaViewer.tokens";
const AUTHORIZE_URL = "https://www.figma.com/oauth";
const TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const REFRESH_URL = "https://api.figma.com/v1/oauth/refresh";
// Marge de sécurité avant l'expiration réelle pour rafraîchir en avance.
const EXPIRY_SKEW_MS = 60_000;
// Délai max d'attente du callback OAuth.
const CALLBACK_TIMEOUT_MS = 300_000;

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch millis. */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Erreur attendue (configuration / annulation) : on affiche le message tel quel
 * à l'utilisateur, sans trace technique.
 */
export class AuthError extends Error {}

export class FigmaAuth {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Émis à chaque connexion / déconnexion. */
  readonly onDidChangeSession = this._onDidChange.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly extensionPath: string
  ) {}

  async isAuthenticated(): Promise<boolean> {
    return (await this.readTokens()) !== undefined;
  }

  /** Lance le flow OAuth complet et stocke les jetons. */
  async signIn(): Promise<void> {
    const env = loadEnv(this.extensionPath);
    if (!env.clientId || !env.clientSecret) {
      throw new AuthError(
        "Configuration OAuth de l'extension absente. Le fichier .env embarqué (FIGMA_CLIENT_ID / FIGMA_CLIENT_SECRET) est introuvable."
      );
    }

    const pkce = createPkce();
    const state = randomState();

    const { server, port, codePromise } = await this.startCallbackServer(
      env.callbackPort,
      state
    );

    try {
      const redirectUri = `http://localhost:${port}/callback`;
      const authUrl =
        `${AUTHORIZE_URL}?` +
        new URLSearchParams({
          client_id: env.clientId,
          redirect_uri: redirectUri,
          scope: env.scopes,
          state,
          response_type: "code",
          code_challenge: pkce.challenge,
          code_challenge_method: "S256",
        }).toString();

      await openInIntegratedBrowser(authUrl);

      // Pas de notification (`withProgress`) ici : elle mettrait en pause le
      // navigateur intégré. On indique l'attente via la barre d'état et on
      // attend le callback avec un délai max.
      vscode.window.setStatusBarMessage(
        "$(sync~spin) Connexion à Figma en cours…",
        codePromise.catch(() => undefined)
      );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AuthError("Délai de connexion dépassé.")),
          CALLBACK_TIMEOUT_MS
        );
      });

      let code: string;
      try {
        code = await Promise.race([codePromise, timeout]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }

      const tokens = await this.exchangeCode(
        env.clientId,
        env.clientSecret,
        redirectUri,
        code,
        pkce.verifier
      );
      await this.writeTokens(tokens);
      this._onDidChange.fire();
    } finally {
      server.close();
    }
  }

  async signOut(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    this._onDidChange.fire();
  }

  /**
   * Renvoie un access token valide, rafraîchi automatiquement si nécessaire.
   * Renvoie `undefined` si l'utilisateur n'est pas connecté.
   */
  async getAccessToken(): Promise<string | undefined> {
    const tokens = await this.readTokens();
    if (!tokens) {
      return undefined;
    }
    if (Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) {
      return tokens.accessToken;
    }
    const env = loadEnv(this.extensionPath);
    if (!env.clientId || !env.clientSecret) {
      return tokens.accessToken; // Pas de quoi rafraîchir : on tente l'ancien.
    }
    try {
      const refreshed = await this.refresh(
        env.clientId,
        env.clientSecret,
        tokens.refreshToken
      );
      await this.writeTokens(refreshed);
      return refreshed.accessToken;
    } catch {
      // Refresh échoué : on force une reconnexion.
      await this.signOut();
      return undefined;
    }
  }

  // --- Internes ---------------------------------------------------------

  private async exchangeCode(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    code: string,
    verifier: string
  ): Promise<StoredTokens> {
    const body = new URLSearchParams({
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
      code_verifier: verifier,
    });
    return this.postToken(TOKEN_URL, clientId, clientSecret, body);
  }

  private async refresh(
    clientId: string,
    clientSecret: string,
    refreshToken: string
  ): Promise<StoredTokens> {
    const body = new URLSearchParams({ refresh_token: refreshToken });
    const tokens = await this.postToken(
      REFRESH_URL,
      clientId,
      clientSecret,
      body
    );
    // L'endpoint refresh peut ne pas renvoyer de nouveau refresh_token.
    if (!tokens.refreshToken) {
      tokens.refreshToken = refreshToken;
    }
    return tokens;
  }

  private async postToken(
    url: string,
    clientId: string,
    clientSecret: string,
    body: URLSearchParams
  ): Promise<StoredTokens> {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AuthError(
        `Échec de l'authentification Figma (${res.status}). ${text}`.trim()
      );
    }
    const data = (await res.json()) as TokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 0) * 1000,
    };
  }

  private async readTokens(): Promise<StoredTokens | undefined> {
    const raw = await this.secrets.get(SECRET_KEY);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as StoredTokens;
    } catch {
      return undefined;
    }
  }

  private async writeTokens(tokens: StoredTokens): Promise<void> {
    await this.secrets.store(SECRET_KEY, JSON.stringify(tokens));
  }

  /**
   * Démarre un serveur HTTP local qui capte la redirection OAuth.
   * Résout `codePromise` avec le `code` une fois le callback reçu et validé.
   */
  private startCallbackServer(
    preferredPort: number,
    expectedState: string
  ): Promise<{
    server: http.Server;
    port: number;
    codePromise: Promise<string>;
  }> {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      const reply = (title: string, message: string) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
            `<title>${title}</title><style>body{font-family:-apple-system,Segoe UI,sans-serif;` +
            `background:#1e1e1e;color:#ddd;display:flex;height:100vh;margin:0;align-items:center;` +
            `justify-content:center}div{text-align:center}h1{font-weight:600}</style></head>` +
            `<body><div><h1>${title}</h1><p>${message}</p></div></body></html>`
        );
      };

      if (error) {
        reply("Connexion refusée", `Figma a renvoyé : ${error}.`);
        rejectCode(new AuthError(`Figma a refusé la connexion : ${error}.`));
        return;
      }
      if (!code || state !== expectedState) {
        reply("Erreur", "Réponse OAuth invalide (state incorrect).");
        rejectCode(new AuthError("Réponse OAuth invalide (state incorrect)."));
        return;
      }
      reply("Connexion réussie", "Vous pouvez fermer cet onglet et revenir dans VS Code.");
      resolveCode(code);
    });

    return new Promise((resolve, reject) => {
      server.once("error", (err) => reject(err));
      server.listen(preferredPort, "127.0.0.1", () => {
        const port = (server.address() as AddressInfo).port;
        resolve({ server, port, codePromise });
      });
    });
  }
}
