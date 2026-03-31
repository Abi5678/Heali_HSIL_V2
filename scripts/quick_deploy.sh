#!/usr/bin/env bash
# =============================================================================
# Heali Connect — Quick Deploy (no local Docker needed)
# Uses Google Cloud Build to build the image remotely, then deploys to Cloud Run
# =============================================================================
# Usage (from project root):
#   source .env && bash scripts/quick_deploy.sh
# =============================================================================
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-medlive-488722}"
REGION="${GOOGLE_CLOUD_LOCATION:-us-central1}"
SERVICE_NAME="heali"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "============================================================"
echo "  Heali Connect — Cloud Run Deployment"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "============================================================"
echo ""

# ---------------------------------------------------------------------------
# Step 0: Install gcloud if missing
# ---------------------------------------------------------------------------
if ! command -v gcloud &>/dev/null; then
  echo "⚙️  gcloud not found. Installing Google Cloud SDK..."
  curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts
  # shellcheck source=/dev/null
  source "$HOME/google-cloud-sdk/path.bash.inc" 2>/dev/null || true
  gcloud components update --quiet
  echo "✓ gcloud installed"
fi

# ---------------------------------------------------------------------------
# Step 1: Authenticate (opens browser) + set project
# ---------------------------------------------------------------------------
echo "1️⃣  Authenticating with GCP..."
gcloud auth login --update-adc --quiet 2>/dev/null || gcloud auth login --update-adc
gcloud config set project "${PROJECT_ID}"
gcloud auth configure-docker --quiet
echo "   ✓ Authenticated"

# ---------------------------------------------------------------------------
# Step 2: Enable APIs (idempotent)
# ---------------------------------------------------------------------------
echo "2️⃣  Enabling required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project "${PROJECT_ID}" --quiet
echo "   ✓ APIs enabled"

# ---------------------------------------------------------------------------
# Step 3: Create secrets if they don't exist
# ---------------------------------------------------------------------------
echo "3️⃣  Provisioning Secret Manager secrets..."

# Google API Key
if ! gcloud secrets describe heali-google-api-key --project "${PROJECT_ID}" &>/dev/null; then
  if [ -z "${GOOGLE_API_KEY:-}" ]; then
    echo "   ⚠️  GOOGLE_API_KEY not set — skipping (add it manually to Secret Manager)"
  else
    echo -n "${GOOGLE_API_KEY}" | gcloud secrets create heali-google-api-key \
      --data-file=- --project "${PROJECT_ID}" --quiet
    echo "   ✓ Created secret: heali-google-api-key"
  fi
else
  echo "   ✓ Secret exists: heali-google-api-key"
fi

# Firebase Admin SDK
FIREBASE_CREDS="${GOOGLE_APPLICATION_CREDENTIALS:-credentials/firebase-admin-sdk.json}"
if ! gcloud secrets describe heali-firebase-admin --project "${PROJECT_ID}" &>/dev/null; then
  if [ -f "${FIREBASE_CREDS}" ]; then
    gcloud secrets create heali-firebase-admin \
      --data-file="${FIREBASE_CREDS}" --project "${PROJECT_ID}" --quiet
    echo "   ✓ Created secret: heali-firebase-admin"
  else
    echo "   ⚠️  Firebase credentials not found at ${FIREBASE_CREDS}"
    echo "       Download from Firebase Console → Project Settings → Service Accounts"
    echo "       Save as credentials/firebase-admin-sdk.json and re-run this script"
    exit 1
  fi
else
  echo "   ✓ Secret exists: heali-firebase-admin"
fi

# Reminders secret
if ! gcloud secrets describe heali-reminders-secret --project "${PROJECT_ID}" &>/dev/null; then
  REMINDER_SECRET="${REMINDERS_TRIGGER_SECRET:-$(openssl rand -hex 32)}"
  echo -n "${REMINDER_SECRET}" | gcloud secrets create heali-reminders-secret \
    --data-file=- --project "${PROJECT_ID}" --quiet
  echo "   ✓ Created secret: heali-reminders-secret"
else
  echo "   ✓ Secret exists: heali-reminders-secret"
fi

# Grant Cloud Run SA access to secrets
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')
CR_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for SECRET in heali-firebase-admin heali-google-api-key heali-reminders-secret; do
  gcloud secrets add-iam-policy-binding "${SECRET}" \
    --member="serviceAccount:${CR_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --project "${PROJECT_ID}" --quiet 2>/dev/null || true
done
echo "   ✓ IAM bindings set"

# ---------------------------------------------------------------------------
# Step 4: Build image remotely with Cloud Build (no local Docker needed!)
# ---------------------------------------------------------------------------
echo "4️⃣  Building image with Cloud Build (remote — Node + Python multi-stage)..."
echo "   This takes ~8-12 minutes on first build..."
gcloud builds submit \
  --tag "${IMAGE}" \
  --project "${PROJECT_ID}" \
  --timeout 20m \
  .
echo "   ✓ Image built: ${IMAGE}"

# ---------------------------------------------------------------------------
# Step 5: Deploy to Cloud Run with session affinity
# ---------------------------------------------------------------------------
echo "5️⃣  Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --session-affinity \
  --min-instances 1 \
  --max-instances 10 \
  --concurrency 80 \
  --timeout 3600 \
  --memory 2Gi \
  --cpu 2 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GOOGLE_GENAI_USE_VERTEXAI=FALSE,MEDLIVE_MODEL=gemini-live-2.5-flash-native-audio,USE_FIRESTORE=true,GOOGLE_APPLICATION_CREDENTIALS=/secrets/firebase-admin-sdk.json" \
  --set-secrets "GOOGLE_API_KEY=heali-google-api-key:latest,/secrets/firebase-admin-sdk.json=heali-firebase-admin:latest,REMINDERS_TRIGGER_SECRET=heali-reminders-secret:latest" \
  --project "${PROJECT_ID}"

# ---------------------------------------------------------------------------
# Step 6: Get URL and patch self-reference
# ---------------------------------------------------------------------------
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --format "value(status.url)")

gcloud run services update "${SERVICE_NAME}" \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --update-env-vars "MEDLIVE_APP_URL=${SERVICE_URL}" --quiet

echo ""
echo "================================================================"
echo "  ✅  Heali Connect deployed successfully!"
echo "      URL: ${SERVICE_URL}"
echo "================================================================"
echo ""
echo "📋  Final steps:"
echo "   1. Add ${SERVICE_URL} to Firebase Authorized Domains:"
echo "      https://console.firebase.google.com/project/${PROJECT_ID}/authentication/settings"
echo "   2. Enable Google Sign-In:"
echo "      https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
echo ""
echo "   Demo URL: ${SERVICE_URL}"
echo "   Logs    : https://console.cloud.google.com/logs?project=${PROJECT_ID}"
