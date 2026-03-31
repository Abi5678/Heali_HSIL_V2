"""Async Firestore service for MedLive patient data.

Singleton wrapper around google.cloud.firestore.AsyncClient.
Falls back to mock_data.py when Firestore is unavailable (local dev, tests).
"""

import logging
import os
import random
import string
from datetime import datetime, timedelta, timezone

from google.cloud.firestore import AsyncClient, Client

logger = logging.getLogger(__name__)


class FirestoreService:
    """Singleton async Firestore client wrapper.

    Usage:
        fs = FirestoreService.get_instance()
        fs.initialize()              # call once at app startup
        meds = await fs.get_medications("demo_user")
    """

    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            if os.getenv("USE_FIRESTORE", "false").lower() == "true":
                cls._instance = cls()
            else:
                from agents.shared.sqlite_service import SQLiteService
                cls._instance = SQLiteService()
        return cls._instance

    def __init__(self):
        self._db: AsyncClient | None = None
        self._sync_db: Client | None = None
        self._initialized = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def initialize(self):
        """Initialize the async Firestore client.

        Reads GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT from env.
        """
        if self._initialized:
            return
        try:
            project = os.getenv("GOOGLE_CLOUD_PROJECT", "medlive-488722")
            self._db = AsyncClient(project=project)
            self._sync_db = Client(project=project)
            self._initialized = True
            logger.info("FirestoreService initialized (project=%s)", project)
        except Exception as e:
            logger.warning("FirestoreService init failed, using mock data: %s", e)
            self._initialized = False

    @property
    def is_available(self) -> bool:
        return self._initialized and self._db is not None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _user_ref(self, user_id: str):
        """Shortcut to users/{user_id} document reference (async)."""
        return self._db.collection("users").document(user_id)

    def _sync_user_ref(self, user_id: str):
        """Shortcut to users/{user_id} document reference (sync)."""
        return self._sync_db.collection("users").document(user_id)

    # ------------------------------------------------------------------
    # Synchronous helpers for tools called from ADK's sync context
    # ------------------------------------------------------------------

    def get_medications_sync(self, user_id: str) -> list[dict]:
        """Synchronous version of get_medications."""
        docs = self._sync_user_ref(user_id).collection("medications").stream()
        meds = []
        for doc in docs:
            med = doc.to_dict()
            med["id"] = doc.id
            meds.append(med)
        return meds

    def get_adherence_log_sync(self, user_id: str, since_date: str | None = None) -> list[dict]:
        """Synchronous version of get_adherence_log."""
        ref = self._sync_user_ref(user_id).collection("adherence_log")
        if since_date:
            ref = ref.where("date", ">=", since_date)
        ref = ref.order_by("date")
        entries = []
        for doc in ref.stream():
            entries.append(doc.to_dict())
        return entries

    def add_adherence_entry_sync(self, user_id: str, entry: dict) -> None:
        """Synchronous version of add_adherence_entry."""
        self._sync_user_ref(user_id).collection("adherence_log").add(entry)

    def add_medication_sync(self, uid: str, name: str, schedule_type: str, dose_times: list[str], rxnorm_id: str = "", dosage: str = "", purpose: str = "") -> str:
        """Synchronous version of add_medication."""
        data = {
            "name": name,
            "schedule_type": schedule_type,
            "dose_times": dose_times,
            "rxnorm_id": rxnorm_id,
            "dosage": dosage,
            "purpose": purpose,
            "created_at": datetime.now(timezone.utc)
        }
        _, ref = self._sync_db.collection("users").document(uid).collection("medications").add(data)
        return ref.id

    def add_vitals_entry_sync(self, user_id: str, entry: dict) -> None:
        """Synchronous version of add_vitals_entry."""
        self._sync_user_ref(user_id).collection("vitals_log").add(entry)

    def add_meals_entry_sync(self, user_id: str, entry: dict) -> None:
        """Synchronous version of add_meals_entry."""
        self._sync_user_ref(user_id).collection("meals_log").add(entry)

    def add_emergency_incident_sync(self, user_id: str, incident: dict) -> str:
        """Synchronous version of add_emergency_incident."""
        _, ref = self._sync_user_ref(user_id).collection("emergency_incidents").add(incident)
        return ref.id

    def get_patient_profile_sync(self, user_id: str) -> dict | None:
        """Synchronous version of get_patient_profile."""
        doc = self._sync_db.collection("users").document(user_id).collection("profile").document("main").get()
        if doc.exists:
            data = doc.to_dict()
            data["user_id"] = user_id
            return data
        return None

    def add_call_log_sync(self, user_id: str, log: dict) -> str:
        """Synchronous version of add_call_log."""
        _, ref = self._sync_user_ref(user_id).collection("call_logs").add(log)
        return ref.id

    def get_exercise_progress_sync(self, user_id: str) -> int:
        """Get the last completed exercise number (sync)."""
        doc = self._sync_user_ref(user_id).collection("exercise_session_state").document("current").get()
        if doc.exists:
            return doc.to_dict().get("last_completed", 0)
        return 0

    def save_exercise_progress_sync(self, user_id: str, last_completed: int) -> None:
        """Save the last completed exercise number (sync)."""
        self._sync_user_ref(user_id).collection("exercise_session_state").document("current").set(
            {"last_completed": last_completed, "updated_at": datetime.now(timezone.utc)},
            merge=True
        )

    # ------------------------------------------------------------------
    # Patient Profile
    # ------------------------------------------------------------------

    async def get_patient_profile(self, user_id: str) -> dict | None:
        """Get patient profile document."""
        doc = await self._user_ref(user_id).get()
        if doc.exists:
            data = doc.to_dict()
            data["user_id"] = user_id
            return data
        return None

    # ------------------------------------------------------------------
    # Medications (DPDP / HIPAA Compliant Schema)
    # ------------------------------------------------------------------

    async def get_medications(self, user_id: str) -> list[dict]:
        """Get all medications for a user from users/{uid}/medications."""
        await self.log_access(user_id, "get_medications", "Read patient medications")
        docs = self._user_ref(user_id).collection("medications").stream()
        meds = []
        async for doc in docs:
            med = doc.to_dict()
            med["id"] = doc.id
            meds.append(med)
        return meds

    async def add_medication(self, uid: str, name: str, schedule_type: str, dose_times: list[str], rxnorm_id: str = "", dosage: str = "", purpose: str = "") -> str:
        """Add a medication to users/{uid}/medications with scheduling data."""
        data = {
            "name": name,
            "schedule_type": schedule_type,
            "dose_times": dose_times,
            "rxnorm_id": rxnorm_id,
            "dosage": dosage,
            "purpose": purpose,
            "created_at": datetime.now(timezone.utc)
        }
        _, ref = await self._db.collection("users").document(uid).collection("medications").add(data)
        await self.log_access(uid, "add_medication", f"Added medication {name}")
        return ref.id

    # ------------------------------------------------------------------
    # Adherence Log
    # ------------------------------------------------------------------

    async def get_adherence_log(
        self, user_id: str, since_date: str | None = None
    ) -> list[dict]:
        """Get adherence entries, optionally filtered by date >= since_date."""
        ref = self._user_ref(user_id).collection("adherence_log")
        if since_date:
            ref = ref.where("date", ">=", since_date)
        ref = ref.order_by("date")
        entries = []
        async for doc in ref.stream():
            entries.append(doc.to_dict())
        return entries

    async def add_adherence_entry(self, user_id: str, entry: dict) -> None:
        """Append an adherence log entry."""
        await (
            self._user_ref(user_id).collection("adherence_log").add(entry)
        )

    # ------------------------------------------------------------------
    # Vitals Log
    # ------------------------------------------------------------------

    async def get_vitals_log(
        self,
        user_id: str,
        vital_type: str | None = None,
        since_date: str | None = None,
    ) -> list[dict]:
        """Get vitals entries, optionally filtered by type and/or date."""
        ref = self._user_ref(user_id).collection("vitals_log")
        if vital_type:
            ref = ref.where("type", "==", vital_type)
        if since_date:
            ref = ref.where("date", ">=", since_date)
        ref = ref.order_by("date")
        entries = []
        async for doc in ref.stream():
            entries.append(doc.to_dict())
        return entries

    async def add_vitals_entry(self, user_id: str, entry: dict) -> None:
        """Append a vitals log entry."""
        await self._user_ref(user_id).collection("vitals_log").add(entry)

    # ------------------------------------------------------------------
    # Meals Log
    # ------------------------------------------------------------------

    async def get_meals_log(
        self, user_id: str, date: str | None = None
    ) -> list[dict]:
        """Get meals entries, optionally filtered by date."""
        ref = self._user_ref(user_id).collection("meals_log")
        if date:
            ref = ref.where("date", "==", date)
        entries = []
        async for doc in ref.stream():
            entries.append(doc.to_dict())
        return entries

    async def add_meals_entry(self, user_id: str, entry: dict) -> None:
        """Append a meals log entry."""
        await self._user_ref(user_id).collection("meals_log").add(entry)

    # ------------------------------------------------------------------
    # Family Alerts
    # ------------------------------------------------------------------

    async def add_family_alert(self, user_id: str, alert: dict) -> None:
        """Append a family alert entry."""
        await (
            self._user_ref(user_id).collection("family_alerts").add(alert)
        )

    # ------------------------------------------------------------------
    # Emergency Incidents
    # ------------------------------------------------------------------

    async def add_emergency_incident(self, user_id: str, incident: dict) -> str:
        """Store an emergency incident. Returns the auto-generated doc ID."""
        _, ref = await self._user_ref(user_id).collection("emergency_incidents").add(incident)
        return ref.id

    # ------------------------------------------------------------------
    # Safety Logs (3-Tier Alert Audit Trail)
    # ------------------------------------------------------------------

    def add_safety_log_sync(self, user_id: str, log: dict) -> str:
        """Store a safety alert log entry (sync). Returns doc ID."""
        _, ref = self._sync_user_ref(user_id).collection("safety_logs").add(log)
        return ref.id

    async def add_safety_log(self, user_id: str, log: dict) -> str:
        """Store a safety alert log entry. Returns doc ID."""
        _, ref = await self._user_ref(user_id).collection("safety_logs").add(log)
        return ref.id

    async def get_safety_logs(
        self, user_id: str, since_date: str | None = None, tier: str | None = None
    ) -> list[dict]:
        """Get safety logs, optionally filtered by date and tier."""
        ref = self._user_ref(user_id).collection("safety_logs")
        if tier:
            ref = ref.where("alert_tier", "==", tier)
        entries = []
        async for doc in ref.stream():
            d = doc.to_dict()
            d["id"] = doc.id
            entries.append(d)
        if since_date:
            entries = [e for e in entries if str(e.get("timestamp", "")) >= since_date]
        entries.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return entries

    # ------------------------------------------------------------------
    # Data Read Methods (for Clinical Brief)
    # ------------------------------------------------------------------

    async def get_emergency_incidents(self, user_id: str, since_date: str | None = None) -> list[dict]:
        """Get emergency incidents, optionally filtered by date."""
        ref = self._user_ref(user_id).collection("emergency_incidents")
        entries = []
        async for doc in ref.stream():
            d = doc.to_dict()
            d["id"] = doc.id
            entries.append(d)
        if since_date:
            entries = [e for e in entries if str(e.get("timestamp", "")) >= since_date]
        entries.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return entries

    async def get_symptoms(self, user_id: str, since_date: str | None = None) -> list[dict]:
        """Get symptoms, optionally filtered by date."""
        ref = self._user_ref(user_id).collection("symptoms")
        entries = []
        async for doc in ref.stream():
            d = doc.to_dict()
            d["id"] = doc.id
            entries.append(d)
        if since_date:
            entries = [e for e in entries if str(e.get("date", e.get("timestamp", ""))) >= since_date]
        entries.sort(key=lambda x: x.get("date", x.get("timestamp", "")), reverse=True)
        return entries

    # ------------------------------------------------------------------
    # Symptoms & OTC
    # ------------------------------------------------------------------

    async def add_symptom(self, user_id: str, entry: dict) -> str:
        """Store a symptom entry. Returns doc ID."""
        _, ref = await self._user_ref(user_id).collection("symptoms").add(entry)
        return ref.id

    def add_symptom_sync(self, user_id: str, entry: dict) -> str:
        """Store a symptom entry (sync). Returns doc ID."""
        _, ref = self._sync_user_ref(user_id).collection("symptoms").add(entry)
        return ref.id

    # ------------------------------------------------------------------
    # Call Logs
    # ------------------------------------------------------------------

    async def add_call_log(self, user_id: str, log: dict) -> str:
        """Store a call log entry. Returns the auto-generated doc ID."""
        _, ref = await self._user_ref(user_id).collection("call_logs").add(log)
        return ref.id

    # ------------------------------------------------------------------
    # Patient Profile & Settings (Hierarchical schema)
    # ------------------------------------------------------------------

    async def save_user_profile(self, uid: str, data: dict) -> None:
        """Upsert user profile in hierarchical structure: users/{uid}/profile/main
        """
        await self._db.collection("users").document(uid).collection("profile").document("main").set(data, merge=True)
        # Log this action for HIPAA/DPDP Act compliance
        await self.log_access(uid, "save_user_profile", "Updated user profile settings")
        logger.info("Profile saved for uid=%s keys=%s", uid, list(data.keys()))

    async def get_patient_profile(self, user_id: str) -> dict | None:
        """Get patient profile from users/{uid}/profile/main"""
        doc = await self._db.collection("users").document(user_id).collection("profile").document("main").get()
        if doc.exists:
            data = doc.to_dict()
            data["user_id"] = user_id
            return data
        return None

    async def get_or_create_profile(self, uid: str) -> dict | None:
        """Return existing profile or None if this is a first-time user."""
        return await self.get_patient_profile(uid)

    # ------------------------------------------------------------------
    # Health Restrictions
    # ------------------------------------------------------------------

    async def save_health_restrictions(self, uid: str, allergies: list[str], diet_type: str = "", current_medications: str = "") -> None:
        """Save dietary restrictions, allergies, and current medications to users/{uid}/health_restrictions/main"""
        data = {"allergies": allergies, "diet_type": diet_type, "current_medications": current_medications}
        await self._db.collection("users").document(uid).collection("health_restrictions").document("main").set(data, merge=True)
        await self.log_access(uid, "save_health_restrictions", "Updated allergy, diet, and medication information")

    async def get_health_restrictions(self, uid: str) -> dict:
        """Fetch health restrictions."""
        doc = await self._db.collection("users").document(uid).collection("health_restrictions").document("main").get()
        return doc.to_dict() if doc.exists else {"allergies": [], "diet_type": ""}

    # ------------------------------------------------------------------
    # Audit Logging (HIPAA / DPDP Act)
    # ------------------------------------------------------------------

    async def log_access(self, uid: str, feature: str, reason: str) -> None:
        """Record every access to profile, restrictions, and meds for HIPAA security compliance."""
        log_entry = {
            "timestamp": datetime.now(timezone.utc),
            "feature": feature,
            "reason": reason
        }
        await self._db.collection("users").document(uid).collection("access_logs").add(log_entry)


    # ------------------------------------------------------------------
    # Family Link Codes
    # ------------------------------------------------------------------

    def _family_link_ref(self, code: str):
        """Reference to family_links/{code} top-level document."""
        return self._db.collection("family_links").document(code)

    @staticmethod
    def _random_code(length: int = 5) -> str:
        chars = string.ascii_uppercase + string.digits
        return "".join(random.choices(chars, k=length))

    async def create_family_link(self, parent_uid: str, parent_name: str = "") -> str:
        """Generate a unique 5-char family link code and store it in Firestore.

        Retries up to 5 times to avoid collisions.
        Also writes the code into the parent's profile document.

        Returns the generated code string.
        """
        for _ in range(5):
            code = self._random_code()
            ref = self._family_link_ref(code)
            doc = await ref.get()
            if not doc.exists:
                now = datetime.now(timezone.utc)
                await ref.set(
                    {
                        "parent_uid": parent_uid,
                        "parent_name": parent_name,
                        "created_at": now,
                        "expires_at": now + timedelta(hours=24),
                        "linked_uids": [],
                    }
                )
                # Also store on parent profile for easy lookup
                await self.save_user_profile(uid=parent_uid, data={"family_link_code": code})
                logger.info("Family link created: code=%s uid=%s", code, parent_uid)
                return code
        raise RuntimeError("Failed to generate unique family link code")

    async def verify_family_link(self, code: str, caregiver_uid: str) -> dict:
        """Validate a family link code and attach the caregiver to the parent.

        Raises ValueError if the code is invalid or expired.
        Returns {"parent_name": str, "parent_uid": str, "linked": True}.
        """
        ref = self._family_link_ref(code)
        doc = await ref.get()
        if not doc.exists:
            raise ValueError(f"Invalid code: {code}")

        data = doc.to_dict()
        expires_at = data.get("expires_at")
        now = datetime.now(timezone.utc)

        # Firestore Timestamp → datetime comparison
        if hasattr(expires_at, "tzinfo") and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at and now > expires_at:
            raise ValueError("This code has expired. Please ask for a new one.")

        parent_uid = data.get("parent_uid", "")
        linked_uids = data.get("linked_uids", [])

        if caregiver_uid not in linked_uids:
            linked_uids.append(caregiver_uid)
            await ref.update({"linked_uids": linked_uids})

        logger.info("Family link verified: code=%s caregiver=%s", code, caregiver_uid)
        return {
            "parent_name": data.get("parent_name", ""),
            "parent_uid": parent_uid,
            "linked": True,
        }

    async def is_family_linked(self, caregiver_uid: str, patient_uid: str) -> bool:
        """Return True if caregiver_uid appears in a family_link owned by patient_uid.

        Used by the dashboard API to authorise cross-user data access.
        """
        ref = self._family_link_ref  # callable
        # Query: family_links where parent_uid == patient_uid AND
        #        linked_uids array contains caregiver_uid
        query = (
            self._db.collection("family_links")
            .where("parent_uid", "==", patient_uid)
            .where("linked_uids", "array_contains", caregiver_uid)
            .limit(1)
        )
        docs = [doc async for doc in query.stream()]
        return len(docs) > 0

    # ------------------------------------------------------------------
    # Prescriptions & Reports (Document Scanning)
    # ------------------------------------------------------------------

    async def add_prescription(self, user_id: str, data: dict) -> str:
        """Store a scanned prescription. Returns the auto-generated doc ID."""
        _, ref = await self._user_ref(user_id).collection("prescriptions").add(data)
        return ref.id

    async def add_report(self, user_id: str, data: dict) -> str:
        """Store a scanned lab report. Returns the auto-generated doc ID."""
        _, ref = await self._user_ref(user_id).collection("reports").add(data)
        return ref.id

    async def get_prescriptions(self, user_id: str) -> list[dict]:
        """Get all prescriptions for a user."""
        docs = self._user_ref(user_id).collection("prescriptions").stream()
        results = []
        async for doc in docs:
            d = doc.to_dict()
            d["id"] = doc.id
            results.append(d)
        return results

    async def get_reports(self, user_id: str) -> list[dict]:
        """Get all lab reports for a user."""
        docs = self._user_ref(user_id).collection("reports").stream()
        results = []
        async for doc in docs:
            d = doc.to_dict()
            d["id"] = doc.id
            results.append(d)
        return results

    # ------------------------------------------------------------------
    # Family Link Reverse-Lookup
    # ------------------------------------------------------------------

    async def get_linked_parent(self, caregiver_uid: str) -> dict | None:
        """Reverse-lookup: find the parent linked to this caregiver UID.

        Returns the parent's profile dict, or None if not found.
        """
        links = self._db.collection("family_links")
        query = links.where("linked_uids", "array_contains", caregiver_uid)
        async for doc in query.stream():
            link_data = doc.to_dict()
            parent_uid = link_data.get("parent_uid")
            if parent_uid:
                return await self.get_patient_profile(parent_uid)
        return None

    # ------------------------------------------------------------------
    # Reminder subscribers (FCM push)
    # ------------------------------------------------------------------

    async def list_reminder_subscribers(self) -> list[dict]:
        """List users who have at least one reminder enabled.

        Reads from reminder_subscribers collection.
        """
        ref = self._db.collection("reminder_subscribers")
        subscribers = []
        async for doc in ref.stream():
            data = doc.to_dict()
            if not any([
                data.get("reminder_meds_enabled"),
                data.get("reminder_lunch_enabled"),
                data.get("reminder_dinner_enabled"),
                data.get("reminder_glucose_enabled")
            ]):
                continue
            data["user_id"] = doc.id
            subscribers.append(data)
        return subscribers

    async def save_reminder_preferences(
        self,
        user_id: str,
        *,
        fcm_token: str | None = None,
        phone_number: str | None = None,
        reminder_meds_enabled: bool = True,
        reminder_lunch_enabled: bool = True,
        reminder_dinner_enabled: bool = True,
        reminder_glucose_enabled: bool = True,
        voice_reminders_enabled: bool = False,
        lunch_reminder_time: str = "12:00",
        dinner_reminder_time: str = "19:00",
        glucose_reminder_time: str = "08:00",
        timezone: str = "UTC",
    ) -> None:
        """Save reminder preferences and update the trigger list."""
        profile_data = {
            "reminder_meds_enabled": reminder_meds_enabled,
            "reminder_lunch_enabled": reminder_lunch_enabled,
            "reminder_dinner_enabled": reminder_dinner_enabled,
            "reminder_glucose_enabled": reminder_glucose_enabled,
            "voice_reminders_enabled": voice_reminders_enabled,
            "lunch_reminder_time": lunch_reminder_time,
            "dinner_reminder_time": dinner_reminder_time,
            "glucose_reminder_time": glucose_reminder_time,
            "timezone": timezone,
        }
        if fcm_token:
            profile_data["fcm_token"] = fcm_token
        if phone_number:
            profile_data["phone_number"] = phone_number

        profile_ref = self._db.collection("users").document(user_id).collection("profile").document("main")
        await profile_ref.set(profile_data, merge=True)
        
        # Sync to subscribers collection for efficient polling
        sub_data = {**profile_data}
        if fcm_token:
            sub_data["fcm_token"] = fcm_token
        if phone_number:
            sub_data["phone_number"] = phone_number
            
        await self._db.collection("reminder_subscribers").document(user_id).set(sub_data, merge=True)
        
        logger.info(
            "Reminder prefs saved for uid=%s voice=%s meds=%s glucose=%s",
            user_id,
            voice_reminders_enabled,
            reminder_meds_enabled,
            reminder_glucose_enabled,
        )

    # ------------------------------------------------------------------
    # Appointments
    # ------------------------------------------------------------------

    async def add_appointment(self, uid: str, data: dict):
        """Save an appointment to users/{uid}/appointments."""
        await self._user_ref(uid).collection("appointments").add(data)

    async def get_appointments(self, uid: str) -> list[dict]:
        """Get all appointments for a user, ordered by date descending."""
        docs = (
            self._user_ref(uid)
            .collection("appointments")
            .order_by("date_iso", direction="DESCENDING")
            .limit(10)
            .stream()
        )
        results = []
        async for doc in docs:
            entry = doc.to_dict()
            entry["id"] = doc.id
            results.append(entry)
        return results

    # ------------------------------------------------------------------
    # Food Logs
    # ------------------------------------------------------------------

    async def add_food_log(self, uid: str, data: dict):
        """Save a food log entry to users/{uid}/food_logs."""
        now = datetime.now(timezone.utc)
        data["timestamp"] = now.isoformat()
        data.setdefault("date", now.strftime("%Y-%m-%d"))
        await self._user_ref(uid).collection("food_logs").add(data)

    async def get_food_logs(self, uid: str, limit: int = 10, date: str | None = None) -> list[dict]:
        """Get recent food logs for a user, optionally filtered by date (YYYY-MM-DD)."""
        ref = self._user_ref(uid).collection("food_logs")
        if date:
            ref = ref.where("date", "==", date)
        docs = (
            ref
            .order_by("timestamp", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        results = []
        async for doc in docs:
            entry = doc.to_dict()
            entry["id"] = doc.id
            results.append(entry)
        return results

    async def delete_food_log(self, uid: str, log_id: str):
        """Delete a food log entry by document ID."""
        await self._user_ref(uid).collection("food_logs").document(log_id).delete()

    # ------------------------------------------------------------------
    # Exercise Sessions
    # ------------------------------------------------------------------

    async def add_exercise_session(self, uid: str, session: dict) -> str:
        """Create a new exercise session doc. Returns doc ID."""
        session_id = session.get("session_id", "")
        if session_id:
            await (
                self._user_ref(uid)
                .collection("exercise_sessions")
                .document(session_id)
                .set(session)
            )
            return session_id
        _, ref = await self._user_ref(uid).collection("exercise_sessions").add(session)
        return ref.id

    async def update_exercise_session(self, uid: str, session_id: str, data: dict) -> None:
        """Update an exercise session. If data has 'exercises' dict, appends it to the array."""
        from google.cloud.firestore import ArrayUnion

        ref = self._user_ref(uid).collection("exercise_sessions").document(session_id)
        exercise_entry = data.pop("exercises", None)
        if exercise_entry and isinstance(exercise_entry, dict):
            await ref.update({"exercises": ArrayUnion([exercise_entry])})
        if data:
            await ref.update(data)

    async def get_exercise_sessions(self, uid: str, limit: int = 10) -> list[dict]:
        """Get recent exercise sessions ordered by started_at desc."""
        docs = (
            self._user_ref(uid)
            .collection("exercise_sessions")
            .order_by("started_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        results = []
        async for doc in docs:
            entry = doc.to_dict()
            entry["id"] = doc.id
            results.append(entry)
        return results

    async def get_exercise_progress(self, user_id: str) -> int:
        """Get the last completed exercise number."""
        doc = await self._user_ref(user_id).collection("exercise_session_state").document("current").get()
        if doc.exists:
            return doc.to_dict().get("last_completed", 0)
        return 0

    async def save_exercise_progress(self, user_id: str, last_completed: int) -> None:
        """Save the last completed exercise number."""
        await self._user_ref(user_id).collection("exercise_session_state").document("current").set(
            {"last_completed": last_completed, "updated_at": datetime.now(timezone.utc)},
            merge=True
        )

    # ------------------------------------------------------------------
    # Wearable Connections
    # ------------------------------------------------------------------

    async def get_wearable_connections(self, user_id: str) -> list[dict]:
        """Get all wearable device connections for a user."""
        ref = self._user_ref(user_id).collection("wearable_connections")
        entries = []
        async for doc in ref.stream():
            d = doc.to_dict()
            d["id"] = doc.id
            entries.append(d)
        return entries

    async def save_wearable_connection(self, user_id: str, connection: dict) -> None:
        """Save or update a wearable provider connection (keyed by provider name)."""
        provider = connection.get("provider", "unknown")
        await (
            self._user_ref(user_id)
            .collection("wearable_connections")
            .document(provider)
            .set(connection, merge=True)
        )

    async def remove_wearable_connection(self, user_id: str, provider: str) -> None:
        """Remove a wearable provider connection."""
        await (
            self._user_ref(user_id)
            .collection("wearable_connections")
            .document(provider)
            .delete()
        )

    # ------------------------------------------------------------------
    # CGM Readings (optimised query over vitals_log)
    # ------------------------------------------------------------------

    async def get_cgm_readings(
        self, user_id: str, since_date: str | None = None, until_date: str | None = None
    ) -> list[dict]:
        """Get CGM glucose readings from vitals_log, ordered by timestamp."""
        return await self.get_vitals_log(user_id, vital_type="glucose_cgm", since_date=since_date)

    # ------------------------------------------------------------------
    # Batch vitals insert (for webhook bulk data)
    # ------------------------------------------------------------------

    async def add_vitals_batch(self, user_id: str, entries: list[dict]) -> None:
        """Batch insert multiple vitals entries."""
        for entry in entries:
            await self.add_vitals_entry(user_id, entry)

    # ------------------------------------------------------------------
    # OAuth state (temporary, for OAuth callback validation)
    # ------------------------------------------------------------------

    async def set_oauth_state(self, state: str, data: dict) -> None:
        """Store OAuth state token for validation during callback."""
        if not self.db:
            return
        doc_ref = self.db.collection("oauth_states").document(state)
        from datetime import datetime, timezone
        data["created_at"] = datetime.now(timezone.utc).isoformat()
        doc_ref.set(data)

    async def get_oauth_state(self, state: str) -> dict | None:
        """Retrieve and validate an OAuth state token."""
        if not self.db:
            return {"uid": "demo_user", "provider": "unknown"}
        doc_ref = self.db.collection("oauth_states").document(state)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        # Check expiry (10 min TTL)
        from datetime import datetime, timezone, timedelta
        created = data.get("created_at", "")
        if created:
            try:
                created_dt = datetime.fromisoformat(created)
                if datetime.now(timezone.utc) - created_dt > timedelta(minutes=10):
                    doc_ref.delete()
                    return None
            except Exception:
                pass
        return data

    async def delete_oauth_state(self, state: str) -> None:
        """Delete a used OAuth state token."""
        if not self.db:
            return
        self.db.collection("oauth_states").document(state).delete()
