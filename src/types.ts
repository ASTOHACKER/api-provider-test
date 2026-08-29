export type ProviderType = "openai" | "anthropic"

export interface Provider {
  id: number
  name: string
  type: ProviderType
  base_url: string
  api_key: string
  models: string
  enabled: boolean
  created_at: string
}

export interface Customer {
  id: number
  name: string
  email: string | null
  enabled: boolean
  created_at: string
}

export interface ApiKey {
  id: number
  key: string
  customer_id: number
  name: string
  enabled: boolean
  created_at: string
  last_used_at: string | null
}

export interface Quota {
  customer_id: number
  monthly_request_limit: number
  monthly_token_limit: number
  period_start: string
  requests_used: number
  tokens_used: number
}

export interface UsageLog {
  id: number
  customer_id: number
  api_key_id: number
  provider_id: number
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  status: number
  latency_ms: number
  error: string | null
  created_at: string
}

export interface AuthContext {
  customer: Customer
  apiKey: ApiKey
}

export interface ProviderConfig {
  name: string
  type: ProviderType
  base_url: string
  api_key: string
  models: string[]
}
