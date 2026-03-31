"""SQLite-backed drop-in replacement for FirestoreService.

Used when USE_FIRESTORE=false (the default for local development).
All public method signatures are identical to FirestoreService so no
caller code needs to change.

Data model: every Firestore "collection + document" maps to a single
SQLite table row stored as a JSON blob. This keeps the schema flexible
(fields can vary per document) and migration-free.

DB file: data/heali.db  (created automatically on first use)
"""

import contextlib
import json
import logging
import os
import random
import sqlite3
import string
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

_DB_PATH = Path(os.getenv("SQLITE_DB_PATH", "data/heali.db"))

# Tables that hold one document per user (keyed by user_id instead of random id)
_SINGLETON_TABLES = {"profiles", "health_restrictions", "exercise_session_state"}


def _ensure_db_dir():
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _new_id() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Schema bootstrap
# ---------------------------------------------------------------------------

_TABLES = [
    "profiles",
    "health_restrictions",
    "access_logs",
    "medications",
    "adherence_log",
    "vitals_log",
    "meals_log",
    "family_alerts",
    "emergency_incidents",
    "call_logs",
    "symptoms",
    "otc_log",
    "prescriptions",
    "reports",
    "appointments",
    "food_logs",
    "exercise_sessions",
    "exercise_session_state",
    "family_links",
    "reminder_subscribers",
    "safety_logs",
    "wearable_connections",
]

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS {table} (
    id         TEXT PRIMARY KEY,
    user_id    TEXT,
    data       TEXT NOT NULL,
    created_at TEXT
);
"""

_OAUTH_STATES_SQL = """
CREATE TABLE IF NOT EXISTS oauth_states (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    created_at TEXT
);
"""

_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_{table}_user_id ON {table}(user_id);"


def _bootstrap_sync(conn: sqlite3.Connection):
    for table in _TABLES:
        conn.execute(_CREATE_SQL.format(table=table))
        if table not in ("family_links", "reminder_subscribers"):
            conn.execute(_INDEX_SQL.format(table=table))
    conn.execute(_OAUTH_STATES_SQL)
    conn.commit()


async def _bootstrap_async(conn: aiosqlite.Connection):
    for table in _TABLES:
        await conn.execute(_CREATE_SQL.format(table=table))
        if table not in ("family_links", "reminder_subscribers"):
            await conn.execute(_INDEX_SQL.format(table=table))
    await conn.execute(_OAUTH_STATES_SQL)
    await conn.commit()


# ---------------------------------------------------------------------------
# Sync helpers
# ---------------------------------------------------------------------------

def _sync_conn() -> sqlite3.Connection:
    _ensure_db_dir()
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    _bootstrap_sync(conn)
    return conn


def _sync_get(table: str, user_id: str, doc_id: str | None = None) -> dict | None:
    with _sync_conn() as conn:
        if doc_id:
            row = conn.execute(
                f"SELECT data FROM {table} WHERE id=? AND user_id=?", (doc_id, user_id)
            ).fetchone()
        else:
            row = conn.execute(
                f"SELECT data, id FROM {table} WHERE user_id=?", (user_id,)
            ).fetchone()
        if row:
            d = json.loads(row[0])
            if not doc_id and len(row) > 1:
                d["id"] = row[1]
            return d
        return None


def _sync_list(table: str, user_id: str, order_by: str | None = None, limit: int | None = None) -> list[dict]:
    sql = f"SELECT id, data FROM {table} WHERE user_id=?"
    if order_by:
        sql += f" ORDER BY json_extract(data, '$.{order_by}')"
    if limit:
        sql += f" LIMIT {limit}"
    with _sync_conn() as conn:
        rows = conn.execute(sql, (user_id,)).fetchall()
    results = []
    for row in rows:
        d = json.loads(row[1])
        d["id"] = row[0]
        results.append(d)
    return results


def _sync_insert(table: str, user_id: str, data: dict, doc_id: str | None = None) -> str:
    doc_id = doc_id or _new_id()
    now = datetime.now(timezone.utc).isoformat()
    # Serialise datetime values inside data
    serialised = _serialise(data)
    with _sync_conn() as conn:
        conn.execute(
            f"INSERT OR REPLACE INTO {table} (id, user_id, data, created_at) VALUES (?,?,?,?)",
            (doc_id, user_id, json.dumps(serialised), now),
        )
        conn.commit()
    return doc_id


def _sync_upsert(table: str, user_id: str, data: dict) -> None:
    """Merge data into existing row (singleton doc per user_id)."""
    with _sync_conn() as conn:
        existing_row = conn.execute(
            f"SELECT id, data FROM {table} WHERE user_id=?", (user_id,)
        ).fetchone()
        if existing_row:
            existing = json.loads(existing_row[1])
            existing.update(_serialise(data))
            conn.execute(
                f"UPDATE {table} SET data=? WHERE id=?",
                (json.dumps(existing), existing_row[0]),
            )
        else:
            doc_id = _new_id()
            conn.execute(
                f"INSERT INTO {table} (id, user_id, data, created_at) VALUES (?,?,?,?)",
                (doc_id, user_id, json.dumps(_serialise(data)), datetime.now(timezone.utc).isoformat()),
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Async helpers
# ---------------------------------------------------------------------------

@contextlib.asynccontextmanager
async def _async_conn():
    """Yield a bootstrapped aiosqlite connection.

    Usage: ``async with _async_conn() as conn:``
    """
    _ensure_db_dir()
    async with aiosqlite.connect(str(_DB_PATH)) as conn:
        conn.row_factory = aiosqlite.Row
        await _bootstrap_async(conn)
        yield conn


async def _async_get(table: str, user_id: str) -> dict | None:
    async with _async_conn() as conn:
        async with conn.execute(
            f"SELECT id, data FROM {table} WHERE user_id=? LIMIT 1", (user_id,)
        ) as cur:
            row = await cur.fetchone()
        if row:
            d = json.loads(row[1])
            d["id"] = row[0]
            return d
        return None


async def _async_list(
    table: str,
    user_id: str,
    order_by: str | None = None,
    order_desc: bool = False,
    limit: int | None = None,
    where_json_key: str | None = None,
    where_json_val=None,
) -> list[dict]:
    sql = f"SELECT id, data FROM {table} WHERE user_id=?"
    params: list = [user_id]
    if where_json_key and where_json_val is not None:
        sql += f" AND json_extract(data, '$.{where_json_key}')=?"
        params.append(str(where_json_val))
    if order_by:
        direction = "DESC" if order_desc else "ASC"
        sql += f" ORDER BY json_extract(data, '$.{order_by}') {direction}"
    if limit:
        sql += f" LIMIT ?"
        params.append(limit)
    async with _async_conn() as conn:
        async with conn.execute(sql, params) as cur:
            rows = await cur.fetchall()
    results = []
    for row in rows:
        d = json.loads(row[1])
        d["id"] = row[0]
        results.append(d)
    return results


async def _async_insert(table: str, user_id: str, data: dict, doc_id: str | None = None) -> str:
    doc_id = doc_id or _new_id()
    now = datetime.now(timezone.utc).isoformat()
    async with _async_conn() as conn:
        await conn.execute(
            f"INSERT OR REPLACE INTO {table} (id, user_id, data, created_at) VALUES (?,?,?,?)",
            (doc_id, user_id, json.dumps(_serialise(data)), now),
        )
        await conn.commit()
    return doc_id


async def _async_upsert(table: str, user_id: str, data: dict) -> None:
    """Merge data into existing singleton row (one doc per user)."""
    async with _async_conn() as conn:
        async with conn.execute(
            f"SELECT id, data FROM {table} WHERE user_id=? LIMIT 1", (user_id,)
        ) as cur:
            existing_row = await cur.fetchone()
        if existing_row:
            existing = json.loads(existing_row[1])
            existing.update(_serialise(data))
            await conn.execute(
                f"UPDATE {table} SET data=? WHERE id=?",
                (json.dumps(existing), existing_row[0]),
            )
        else:
            doc_id = _new_id()
            await conn.execute(
                f"INSERT INTO {table} (id, user_id, data, created_at) VALUES (?,?,?,?)",
                (doc_id, user_id, json.dumps(_serialise(data)), datetime.now(timezone.utc).isoformat()),
            )
        await conn.commit()


async def _async_delete(table: str, user_id: str, doc_id: str) -> None:
    async with _async_conn() as conn:
        await conn.execute(
            f"DELETE FROM {table} WHERE id=? AND user_id=?", (doc_id, user_id)
        )
        await conn.commit()


# ---------------------------------------------------------------------------
# Serialisation helper — convert non-JSON-serialisable types
# ---------------------------------------------------------------------------

def _serialise(obj):
    if isinstance(obj, dict):
        return {k: _serialise(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialise(v) for v in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


# ---------------------------------------------------------------------------
# SQLiteService — drop-in for FirestoreService
# ---------------------------------------------------------------------------

class SQLiteService:
    """SQLite-backed implementation with the same public API as FirestoreService."""

    # Expose db = None so any accidental fs.db usage gives a clear AttributeError
    db = None

    def initialize(self):
        """No-op — SQLite bootstraps on first query."""
        _ensure_db_dir()

    @property
    def is_available(self) -> bool:
        return True

    # ------------------------------------------------------------------
    # Sync helpers (ADK tool context)
    # ------------------------------------------------------------------

    def get_medications_sync(self, user_id: str) -> list[dict]:
        return _sync_list("medications", user_id)

    def get_adherence_log_sync(self, user_id: str, since_date: str | None = None) -> list[dict]:
        rows = _sync_list("adherence_log", user_id, order_by="date")
        if since_date:
            rows = [r for r in rows if r.get("date", "") >= since_date]
        return rows

    def add_adherence_entry_sync(self, user_id: str, entry: dict) -> None:
        _sync_insert("adherence_log", user_id, entry)

    def add_medication_sync(
        self, uid: str, name: str, schedule_type: str, dose_times: list[str],
        rxnorm_id: str = "", dosage: str = "", purpose: str = ""
    ) -> str:
        data = {
            "name": name, "schedule_type": schedule_type, "dose_times": dose_times,
            "rxnorm_id": rxnorm_id, "dosage": dosage, "purpose": purpose,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        return _sync_insert("medications", uid, data)

    def add_vitals_entry_sync(self, user_id: str, entry: dict) -> None:
        _sync_insert("vitals_log", user_id, entry)

    def add_meals_entry_sync(self, user_id: str, entry: dict) -> None:
        _sync_insert("meals_log", user_id, entry)

    def add_emergency_incident_sync(self, user_id: str, incident: dict) -> str:
        return _sync_insert("emergency_incidents", user_id, incident)

    def get_patient_profile_sync(self, user_id: str) -> dict | None:
        row = _sync_get("profiles", user_id)
        if row:
            row["user_id"] = user_id
        return row

    def add_call_log_sync(self, user_id: str, log: dict) -> str:
        return _sync_insert("call_logs", user_id, log)

    def get_exercise_progress_sync(self, user_id: str) -> int:
        row = _sync_get("exercise_session_state", user_id)
        return int(row.get("last_completed", 0)) if row else 0

    def save_exercise_progress_sync(self, user_id: str, last_completed: int) -> None:
        _sync_upsert("exercise_session_state", user_id, {
            "last_completed": last_completed,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    # ------------------------------------------------------------------
    # Async — Patient Profile
    # ------------------------------------------------------------------

    async def get_patient_profile(self, user_id: str) -> dict | None:
        row = await _async_get("profiles", user_id)
        if row:
            row["user_id"] = user_id
        return row

    async def get_or_create_profile(self, uid: str) -> dict | None:
        return await self.get_patient_profile(uid)

    async def save_user_profile(self, uid: str, data: dict) -> None:
        await _async_upsert("profiles", uid, data)
        await self.log_access(uid, "save_user_profile", "Updated user profile settings")
        logger.info("Profile saved for uid=%s keys=%s", uid, list(data.keys()))

    # ------------------------------------------------------------------
    # Async — Health Restrictions
    # ------------------------------------------------------------------

    async def get_health_restrictions(self, uid: str) -> dict:
        row = await _async_get("health_restrictions", uid)
        if row:
            row.pop("id", None)
            return row
        return {"allergies": [], "diet_type": ""}

    async def save_health_restrictions(
        self, uid: str, allergies: list[str], diet_type: str = "", current_medications: str = ""
    ) -> None:
        data = {"allergies": allergies, "diet_type": diet_type, "current_medications": current_medications}
        await _async_upsert("health_restrictions", uid, data)
        await self.log_access(uid, "save_health_restrictions", "Updated allergy, diet, and medication information")

    # ------------------------------------------------------------------
    # Async — Medications
    # ------------------------------------------------------------------

    async def get_medications(self, user_id: str) -> list[dict]:
        await self.log_access(user_id, "get_medications", "Read patient medications")
        return await _async_list("medications", user_id)

    async def add_medication(
        self, uid: str, name: str, schedule_type: str, dose_times: list[str],
        rxnorm_id: str = "", dosage: str = "", purpose: str = ""
    ) -> str:
        data = {
            "name": name, "schedule_type": schedule_type, "dose_times": dose_times,
            "rxnorm_id": rxnorm_id, "dosage": dosage, "purpose": purpose,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        doc_id = await _async_insert("medications", uid, data)
        await self.log_access(uid, "add_medication", f"Added medication {name}")
        return doc_id

    # ------------------------------------------------------------------
    # Async — Adherence Log
    # ------------------------------------------------------------------

    async def get_adherence_log(self, user_id: str, since_date: str | None = None) -> list[dict]:
        rows = await _async_list("adherence_log", user_id, order_by="date")
        if since_date:
            rows = [r for r in rows if r.get("date", "") >= since_date]
        return rows

    async def add_adherence_entry(self, user_id: str, entry: dict) -> None:
        await _async_insert("adherence_log", user_id, entry)

    # ------------------------------------------------------------------
    # Async — Vitals Log
    # ------------------------------------------------------------------

    async def get_vitals_log(
        self, user_id: str, vital_type: str | None = None, since_date: str | None = None
    ) -> list[dict]:
        rows = await _async_list("vitals_log", user_id, order_by="date")
        if vital_type:
            rows = [r for r in rows if r.get("type") == vital_type]
        if since_date:
            rows = [r for r in rows if r.get("date", "") >= since_date]
        return rows

    async def add_vitals_entry(self, user_id: str, entry: dict) -> None:
        await _async_insert("vitals_log", user_id, entry)

    # ------------------------------------------------------------------
    # Async — Meals Log
    # ------------------------------------------------------------------

    async def get_meals_log(self, user_id: str, date: str | None = None) -> list[dict]:
        rows = await _async_list("meals_log", user_id)
        if date:
            rows = [r for r in rows if r.get("date") == date]
        return rows

    async def add_meals_entry(self, user_id: str, entry: dict) -> None:
        await _async_insert("meals_log", user_id, entry)

    # ------------------------------------------------------------------
    # Async — Family Alerts / Emergency / Call Logs
    # ------------------------------------------------------------------

    async def add_family_alert(self, user_id: str, alert: dict) -> None:
        await _async_insert("family_alerts", user_id, alert)

    async def add_emergency_incident(self, user_id: str, incident: dict) -> str:
        return await _async_insert("emergency_incidents", user_id, incident)

    async def add_call_log(self, user_id: str, log: dict) -> str:
        return await _async_insert("call_logs", user_id, log)

    # ------------------------------------------------------------------
    # Async — Symptoms & OTC (new methods replacing raw fs.db calls)
    # ------------------------------------------------------------------

    async def add_symptom(self, user_id: str, entry: dict) -> str:
        return await _async_insert("symptoms", user_id, entry)

    def add_symptom_sync(self, user_id: str, entry: dict) -> str:
        return _sync_insert("symptoms", user_id, entry)

    async def add_otc_log(self, user_id: str, entry: dict) -> str:
        return await _async_insert("otc_log", user_id, entry)

    def add_otc_log_sync(self, user_id: str, entry: dict) -> str:
        return _sync_insert("otc_log", user_id, entry)

    # ------------------------------------------------------------------
    # Safety Logs (3-Tier Alert Audit Trail)
    # ------------------------------------------------------------------

    def add_safety_log_sync(self, user_id: str, log: dict) -> str:
        return _sync_insert("safety_logs", user_id, log)

    async def add_safety_log(self, user_id: str, log: dict) -> str:
        return await _async_insert("safety_logs", user_id, log)

    async def get_safety_logs(
        self, user_id: str, since_date: str | None = None, tier: str | None = None
    ) -> list[dict]:
        rows = await _async_list("safety_logs", user_id, order_by="timestamp", order_desc=True)
        if since_date:
            rows = [r for r in rows if r.get("timestamp", "") >= since_date]
        if tier:
            rows = [r for r in rows if r.get("alert_tier") == tier]
        return rows

    # ------------------------------------------------------------------
    # Data Read Methods (for Clinical Brief)
    # ------------------------------------------------------------------

    async def get_emergency_incidents(self, user_id: str, since_date: str | None = None) -> list[dict]:
        rows = await _async_list("emergency_incidents", user_id, order_by="timestamp", order_desc=True)
        if since_date:
            rows = [r for r in rows if r.get("timestamp", "") >= since_date]
        return rows

    async def get_symptoms(self, user_id: str, since_date: str | None = None) -> list[dict]:
        rows = await _async_list("symptoms", user_id, order_by="date", order_desc=True)
        if since_date:
            rows = [r for r in rows if r.get("date", r.get("timestamp", "")) >= since_date]
        return rows

    # ------------------------------------------------------------------
    # Async — HIPAA Audit Log
    # ------------------------------------------------------------------

    async def log_access(self, uid: str, feature: str, reason: str) -> None:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "feature": feature,
            "reason": reason,
        }
        await _async_insert("access_logs", uid, entry)

    # ------------------------------------------------------------------
    # Async — Family Links
    # ------------------------------------------------------------------

    @staticmethod
    def _random_code(length: int = 5) -> str:
        chars = string.ascii_uppercase + string.digits
        return "".join(random.choices(chars, k=length))

    async def create_family_link(self, parent_uid: str, parent_name: str = "") -> str:
        for _ in range(5):
            code = self._random_code()
            async with _async_conn() as conn:
                async with conn.execute(
                    "SELECT id FROM family_links WHERE id=?", (code,)
                ) as cur:
                    existing = await cur.fetchone()
            if not existing:
                now = datetime.now(timezone.utc)
                await _async_insert("family_links", parent_uid, {
                    "parent_uid": parent_uid,
                    "parent_name": parent_name,
                    "created_at": now.isoformat(),
                    "expires_at": (now + timedelta(hours=24)).isoformat(),
                    "linked_uids": [],
                }, doc_id=code)
                await self.save_user_profile(uid=parent_uid, data={"family_link_code": code})
                logger.info("Family link created: code=%s uid=%s", code, parent_uid)
                return code
        raise RuntimeError("Failed to generate unique family link code")

    async def verify_family_link(self, code: str, caregiver_uid: str) -> dict:
        async with _async_conn() as conn:
            async with conn.execute(
                "SELECT data FROM family_links WHERE id=?", (code,)
            ) as cur:
                row = await cur.fetchone()
        if not row:
            raise ValueError(f"Invalid code: {code}")
        data = json.loads(row[0])
        expires_at_str = data.get("expires_at", "")
        if expires_at_str:
            expires_at = datetime.fromisoformat(expires_at_str)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires_at:
                raise ValueError("This code has expired. Please ask for a new one.")
        linked_uids = data.get("linked_uids", [])
        if caregiver_uid not in linked_uids:
            linked_uids.append(caregiver_uid)
            data["linked_uids"] = linked_uids
            async with _async_conn() as conn:
                await conn.execute(
                    "UPDATE family_links SET data=? WHERE id=?",
                    (json.dumps(data), code)
                )
                await conn.commit()
        return {
            "parent_name": data.get("parent_name", ""),
            "parent_uid": data.get("parent_uid", ""),
            "linked": True,
        }

    async def is_family_linked(self, caregiver_uid: str, patient_uid: str) -> bool:
        async with _async_conn() as conn:
            async with conn.execute(
                "SELECT data FROM family_links WHERE user_id=?", (patient_uid,)
            ) as cur:
                rows = await cur.fetchall()
        for row in rows:
            data = json.loads(row[0])
            if caregiver_uid in data.get("linked_uids", []):
                return True
        return False

    async def get_linked_parent(self, caregiver_uid: str) -> dict | None:
        async with _async_conn() as conn:
            async with conn.execute("SELECT data FROM family_links") as cur:
                rows = await cur.fetchall()
        for row in rows:
            data = json.loads(row[0])
            if caregiver_uid in data.get("linked_uids", []):
                parent_uid = data.get("parent_uid")
                if parent_uid:
                    return await self.get_patient_profile(parent_uid)
        return None

    # ------------------------------------------------------------------
    # Async — Prescriptions & Reports
    # ------------------------------------------------------------------

    async def add_prescription(self, user_id: str, data: dict) -> str:
        return await _async_insert("prescriptions", user_id, data)

    async def add_report(self, user_id: str, data: dict) -> str:
        return await _async_insert("reports", user_id, data)

    async def get_prescriptions(self, user_id: str) -> list[dict]:
        return await _async_list("prescriptions", user_id)

    async def get_reports(self, user_id: str) -> list[dict]:
        return await _async_list("reports", user_id)

    # ------------------------------------------------------------------
    # Async — Reminders
    # ------------------------------------------------------------------

    async def list_reminder_subscribers(self) -> list[dict]:
        async with _async_conn() as conn:
            async with conn.execute("SELECT id, data FROM reminder_subscribers") as cur:
                rows = await cur.fetchall()
        subscribers = []
        for row in rows:
            data = json.loads(row[1])
            if not any([
                data.get("reminder_meds_enabled"),
                data.get("reminder_lunch_enabled"),
                data.get("reminder_dinner_enabled"),
                data.get("reminder_glucose_enabled"),
            ]):
                continue
            data["user_id"] = row[0]
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
        profile_data: dict = {
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
        await _async_upsert("profiles", user_id, profile_data)
        await _async_upsert("reminder_subscribers", user_id, profile_data)

    # ------------------------------------------------------------------
    # Async — Appointments
    # ------------------------------------------------------------------

    async def add_appointment(self, uid: str, data: dict) -> None:
        await _async_insert("appointments", uid, data)

    async def get_appointments(self, uid: str) -> list[dict]:
        rows = await _async_list("appointments", uid, order_by="date_iso", order_desc=True, limit=10)
        return rows

    # ------------------------------------------------------------------
    # Async — Food Logs
    # ------------------------------------------------------------------

    async def add_food_log(self, uid: str, data: dict) -> None:
        now = datetime.now(timezone.utc)
        data["timestamp"] = now.isoformat()
        data.setdefault("date", now.strftime("%Y-%m-%d"))
        await _async_insert("food_logs", uid, data)

    async def get_food_logs(self, uid: str, limit: int = 10, date: str | None = None) -> list[dict]:
        rows = await _async_list("food_logs", uid, order_by="timestamp", order_desc=True, limit=limit)
        if date:
            rows = [r for r in rows if r.get("date") == date]
        return rows

    async def delete_food_log(self, uid: str, log_id: str) -> None:
        await _async_delete("food_logs", uid, log_id)

    # ------------------------------------------------------------------
    # Async — Exercise Sessions
    # ------------------------------------------------------------------

    async def add_exercise_session(self, uid: str, session: dict) -> str:
        session_id = session.get("session_id", "")
        doc_id = session_id or _new_id()
        await _async_insert("exercise_sessions", uid, session, doc_id=doc_id)
        return doc_id

    async def update_exercise_session(self, uid: str, session_id: str, data: dict) -> None:
        async with _async_conn() as conn:
            async with conn.execute(
                "SELECT data FROM exercise_sessions WHERE id=? AND user_id=?",
                (session_id, uid),
            ) as cur:
                row = await cur.fetchone()
        if not row:
            return
        existing = json.loads(row[0])
        exercise_entry = data.pop("exercises", None)
        if exercise_entry and isinstance(exercise_entry, dict):
            existing.setdefault("exercises", []).append(exercise_entry)
        existing.update(_serialise(data))
        async with _async_conn() as conn:
            await conn.execute(
                "UPDATE exercise_sessions SET data=? WHERE id=? AND user_id=?",
                (json.dumps(existing), session_id, uid),
            )
            await conn.commit()

    async def get_exercise_sessions(self, uid: str, limit: int = 10) -> list[dict]:
        return await _async_list(
            "exercise_sessions", uid, order_by="started_at", order_desc=True, limit=limit
        )

    async def get_exercise_progress(self, user_id: str) -> int:
        row = await _async_get("exercise_session_state", user_id)
        return int(row.get("last_completed", 0)) if row else 0

    async def save_exercise_progress(self, user_id: str, last_completed: int) -> None:
        await _async_upsert("exercise_session_state", user_id, {
            "last_completed": last_completed,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    # ------------------------------------------------------------------
    # Wearable Connections
    # ------------------------------------------------------------------

    async def get_wearable_connections(self, user_id: str) -> list[dict]:
        return await _async_list("wearable_connections", user_id)

    async def save_wearable_connection(self, user_id: str, connection: dict) -> None:
        provider = connection.get("provider", "unknown")
        await _async_insert("wearable_connections", user_id, connection, doc_id=f"{user_id}_{provider}")

    async def remove_wearable_connection(self, user_id: str, provider: str) -> None:
        await _async_delete("wearable_connections", user_id, f"{user_id}_{provider}")

    # ------------------------------------------------------------------
    # CGM Readings (optimised query over vitals_log)
    # ------------------------------------------------------------------

    async def get_cgm_readings(
        self, user_id: str, since_date: str | None = None, until_date: str | None = None
    ) -> list[dict]:
        return await self.get_vitals_log(user_id, vital_type="glucose_cgm", since_date=since_date)

    # ------------------------------------------------------------------
    # Batch vitals insert
    # ------------------------------------------------------------------

    async def add_vitals_batch(self, user_id: str, entries: list[dict]) -> None:
        for entry in entries:
            await self.add_vitals_entry(user_id, entry)

    # ------------------------------------------------------------------
    # OAuth state (temporary, for OAuth callback validation)
    # ------------------------------------------------------------------

    async def set_oauth_state(self, state: str, data: dict) -> None:
        """Store OAuth state token with a 10-minute TTL."""
        data["created_at"] = datetime.now(timezone.utc).isoformat()
        async with _async_conn() as conn:
            await conn.execute(
                "INSERT OR REPLACE INTO oauth_states (id, data, created_at) VALUES (?,?,?)",
                (state, json.dumps(_serialise(data)), data["created_at"]),
            )
            await conn.commit()

    async def get_oauth_state(self, state: str) -> dict | None:
        """Retrieve and validate an OAuth state token (10-min TTL)."""
        async with _async_conn() as conn:
            async with conn.execute(
                "SELECT data FROM oauth_states WHERE id=?", (state,)
            ) as cur:
                row = await cur.fetchone()
        if not row:
            return None
        data = json.loads(row[0])
        created = data.get("created_at", "")
        if created:
            try:
                created_dt = datetime.fromisoformat(created)
                if created_dt.tzinfo is None:
                    created_dt = created_dt.replace(tzinfo=timezone.utc)
                from datetime import timedelta
                if datetime.now(timezone.utc) - created_dt > timedelta(minutes=10):
                    await self.delete_oauth_state(state)
                    return None
            except Exception:
                pass
        return data

    async def delete_oauth_state(self, state: str) -> None:
        """Delete a used OAuth state token."""
        async with _async_conn() as conn:
            await conn.execute("DELETE FROM oauth_states WHERE id=?", (state,))
            await conn.commit()
