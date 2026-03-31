# ---------------------------------------------------------------------------
# Secret Manager — secrets are created by scripts/setup_gcp.sh
# These resources import them into Terraform state for IAM wiring.
# ---------------------------------------------------------------------------

# Import existing secrets (created by setup_gcp.sh)
# To import: terraform import google_secret_manager_secret.google_api_key projects/medlive-488722/secrets/heali-google-api-key
resource "google_secret_manager_secret" "google_api_key" {
  secret_id = "heali-google-api-key"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret" "firebase_admin" {
  secret_id = "heali-firebase-admin"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret" "reminders_secret" {
  secret_id = "heali-reminders-secret"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

# Grant Cloud Run SA access to each secret
resource "google_secret_manager_secret_iam_member" "api_key_accessor" {
  secret_id = google_secret_manager_secret.google_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "firebase_accessor" {
  secret_id = google_secret_manager_secret.firebase_admin.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "reminders_accessor" {
  secret_id = google_secret_manager_secret.reminders_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}
