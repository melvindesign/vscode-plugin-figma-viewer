import * as vscode from "vscode";
import * as http from "http";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
  type TextContent,
  type ImageContent,
} from "@modelcontextprotocol/sdk/types.js";
import type { AddressInfo } from "net";

export const BROWSER_TOOL_IDS = [
  "open_browser_page",
  "read_page",
  "screenshot_page",
  "navigate_page",
  "click_element",
  "type_in_page",
  "hover_element",
  "drag_element",
  "handle_dialog",
  "run_playwright_code",
] as const;

const SAVE_SCREENSHOT_ID = "save_page_screenshot";

function getAvailableBrowserTools(): vscode.LanguageModelToolInformation[] {
  return vscode.lm.tools.filter((t) =>
    (BROWSER_TOOL_IDS as readonly string[]).includes(t.name)
  );
}

function vsResultToMcpContent(
  result: vscode.LanguageModelToolResult
): Array<TextContent | ImageContent> {
  const out: Array<TextContent | ImageContent> = [];
  for (const part of result.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      out.push({ type: "text", text: part.value });
      continue;
    }
    // LanguageModelDataPart (VS Code 1.111+) — duck-typing
    const p = part as { data?: Uint8Array; mime?: string };
    if (p.data instanceof Uint8Array && p.mime) {
      out.push({
        type: "image",
        data: Buffer.from(p.data).toString("base64"),
        mimeType: p.mime,
      });
    }
  }
  if (out.length === 0) {
    out.push({ type: "text", text: "(aucun contenu)" });
  }
  return out;
}

const ADD_DRAFT_ID = "add_figma_draft";

function buildMcpServer(onAddDraft?: (url: string, name?: string) => Promise<void>): Server {
  const server = new Server(
    { name: "figma-viewer-browser-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const vscTools = getAvailableBrowserTools();
    const tools: Tool[] = vscTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Tool["inputSchema"]) ?? {
        type: "object",
        properties: {},
      },
    }));
    tools.push({
      name: SAVE_SCREENSHOT_ID,
      description:
        "Prend une capture d'écran du navigateur intégré et la sauvegarde sur disque.",
      inputSchema: {
        type: "object",
        properties: {
          outputPath: {
            type: "string",
            description: "Chemin de sauvegarde (fichier temporaire par défaut).",
          },
        },
      },
    });
    tools.push({
      name: ADD_DRAFT_ID,
      description:
        "Enregistre un fichier Figma dans les Brouillons et Récents du panneau VS Code. À appeler après avoir créé ou obtenu l'URL d'un fichier Figma.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL complète du fichier Figma (figma.com/design/… ou /file/…).",
          },
          name: {
            type: "string",
            description: "Nom affiché dans le panneau (optionnel, déduit de l'URL par défaut).",
          },
        },
        required: ["url"],
      },
    });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const cts = new vscode.CancellationTokenSource();

    try {
      if (name === SAVE_SCREENSHOT_ID) {
        const result = await vscode.lm.invokeTool(
          "screenshot_page",
          { input: args ?? {}, toolInvocationToken: undefined },
          cts.token
        );
        const content = vsResultToMcpContent(result);
        const outputPath =
          (args as { outputPath?: string })?.outputPath ??
          path.join(os.tmpdir(), `figma-screenshot-${Date.now()}.png`);

        for (const part of content) {
          if (part.type === "image") {
            fs.writeFileSync(
              outputPath,
              Buffer.from((part as ImageContent).data, "base64")
            );
            return {
              content: [
                { type: "text" as const, text: `Capture sauvegardée : ${outputPath}` },
              ],
            };
          }
        }
        return { content };
      }

      if (name === ADD_DRAFT_ID) {
        const { url, name: label } = (args ?? {}) as { url?: string; name?: string };
        if (!url) {
          return { content: [{ type: "text" as const, text: "Paramètre url manquant." }], isError: true };
        }
        if (onAddDraft) {
          await onAddDraft(url, label);
          return { content: [{ type: "text" as const, text: `Fichier ajouté aux brouillons : ${label ?? url}` }] };
        }
        return { content: [{ type: "text" as const, text: "Serveur non configuré pour enregistrer les brouillons." }], isError: true };
      }

      if (!(BROWSER_TOOL_IDS as readonly string[]).includes(name)) {
        return {
          content: [{ type: "text" as const, text: `Outil inconnu : ${name}` }],
          isError: true,
        };
      }

      const result = await vscode.lm.invokeTool(
        name,
        { input: args ?? {}, toolInvocationToken: undefined },
        cts.token
      );
      return { content: vsResultToMcpContent(result) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    } finally {
      cts.dispose();
    }
  });

  return server;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export class BridgeHttpServer {
  private httpServer: http.Server | null = null;
  private _port = 0;
  private _token: string | null = null;
  onAddDraft?: (url: string, name?: string) => Promise<void>;

  get port(): number {
    return this._port;
  }
  get token(): string | null {
    return this._token;
  }
  get endpoint(): string {
    return `http://127.0.0.1:${this._port}/mcp`;
  }
  get isRunning(): boolean {
    return this.httpServer !== null;
  }

  async start(requestedPort: number, requireAuth: boolean): Promise<void> {
    if (this.httpServer) {
      return;
    }
    this._token = requireAuth ? crypto.randomBytes(16).toString("hex") : null;

    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (this._token) {
        const auth = req.headers["authorization"];
        if (auth !== `Bearer ${this._token}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Non autorisé" }));
          return;
        }
      }

      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", port: this._port }));
        return;
      }

      if (req.url === "/mcp") {
        try {
          const body = await readBody(req);
          const parsed = body ? (JSON.parse(body) as unknown) : undefined;
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          const mcpServer = buildMcpServer(this.onAddDraft);
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, parsed);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          }
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve, reject) => {
      const tryPort = (p: number) => {
        this.httpServer!.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && p < requestedPort + 10) {
            tryPort(p + 1);
          } else {
            reject(err);
          }
        });
        this.httpServer!.listen(p, "127.0.0.1", () => {
          this._port = (this.httpServer!.address() as AddressInfo).port;
          resolve();
        });
      };
      tryPort(requestedPort);
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }
    await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    this.httpServer = null;
    this._port = 0;
    this._token = null;
  }

  configSummary(): string {
    if (!this.isRunning) {
      return "Serveur MCP arrêté.";
    }
    const lines = [
      `Serveur MCP actif → ${this.endpoint}`,
      "",
      "**Ajouter à Claude Code :**",
      `\`claude mcp add --transport http figma-browser ${this.endpoint}\``,
    ];
    if (this._token) {
      lines.push(
        "",
        `**Token :** \`${this._token}\``,
        `\`claude mcp add --transport http figma-browser ${this.endpoint} -H "Authorization: Bearer ${this._token}"\``
      );
    }
    return lines.join("\n");
  }
}
