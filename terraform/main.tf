terraform {
  required_version = ">= 1.5"
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 4.0"
    }
  }
}

provider "docker" {}

resource "docker_network" "app" {
  name = "${var.project_slug}-net"
}

# --- バックエンド（PTY管理 + WebSocket）---
resource "docker_image" "backend" {
  name = "${var.project_slug}-backend:latest"
  build {
    context = abspath("${path.module}/../backend")
  }
}

resource "docker_container" "backend" {
  name  = "${var.project_slug}-backend"
  image = docker_image.backend.image_id
  env = [
    "PORT=${var.backend_port}",
    "HOST=0.0.0.0",                                                                                # RDD.md 8章: コンテナ内は0.0.0.0でリッスンし、公開側で127.0.0.1限定
    "ALLOWED_ORIGINS=http://localhost:${var.frontend_port},http://127.0.0.1:${var.frontend_port}", # RDD.md 5章9項
  ]
  ports {
    internal = var.backend_port
    external = var.backend_port
    ip       = "127.0.0.1" # RDD.md 8章: ループバック限定公開（LAN公開禁止）
  }
  networks_advanced {
    name    = docker_network.app.name
    aliases = ["backend"]
  }
}

# --- フロントエンド ---
resource "docker_image" "frontend" {
  name = "${var.project_slug}-frontend:latest"
  build {
    context = abspath("${path.module}/../frontend")
    build_args = {
      VITE_WS_URL  = "ws://localhost:${var.backend_port}"
      VITE_API_URL = "http://localhost:${var.backend_port}"
    }
  }
}

resource "docker_container" "frontend" {
  name  = "${var.project_slug}-frontend"
  image = docker_image.frontend.image_id
  ports {
    internal = 80
    external = var.frontend_port
    ip       = "127.0.0.1" # RDD.md 8章: ループバック限定公開
  }
  networks_advanced {
    name = docker_network.app.name
  }
  depends_on = [docker_container.backend]
}
