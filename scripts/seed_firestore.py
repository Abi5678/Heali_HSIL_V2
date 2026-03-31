#!/usr/bin/env python3
"""Seed Firestore with demo data from mock_data.py.

Run once to populate the demo user's collections:
    python scripts/seed_firestore.py

Reads from agents/shared/mock_data.py (single source of truth).
Uses the sync Firestore client (this script runs outside the async event loop).
"""

import sys
from pathlib import Path

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
from dotenv import load_dotenv

load_dotenv()

from google.cloud import firestore

from agents.shared.mock_data import (
    PATIENT_PROFILE,
    MEDICATIONS,
    ADHERENCE_LOG,
    VITALS_LOG,
    MEALS_LOG,
)


def seed():
    """Populate Firestore with demo data."""
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "medlive-488722")
    db = firestore.Client(project=project)

    user_id = PATIENT_PROFILE["user_id"]
    user_ref = db.collection("users").document(user_id)

    print(f"Seeding Firestore (project={project}) for user '{user_id}'...")

    # 1. Patient profile (top-level document fields)
    profile_data = {k: v for k, v in PATIENT_PROFILE.items() if k != "user_id"}
    user_ref.set(profile_data)
    print(f"  ✓ Patient profile: {profile_data['name']}, age {profile_data['age']}")

    # 2. Medications subcollection
    for med in MEDICATIONS:
        user_ref.collection("medications").document(med["id"]).set(med)
    print(f"  ✓ {len(MEDICATIONS)} medications")

    # 3. Adherence log subcollection
    batch = db.batch()
    for i, entry in enumerate(ADHERENCE_LOG):
        ref = user_ref.collection("adherence_log").document()
        batch.set(ref, entry)
        # Firestore batches max 500 writes
        if (i + 1) % 450 == 0:
            batch.commit()
            batch = db.batch()
    batch.commit()
    print(f"  ✓ {len(ADHERENCE_LOG)} adherence log entries")

    # 4. Vitals log subcollection
    batch = db.batch()
    for entry in VITALS_LOG:
        ref = user_ref.collection("vitals_log").document()
        batch.set(ref, entry)
    batch.commit()
    print(f"  ✓ {len(VITALS_LOG)} vitals log entries")

    # 5. Meals log subcollection
    batch = db.batch()
    for entry in MEALS_LOG:
        ref = user_ref.collection("meals_log").document()
        batch.set(ref, entry)
    batch.commit()
    print(f"  ✓ {len(MEALS_LOG)} meals log entries")

    print(f"\nDone! Check Firebase Console: https://console.firebase.google.com/project/{project}/firestore")


if __name__ == "__main__":
    seed()
