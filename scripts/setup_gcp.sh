#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Heali — One-Time GCP Project Setup
# Run this ONCE before first deploy.
# Usage: bash scripts/setup_gcp.sh
# ---------------------------------------------------------------------------
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-medlive-488722}"
REGION="${GOOGLE_CLOUD_LOCATION:-us-central1}"

echo "🚀 Heali GCP Setup — project: ${PROJECT_ID}, region: ${REGION}"
echo ""

# ---------------------------------------------------------------------------
# 1. Set active project
# ---------------------------------------------------------------------------
echo "1️⃣  Setting active GCP project..."
gcloud config set project "${PROJECT_ID}"

# ---------------------------------------------------------------------------
# 2. Enable required APIs
# ---------------------------------------------------------------------------
echo "2️⃣  Enabling required APIs (this may take a minute)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  aiplatform.googleapis.com \
  firebase.googleapis.com \
  iam.googleapis.com \
  --project "${PROJECT_ID}"

echo "   ✓ APIs enabled"

# ---------------------------------------------------------------------------
# 3. Create Firestore database (Native mode)
# ---------------------------------------------------------------------------
echo "3️⃣  Creating Firestore database..."
if gcloud firestore databases describe --project "${PROJECT_ID}" &>/dev/null; then
  echo "   ✓ Firestore database already exists"
else
  gcloud firestore databases create \
    --project "${PROJECT_ID}" \
    --location "${REGION}" \
    --type FIRESTORE_NATIVE
  echo "   ✓ Firestore database created"
fi

# ---------------------------------------------------------------------------
# 4. Create GCP Secrets
# ---------------------------------------------------------------------------
echo "4️⃣  Creating Secret Manager secrets..."

# Firebase Admin SDK credentials
FIREBASE_CREDS_FILE="${GOOGLE_APPLICATION_CREDENTIALS:-credentials/firebase-admin-sdk.json}"
if [ ! -f "${FIREBASE_CREDS_FILE}" ]; then
  echo "   ⚠️  Firebase credentials file not found: ${FIREBASE_CREDS_FILE}"
  echo "   Download from Firebase Console → Project Settings → Service Accounts → Generate new private key"
  echo "   Save as: ${FIREBASE_CREDS_FILE}"
  echo "   Then re-run this script."
  exit 1
fi

if gcloud secrets describe heali-firebase-admin --project "${PROJECT_ID}" &>/dev/null; then
  echo "   ✓ Secret heali-firebase-admin already exists"
else
  gcloud secrets create heali-firebase-admin \
    --data-file="${FIREBASE_CREDS_FILE}" \
    --project "${PROJECT_ID}"
  echo "   ✓ Secret heali-firebase-admin created"
fi

# Google API Key
if [ -z "${GOOGLE_API_KEY:-}" ]; then
  echo "   ⚠️  GOOGLE_API_KEY not set in environment. Skipping API key secret."
  echo "   Set it in .env and re-run, or add manually:"
  echo "   echo -n 'YOUR_KEY' | gcloud secrets create heali-google-api-key --data-file=-"
else
  if gcloud secrets describe heali-google-api-key --project "${PROJECT_ID}" &>/dev/null; then
    echo "   ✓ Secret heali-google-api-key already exists"
  else
    echo -n "${GOOGLE_API_KEY}" | gcloud secrets create heali-google-api-key \
      --data-file=- \
      --project "${PROJECT_ID}"
    echo "   ✓ Secret heali-google-api-key created"
  fi
fi

# Reminders trigger secret
TRIGGER_SECRET="${REMINDERS_TRIGGER_SECRET:-}"
if [ -z "${TRIGGER_SECRET}" ]; then
  TRIGGER_SECRET=$(openssl rand -hex 32)
  echo "   ℹ️  Generated REMINDERS_TRIGGER_SECRET: ${TRIGGER_SECRET}"
  echo "   Add this to your .env file."
fi
if gcloud secrets describe heali-reminders-secret --project "${PROJECT_ID}" &>/dev/null; then
  echo "   ✓ Secret heali-reminders-secret already exists"
else
  echo -n "${TRIGGER_SECRET}" | gcloud secrets create heali-reminders-secret \
    --data-file=- \
    --project "${PROJECT_ID}"
  echo "   ✓ Secret heali-reminders-secret created"
fi

# ---------------------------------------------------------------------------
# 5. Grant IAM to Cloud Run service account
# ---------------------------------------------------------------------------
echo "5️⃣  Granting Secret Manager access to Cloud Run service account..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')
CR_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in heali-firebase-admin heali-google-api-key heali-reminders-secret; do
  gcloud secrets add-iam-policy-binding "${SECRET}" \
    --member="serviceAccount:${CR_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --project "${PROJECT_ID}" \
    --quiet
done
echo "   ✓ IAM granted for service account: ${CR_SA}"

# ---------------------------------------------------------------------------
# 6. Cloud Scheduler job for proactive reminders
# ---------------------------------------------------------------------------
echo "6️⃣  Creating Cloud Scheduler job for reminders..."
APP_URL="${MEDLIVE_APP_URL:-}"

if [ -z "${APP_URL}" ]; then
  echo "   ⚠️  MEDLIVE_APP_URL not set. Skipping Cloud Scheduler setup."
  echo "   After deploy, get the URL then run:"
  echo "   gcloud scheduler jobs create http heali-reminders \\"
  echo "     --schedule='*/15 * * * *' --uri='<APP_URL>/api/reminders/trigger' \\"
  echo "     --message-body='' --headers='Authorization=Bearer <SECRET>' \\"
  echo "     --location=${REGION}"
else
  if gcloud scheduler jobs describe heali-reminders --location "${REGION}" --project "${PROJECT_ID}" &>/dev/null; then
    echo "   ✓ Cloud Scheduler job already exists"
  else
    gcloud scheduler jobs create http heali-reminders \
      --schedule="*/15 * * * *" \
      --uri="${APP_URL}/api/reminders/trigger" \
      --message-body="" \
      --headers="Authorization=Bearer ${TRIGGER_SECRET}" \
      --location="${REGION}" \
      --project "${PROJECT_ID}"
    echo "   ✓ Cloud Scheduler job created (fires every 15 min)"
  fi
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "✅  GCP setup complete!"
echo ""
echo "Next steps:"
echo "  1. Enable Google Sign-In in Firebase Console:"
echo "     https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
echo "  2. Run: bash scripts/deploy.sh"
echo "  3. Add the Cloud Run URL to Firebase Authorized Domains:"
echo "     https://console.firebase.google.com/project/${PROJECT_ID}/authentication/settings"
