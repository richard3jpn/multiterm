variable "project_slug" {
  type        = string
  description = "リソース名の接頭辞（例: multiterm）"
}

variable "backend_port" {
  type        = number
  default     = 3001
  description = "バックエンド（REST + WebSocket）の公開ポート"
}

variable "frontend_port" {
  type        = number
  default     = 3000
  description = "フロントエンド（nginx）の公開ポート"
}
