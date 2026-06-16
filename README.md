# Figma Viewer — extension VS Code

Parcourez vos fichiers Figma **par équipe** depuis la barre d'activité de VS Code,
et ouvrez-les en un clic dans le **navigateur intégré**. Vous pouvez aussi créer
un nouveau fichier Figma directement depuis l'extension.

## Fonctionnalités

- **Connexion OAuth2** à Figma (le flow s'ouvre dans le navigateur intégré).
- **Arborescence** Équipe → Projets → Fichiers.
- **Clic sur un fichier** → ouverture dans un nouvel onglet du navigateur intégré.
- **Nouveau fichier** (design ou FigJam) depuis le titre de la vue.

## Pourquoi le navigateur intégré et pas la « Simple Browser » ?

Figma renvoie `X-Frame-Options: SAMEORIGIN` et `Content-Security-Policy:
frame-ancestors 'self'` : il **refuse d'être affiché dans une iframe**. La
« Simple Browser » native de VS Code étant basée sur une iframe, elle ne peut pas
afficher Figma (page blanche). L'extension utilise donc un **vrai navigateur
intégré**, via une commande VS Code configurable.

Par défaut elle appelle la commande native **`workbench.action.browser.open`**,
qui laisse VS Code router l'URL vers le navigateur configuré (y compris votre
navigateur intégré s'il s'enregistre comme « external URI opener »). On ne dépend
ainsi d'aucune extension précise. Pour forcer une commande d'ouverture donnée
(ex. `browserBridge.openInBrowser`), utilisez le réglage `figmaViewer.openCommand`.

## Pour l'utilisateur final

Aucune configuration. Il suffit de cliquer sur **Se connecter à Figma** : le
navigateur intégré s'ouvre sur la page d'autorisation OAuth de Figma, on autorise,
et c'est tout. Les identifiants OAuth sont fournis par l'extension elle-même.

## Pour le développeur de l'extension — `.env` des identifiants

L'extension embarque **une seule** app OAuth Figma (la nôtre). Ses identifiants
sont lus dans un fichier `.env` **à la racine de l'extension** (gitignoré, donc
pas publié sur le dépôt, mais inclus dans le `.vsix` au packaging).

1. Créez une app OAuth **privée** sur https://www.figma.com/developers/apps.
   ⚠️ Le scope `projects:read` (nécessaire pour lister équipes → projets →
   fichiers) **n'existe que pour les apps privées**, et doit être **activé** dans
   la configuration de l'app. Une app publique renverra `Invalid scopes for app`.
2. Déclarez l'URL de redirection : `http://localhost:53111/callback`
   (le port doit correspondre à `FIGMA_CALLBACK_PORT`).
3. Créez le `.env` :

   ```bash
   cp .env.example .env
   ```

   ```dotenv
   FIGMA_CLIENT_ID=notre_client_id
   FIGMA_CLIENT_SECRET=notre_client_secret
   FIGMA_CALLBACK_PORT=53111
   ```

Les jetons d'accès obtenus pour chaque utilisateur sont stockés de façon chiffrée
via le **SecretStorage** de VS Code (jamais dans le `.env`).

> ⚠️ Figma impose un `client_secret` même avec PKCE. Embarquer ce secret dans une
> extension distribuée signifie qu'il est techniquement extractible du `.vsix` —
> c'est inhérent au modèle OAuth « confidentiel » de Figma. À réserver à une
> distribution interne / maîtrisée.

## Développement

```bash
npm install
npm run watch     # compilation incrémentale (esbuild)
```

Puis **F5** pour lancer un « Extension Development Host ».

## Utilisation

1. Ouvrez le panneau **Figma** dans la barre d'activité.
2. Cliquez sur **Se connecter à Figma** → autorisez dans le navigateur intégré.
3. **Ajouter une équipe** : collez l'URL de l'équipe (`…/team/<id>/…`) ou son ID.
4. Dépliez Équipe → Projet → Fichier, puis cliquez sur un fichier pour l'ouvrir.

## Réglages

| Réglage | Description | Défaut |
| --- | --- | --- |
| `figmaViewer.teams` | IDs des équipes Figma affichées. | `[]` |
| `figmaViewer.openCommand` | Commande VS Code utilisée pour ouvrir une URL. | `workbench.action.browser.open` |

## Limites connues

- L'API REST Figma ne permet pas de **lister toutes les équipes** ni de **créer
  un fichier** : on ajoute donc les équipes manuellement, et « Nouveau fichier »
  ouvre la page de création de Figma dans le navigateur intégré.
- Le `client_secret` est requis par Figma même avec PKCE ; il reste local
  (fichier `.env`).
