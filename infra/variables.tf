variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "medlive-488722"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "heali"
}

variable "image" {
  description = "Container image URI (gcr.io/<project>/<service>)"
  type        = string
  default     = "gcr.io/medlive-488722/heali"
}

variable "gemini_model" {
  description = "Gemini model for voice streaming"
  type        = string
  default     = "gemini-2.5-flash-native-audio-latest"
}

variable "min_instances" {
  description = "Minimum Cloud Run instances (1 prevents cold starts)"
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Maximum Cloud Run instances"
  type        = number
  default     = 10
}

variable "app_url" {
  description = "Public URL of the deployed app (set after first deploy for Scheduler)"
  type        = string
  default     = ""
}
