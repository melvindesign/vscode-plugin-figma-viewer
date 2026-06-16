import * as crypto from "crypto";

export interface Pkce {
  verifier: string;
  challenge: string;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Génère un couple PKCE (code_verifier + code_challenge S256). */
export function createPkce(): Pkce {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash("sha256").update(verifier).digest()
  );
  return { verifier, challenge };
}

/** Jeton aléatoire opaque, utilisé pour le paramètre OAuth `state`. */
export function randomState(): string {
  return base64UrlEncode(crypto.randomBytes(16));
}
