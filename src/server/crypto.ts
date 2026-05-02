import crypto from "node:crypto";

const algorithm = "aes-256-gcm";

function keyFromSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptText(value: string, secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptText(value: string, secret: string) {
  const [ivPart, tagPart, encryptedPart] = value.split(".");

  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Encrypted value is malformed.");
  }

  const decipher = crypto.createDecipheriv(
    algorithm,
    keyFromSecret(secret),
    Buffer.from(ivPart, "base64url")
  );

  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
