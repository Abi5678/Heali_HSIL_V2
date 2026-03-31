# ---------------------------------------------------------------------------
# Firestore — Native mode database
# Note: Only one Firestore database per project is supported in the default mode.
# If already created via console/gcloud, import it:
#   terraform import google_firestore_database.default projects/medlive-488722/databases/(default)
# ---------------------------------------------------------------------------
resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.apis["firestore.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Firestore indexes for common queries
# ---------------------------------------------------------------------------

# Adherence log: query by user + date range (for weekly adherence scores)
resource "google_firestore_index" "adherence_by_date" {
  project    = var.project_id
  collection = "adherence_log"

  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }

  depends_on = [google_firestore_database.default]
}

# Vitals log: query by user + type + date (for trend analysis)
resource "google_firestore_index" "vitals_by_type_date" {
  project    = var.project_id
  collection = "vitals_log"

  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "type"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }

  depends_on = [google_firestore_database.default]
}

# Family links: query by parent_uid + linked caregiver (for auth check)
resource "google_firestore_index" "family_links_by_parent" {
  project    = var.project_id
  collection = "family_links"

  fields {
    field_path = "parent_uid"
    order      = "ASCENDING"
  }
  fields {
    field_path = "linked_uids"
    array_config = "CONTAINS"
  }

  depends_on = [google_firestore_database.default]
}
