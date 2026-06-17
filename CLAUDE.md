# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile      # Build (dev) → dist/extension.js with source maps
npm run watch        # Build in watch mode
npm run package      # Production build (minified, no source maps)
npm run lint         # Type-check only (tsc --noEmit, no test suite)
```

To run the extension, open the project in VS Code and press **F5** (uses `.vscode/launch.json`). This launches a new Extension Development Host window.

## OAuth Setup

The extension requires a Figma OAuth app. Copy `.env.example` to `.env` and fill in:

- `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET` — from a **private** Figma OAuth app (required for the `projects:read` scope)
- Redirect URL to register in the Figma app: `http://localhost:53111/callback`

The `.env` file is bundled with the extension at install time and read at runtime by [src/env.ts](src/env.ts) via `loadEnv(context.extensionPath)`.

## Architecture

The extension is a single-entry-point VS Code extension built with esbuild. All source lives in `src/`.

**Data flow:**

```
extension.ts (activate)
  └── FigmaAuth       auth/figmaAuth.ts   OAuth PKCE flow, token storage via vscode.SecretStorage
  └── FigmaApi        figmaApi.ts         REST calls to api.figma.com (teams → projects → files)
  └── RecentStore     recents.ts          Recently opened files (workspaceState)
  └── DraftStore      drafts.ts           Manually pinned files (globalState)
  └── FilesProvider   tree/filesProvider.ts  TreeDataProvider for the sidebar view
  └── commands.ts     Command handlers registered in activate()
  └── browser.ts      Opens URLs via the VS Code browser command (workbench.action.browser.open); falls back to env.openExternal
```

**Tree view structure (sidebar):**
- **Récents** — recently opened files (populated by `RecentStore`)
- **Brouillons** — manually pinned files; includes "Add by URL" and "New file" actions
- **Équipes** — team IDs stored in `figmaViewer.teams` workspace config; expand to Projects → Files via API

**Key design decisions:**
- OAuth callback is handled by a local HTTP server spun up on `FIGMA_CALLBACK_PORT` (default 53111) during sign-in; the server shuts down after the callback is received.
- `browser.ts` opens URLs via `figmaViewer.openCommand` (default: `workbench.action.browser.open`), overridable via VS Code settings. Falls back to `env.openExternal` if the command fails.
- The VS Code Integrated Browser exposes no public extension API (no tab listing, no navigation events). There is no way to detect or reactivate an already-open tab natively.
- The UI language is French (labels, messages, comments).
