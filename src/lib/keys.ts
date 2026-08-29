import { randomBytes } from "node:crypto"

export function generateApiKey(prefix = "gw"): string {
  const raw = randomBytes(24).toString("hex")
  return `${prefix}_${raw}`
}
