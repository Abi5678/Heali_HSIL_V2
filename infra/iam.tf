# ---------------------------------------------------------------------------
# Service Account for Cloud Run
# ---------------------------------------------------------------------------
resource "google_service_account" "cloud_run_sa" {
  account_id   = "heali-cloud-run"
  display_name = "Heali Cloud Run Service Account"
  project      = var.project_id
}

# Allow Cloud Run SA to read secrets
resource "google_project_iam_member" "secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Allow Cloud Run SA to write to Firestore
resource "google_project_iam_member" "firestore_writer" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Allow Cloud Run SA to use Gemini / Vertex AI
resource "google_project_iam_member" "vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Allow Cloud Build to push images
resource "google_project_iam_member" "cloudbuild_builder" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

data "google_project" "project" {
  project_id = var.project_id
}
