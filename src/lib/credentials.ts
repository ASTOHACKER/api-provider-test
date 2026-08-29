import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"

function encryptionKey(): Buffer {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!value) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set")

  const key = Buffer.from(value, "hex")
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 64 hexadecimal characters")
  return key
}

export function encryptCredential(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".")
}

export function decryptCredential(value: string): string {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split(".")
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error("Invalid encrypted credential")

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivEncoded, "base64url"))
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
