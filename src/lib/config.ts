import type { ProviderConfig } from "../types.js"

export function loadConfig() {
  return {
    port: parseInt(process.env.PORT || "8787", 10),
    host: process.env.HOST || "0.0.0.0",
    adminApiKey: process.env.ADMIN_API_KEY || "change-me-admin-secret",
  }
}

export function defaultProviders(): ProviderConfig[] {
  return [
    {
      name: "openai",
      type: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: process.env.OPENAI_API_KEY || "",
      models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    },
    {
      name: "anthropic",
      type: "anthropic",
      base_url: "https://api.anthropic.com/v1",
      api_key: process.env.ANTHROPIC_API_KEY || "",
      models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    },
    {
      name: "glm",
      type: "openai",
      base_url: "https://open.bigmodel.cn/api/paas/v4",
      api_key: process.env.GLM_API_KEY || "",
      models: ["glm-5.2", "glm-5.1", "glm-5.3", "glm-5.3-flash"],
    },
  ]
}
