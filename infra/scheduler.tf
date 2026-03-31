# ---------------------------------------------------------------------------
# Cloud Scheduler — Proactive medication reminder trigger
# Fires every 15 minutes → POST /api/reminders/trigger
# The reminders endpoint checks which users have medications due and
# sends FCM push notifications.
#
# NOTE: Set var.app_url after first deploy to activate this resource.
# ---------------------------------------------------------------------------
resource "google_cloud_scheduler_job" "reminders" {
  count = var.app_url != "" ? 1 : 0

  name        = "heali-reminders"
  description = "Fires every 15 min to trigger proactive medication reminders"
  schedule    = "*/15 * * * *"
  time_zone   = "UTC"
  region      = var.region
  project     = var.project_id

  http_target {
    uri         = "${var.app_url}/api/reminders/trigger"
    http_method = "POST"
    body        = base64encode("")

    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.cloud_run_sa.email
      audience              = var.app_url
    }
  }

  retry_config {
    retry_count = 3
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}
