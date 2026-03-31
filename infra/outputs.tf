output "service_url" {
  description = "Public URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.heali.uri
}

output "service_account_email" {
  description = "Service account email for Cloud Run"
  value       = google_service_account.cloud_run_sa.email
}

output "firestore_database" {
  description = "Firestore database name"
  value       = google_firestore_database.default.name
}

output "image" {
  description = "Container image deployed"
  value       = var.image
}

output "cloud_run_console" {
  description = "Link to Cloud Run console"
  value       = "https://console.cloud.google.com/run/detail/${var.region}/${var.service_name}?project=${var.project_id}"
}

output "firebase_console" {
  description = "Link to Firebase console"
  value       = "https://console.firebase.google.com/project/${var.project_id}"
}
