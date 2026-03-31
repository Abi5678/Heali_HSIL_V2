#!/usr/bin/env bash
# =============================================================================
# Heali Connect — Build + Deploy to Cloud Run
# =============================================================================
# Usage:
#   bash scripts/deploy.sh                # Full build + deploy + seed
#   bash scripts/deploy.sh --skip-build   # Deploy existing image (faster iterations)
#   bash scripts/deploy.sh --skip-seed    # Skip Firestore demo data seeding
#   bash scripts/deploy.sh --project my-project-id  # Override GCP project
#
# Prerequisites:
#   gcloud auth login && gcloud auth configure-docker
#   Service account with roles: run.admin, storage.admin, secretmanager.secretAccessor
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via env vars or --project flag)
# ---------------------------------------------------------------------------
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-medlive-488722}"
REGION="${GOOGLE_CLOUD_LOCATION:-us-central1}"
SERVICE_NAME="heali"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

SKIP_BUILD=false
SKIP_SEED=false

for arg in "$@"; do
  case $arg in
    --skip-build)     SKIP_BUILD=true ;;
    --skip-seed)      SKIP_SEED=true  ;;
    --project=*)      PROJECT_ID="${arg#*=}" ; IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}" ;;
  esac
done

echo "🚀 Heali Connect Deploy"
echo "   Project : ${PROJECT_ID}"
echo "   Region  : ${REGION}"
echo "   Image   : ${IMAGE}"
echo ""

# ---------------------------------------------------------------------------
# 1. Build Docker image (multi-stage: Node → React build, Python → backend)
# ---------------------------------------------------------------------------
if [ "${SKIP_BUILD}" = false ]; then
  echo "1️⃣  Building combined Docker image with Cloud Build..."
  echo "   (Node 20 compiles React frontend, Python 3.11 runs FastAPI)"
  gcloud builds submit \
    --tag "${IMAGE}" \
    --project "${PROJECT_ID}" \
    --timeout 20m \
    .
  echo "   ✓ Image built and pushed: ${IMAGE}"
else
  echo "1️⃣  Skipping build (--skip-build)"
fi

# ---------------------------------------------------------------------------
# 2. Deploy to Cloud Run
#    Key flags:
#      --session-affinity  — routes WebSocket upgrades to the same instance
#      --timeout 3600      — keeps long-lived WebSocket connections alive
#      --min-instances 1   — avoids cold-start WebSocket failures
# ---------------------------------------------------------------------------
echo "2️⃣  Deploying to Cloud Run..."
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

echo "   ✓ Cloud Run service deployed"

# ---------------------------------------------------------------------------
# 3. Get the service URL and update the app's own env var
# ---------------------------------------------------------------------------
echo "3️⃣  Fetching service URL..."
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)")

echo "   ✓ Service URL: ${SERVICE_URL}"

# Patch MEDLIVE_APP_URL so reminder push notifications use the live domain
echo "   Patching MEDLIVE_APP_URL → ${SERVICE_URL}"
gcloud run services update "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --update-env-vars "MEDLIVE_APP_URL=${SERVICE_URL}" \
  --quiet

echo ""
echo "✅  Heali Connect is live at: ${SERVICE_URL}"
echo ""

# ---------------------------------------------------------------------------
# 4. Seed Firestore with demo data (skip on re-deploys)
# ---------------------------------------------------------------------------
if [ "${SKIP_SEED}" = false ]; then
  echo "4️⃣  Seeding Firestore with demo data..."
  if [ -f ".env" ]; then
    set -a; source .env; set +a
  fi
  uv run python scripts/seed_firestore.py \
    && echo "   ✓ Demo data seeded" \
    || echo "   ⚠️  Seed failed — check GOOGLE_APPLICATION_CREDENTIALS"
else
  echo "4️⃣  Skipping Firestore seed (--skip-seed)"
fi

# ---------------------------------------------------------------------------
# 5. Post-deploy checklist
# ---------------------------------------------------------------------------
echo ""
echo "📋  Post-deploy checklist:"
echo "   [ ] Add ${SERVICE_URL} to Firebase Authorized Domains"
echo "       Firebase Console → Authentication → Settings → Authorized Domains"
echo "   [ ] Enable Google Sign-In (Firebase Console → Authentication → Sign-in providers)"
echo "   [ ] Verify Cloud Scheduler MEDLIVE_APP_URL points to ${SERVICE_URL}"
echo "   [ ] Set VAPID_KEY env var for push notifications"
echo "       Firebase Console → Project Settings → Cloud Messaging → Web configuration"
echo ""
echo "🔗  App       : ${SERVICE_URL}"
echo "🔗  Firebase  : https://console.firebase.google.com/project/${PROJECT_ID}"
echo "🔗  Cloud Run : https://console.cloud.google.com/run/detail/${REGION}/${SERVICE_NAME}?project=${PROJECT_ID}"
echo "🔗  Logs      : https://console.cloud.google.com/logs/query?project=${PROJECT_ID}"
