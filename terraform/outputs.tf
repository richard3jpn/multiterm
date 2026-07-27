output "frontend_url" {
  value       = "http://localhost:${var.frontend_port}"
  description = "ブラウザで開くURL"
}

output "backend_ws_url" {
  value       = "ws://localhost:${var.backend_port}"
  description = "バックエンドWebSocketエンドポイント"
}
