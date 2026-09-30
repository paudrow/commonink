// Connected accounts' tokens at rest: sealed with AES-256-GCM under INTEGRATIONS_KEY, a Worker secret
// that never leaves Cloudflare. Each sealed value is bound to what it's for (`context`: the person,
// the provider and which token), so a row copied onto another person's, or an access token passed
// off as a refresh token, doesn't open. Nothing sealed here is ever sent to a browser.

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const keys = new Map<string, Promise<CryptoKey>>();

/** The key from its secret: 32 random bytes, base64 (`openssl rand -base64 32`). */
function keyOf(secret: string | undefined): Promise<CryptoKey> {
  if (!secret) throw new Error("INTEGRATIONS_KEY isn't set");
  let key = keys.get(secret);
  if (!key) {
    let raw: Uint8Array<ArrayBuffer>;
    try {
      raw = unb64(secret.trim());
    } catch {
      throw new Error("INTEGRATIONS_KEY isn't base64");
    }
    if (raw.length !== 32) throw new Error("INTEGRATIONS_KEY must be 32 bytes (openssl rand -base64 32)");
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keys.set(secret, key);
  }
  return key;
}

export async function encrypt(secret: string | undefined, plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) }, await keyOf(secret), new TextEncoder().encode(plain));
  return `v1.${b64(iv)}.${b64(new Uint8Array(data))}`;
}

/** The plain value, or an error if it was changed, sealed for something else, or under another key. */
export async function decrypt(secret: string | undefined, sealed: string, context: string): Promise<string> {
  const [v, iv, data] = sealed.split(".");
  if (v !== "v1" || !iv || !data) throw new Error("Not a sealed value");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(context) }, await keyOf(secret), unb64(data));
  return new TextDecoder().decode(plain);
}
