# ---------------------------------------------------------------------------
# Cloud Run — Heali application service
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "heali" {
  name     = var.service_name
  location = var.region
  project  = var.project_id

  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run_sa.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    timeout = "3600s" # 1 hour — required for long-lived WebSocket connections

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
        startup_cpu_boost = true
      }

      # ---------------------
      # Environment variables
      # ---------------------
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }
      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "FALSE"
      }
      env {
        name  = "MEDLIVE_MODEL"
        value = var.gemini_model
      }
      env {
        name  = "USE_FIRESTORE"
        value = "true"
      }
      env {
        name  = "GOOGLE_APPLICATION_CREDENTIALS"
        value = "/secrets/firebase-admin-sdk.json"
      }

      # ---------------------
      # Secrets from Secret Manager
      # ---------------------
      env {
        name = "GOOGLE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "REMINDERS_TRIGGER_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.reminders_secret.secret_id
            version = "latest"
          }
        }
      }

      # Firebase Admin SDK mounted as a file
      volume_mounts {
        name       = "firebase-admin"
        mount_path = "/secrets"
      }

      # ---------------------
      # Health check
      # ---------------------
      startup_probe {
        http_get {
          path = "/health"
          port = 8000
        }
        initial_delay_seconds = 5
        period_seconds        = 10
        failure_threshold     = 5
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8000
        }
        period_seconds    = 30
        failure_threshold = 3
      }

      ports {
        container_port = 8000
      }
    }

    volumes {
      name = "firebase-admin"
      secret {
        secret = google_secret_manager_secret.firebase_admin.secret_id
        items {
          version = "latest"
          path    = "firebase-admin-sdk.json"
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_iam_member.api_key_accessor,
    google_secret_manager_secret_iam_member.firebase_accessor,
    google_secret_manager_secret_iam_member.reminders_accessor,
  ]
}

# Allow unauthenticated (public) access to Cloud Run service
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.heali.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
