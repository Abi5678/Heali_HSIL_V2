"""Wearable data normalization, device client registry, and CGM alert checker.

Replaces Terra API aggregator with direct free OAuth integrations per provider.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

from agents.shared.device_clients import PROVIDER_CLIENTS

# ---------------------------------------------------------------------------
# CGM alert thresholds (mg/dL)
# ---------------------------------------------------------------------------
CGM_THRESHOLDS = {
    "severe_hypo": 54,
    "hypo": 70,
    "low_warning": 80,
    "high_warning": 180,
    "hyper": 250,
    "severe_hyper": 400,
}

CGM_RATE_THRESHOLDS = {
    "rapid_drop": -3.0,   # mg/dL per minute
    "rapid_rise": 3.0,
}


class WearableService:
    """Wearable data normalization, CGM alerts, and device client registry.

    Uses direct OAuth per provider (Dexcom, Fitbit, Garmin, Strava, Libre)
    instead of the Terra paid aggregator.
    """

    _instance: WearableService | None = None

    @classmethod
    def get_instance(cls) -> WearableService:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_configured(self) -> bool:
        """True if at least one provider has credentials configured."""
        return any(cls().is_configured() for cls in PROVIDER_CLIENTS.values())

    @staticmethod
    def get_client(provider: str):
        """Instantiate and return a device client for the given provider."""
        client_cls = PROVIDER_CLIENTS.get(provider)
        if not client_cls:
            raise ValueError(f"Unknown provider: {provider}")
        return client_cls()

    # ------------------------------------------------------------------
    # Data normalization — kept for backward compat with any remaining
    # Terra-format data; new direct clients return Heali-format directly.
    # ------------------------------------------------------------------

    @staticmethod
    def normalize_body_data(terra_data: dict, provider: str) -> list[dict]:
        """Convert Terra body data → Heali vitals entries."""
        entries: list[dict] = []
        timestamp = terra_data.get("metadata", {}).get("start_time", datetime.now().isoformat())
        date_str = timestamp[:10] if len(timestamp) >= 10 else datetime.now().strftime("%Y-%m-%d")
        time_str = timestamp[11:16] if len(timestamp) >= 16 else datetime.now().strftime("%H:%M")

        # Glucose samples (CGM)
        glucose_data = terra_data.get("glucose_data", {})
        for sample in glucose_data.get("blood_glucose_samples", []):
            ts = sample.get("timestamp", timestamp)
            entries.append({
                "date": ts[:10],
                "time": ts[11:16] if len(ts) >= 16 else time_str,
                "timestamp": ts,
                "type": "glucose_cgm",
                "value": sample.get("blood_glucose_mg_per_dL") or sample.get("glucose_mg_per_dL", 0),
                "unit": "mg/dL",
                "source": provider,
            })

        # Heart rate
        hr_data = terra_data.get("heart_rate_data", {})
        if hr_data.get("summary", {}).get("avg_hr_bpm"):
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "heart_rate", "value": hr_data["summary"]["avg_hr_bpm"],
                "unit": "bpm", "source": provider,
            })
        if hr_data.get("summary", {}).get("resting_hr_bpm"):
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "resting_heart_rate", "value": hr_data["summary"]["resting_hr_bpm"],
                "unit": "bpm", "source": provider,
            })

        # HRV
        hrv = hr_data.get("summary", {}).get("avg_hrv_sdnn")
        if hrv:
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "heart_rate_variability", "value": round(hrv, 1),
                "unit": "ms", "source": provider,
            })

        # SpO2
        oxygen_data = terra_data.get("oxygen_data", {})
        if oxygen_data.get("avg_saturation_percentage"):
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "spo2", "value": round(oxygen_data["avg_saturation_percentage"], 1),
                "unit": "%", "source": provider,
            })

        # Temperature
        temp_data = terra_data.get("temperature_data", {})
        if temp_data.get("body_temperature_celsius"):
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "body_temperature", "value": round(temp_data["body_temperature_celsius"], 1),
                "unit": "°C", "source": provider,
            })

        return entries

    @staticmethod
    def normalize_activity_data(terra_data: dict, provider: str) -> list[dict]:
        """Convert Terra activity data → Heali vitals entries."""
        entries: list[dict] = []
        metadata = terra_data.get("metadata", {})
        timestamp = metadata.get("start_time", datetime.now().isoformat())
        date_str = timestamp[:10] if len(timestamp) >= 10 else datetime.now().strftime("%Y-%m-%d")
        time_str = timestamp[11:16] if len(timestamp) >= 16 else datetime.now().strftime("%H:%M")

        # Steps
        if terra_data.get("distance_data", {}).get("steps"):
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "steps", "value": terra_data["distance_data"]["steps"],
                "unit": "steps", "source": provider,
            })

        # Distance
        dist_m = terra_data.get("distance_data", {}).get("distance_meters")
        if dist_m:
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "distance", "value": round(dist_m / 1000, 2),
                "unit": "km", "source": provider,
            })

        # Calories
        cal = terra_data.get("calories_data", {}).get("total_burned_calories")
        if cal:
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "calories_burned", "value": round(cal),
                "unit": "kcal", "source": provider,
            })

        # Active minutes
        active_sec = terra_data.get("active_durations_data", {}).get("activity_seconds")
        if active_sec:
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "active_minutes", "value": round(active_sec / 60),
                "unit": "min", "source": provider,
            })

        # Heart rate during activity
        hr = terra_data.get("heart_rate_data", {}).get("summary", {}).get("avg_hr_bpm")
        if hr:
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "heart_rate", "value": hr,
                "unit": "bpm", "source": provider,
            })

        return entries

    @staticmethod
    def normalize_sleep_data(terra_data: dict, provider: str) -> list[dict]:
        """Convert Terra sleep data → Heali vitals entries."""
        entries: list[dict] = []
        metadata = terra_data.get("metadata", {})
        timestamp = metadata.get("start_time", datetime.now().isoformat())
        date_str = timestamp[:10] if len(timestamp) >= 10 else datetime.now().strftime("%Y-%m-%d")
        time_str = timestamp[11:16] if len(timestamp) >= 16 else datetime.now().strftime("%H:%M")

        # Sleep duration
        duration_sec = terra_data.get("sleep_durations_data", {}).get("asleep", {}).get("duration_asleep_state_seconds")
        if duration_sec:
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "sleep_duration", "value": round(duration_sec / 3600, 1),
                "unit": "hours", "source": provider,
            })

        # Sleep score (Fitbit provides this)
        overall = terra_data.get("sleep_durations_data", {}).get("sleep_efficiency")
        if overall:
            entries.append({
                "date": date_str, "time": time_str, "timestamp": timestamp,
                "type": "sleep_score", "value": round(overall),
                "unit": "score", "source": provider,
            })

        return entries

    # ------------------------------------------------------------------
    # CGM alert checking
    # ------------------------------------------------------------------

    @staticmethod
    def check_cgm_alerts(
        glucose_value: float,
        rate_of_change: float | None = None,
        user_id: str = "",
    ) -> dict | None:
        """Apply CGM thresholds. Returns a safety alert dict or None if normal."""

        alert: dict | None = None

        # Value-based thresholds
        if glucose_value < CGM_THRESHOLDS["severe_hypo"]:
            alert = {
                "alert_tier": "red",
                "trigger_source": "cgm_monitor",
                "symptoms": f"Severe hypoglycemia detected: {glucose_value} mg/dL",
                "action_taken": "emergency_protocol",
                "message": (
                    f"CRITICAL: Blood glucose is dangerously low at {glucose_value} mg/dL. "
                    "Eat fast-acting sugar immediately (glucose tablets, juice, or candy). "
                    "If unable to eat, call emergency services."
                ),
            }
        elif glucose_value < CGM_THRESHOLDS["hypo"]:
            alert = {
                "alert_tier": "amber",
                "trigger_source": "cgm_monitor",
                "symptoms": f"Hypoglycemia detected: {glucose_value} mg/dL",
                "action_taken": "family_chw_alert",
                "message": (
                    f"Your blood glucose is low at {glucose_value} mg/dL. "
                    "Please eat a snack with fast-acting carbohydrates."
                ),
            }
        elif glucose_value < CGM_THRESHOLDS["low_warning"]:
            alert = {
                "alert_tier": "green",
                "trigger_source": "cgm_monitor",
                "symptoms": f"Low glucose warning: {glucose_value} mg/dL",
                "action_taken": "logged_nudge",
                "message": (
                    f"Your glucose is trending low at {glucose_value} mg/dL. "
                    "Consider having a small snack."
                ),
            }
        elif glucose_value > CGM_THRESHOLDS["severe_hyper"]:
            alert = {
                "alert_tier": "red",
                "trigger_source": "cgm_monitor",
                "symptoms": f"Severe hyperglycemia detected: {glucose_value} mg/dL",
                "action_taken": "emergency_protocol",
                "message": (
                    f"CRITICAL: Blood glucose is dangerously high at {glucose_value} mg/dL. "
                    "Seek immediate medical care. Check for ketones if possible."
                ),
            }
        elif glucose_value > CGM_THRESHOLDS["hyper"]:
            alert = {
                "alert_tier": "amber",
                "trigger_source": "cgm_monitor",
                "symptoms": f"Hyperglycemia detected: {glucose_value} mg/dL",
                "action_taken": "family_chw_alert",
                "message": (
                    f"Your blood glucose is high at {glucose_value} mg/dL. "
                    "Check if you've taken your insulin/medication. Stay hydrated."
                ),
            }
        elif glucose_value > CGM_THRESHOLDS["high_warning"]:
            alert = {
                "alert_tier": "green",
                "trigger_source": "cgm_monitor",
                "symptoms": f"High glucose warning: {glucose_value} mg/dL",
                "action_taken": "logged_nudge",
                "message": (
                    f"Your glucose is elevated at {glucose_value} mg/dL. "
                    "Consider a walk or light activity to help bring it down."
                ),
            }

        # Rate-of-change thresholds (upgrade to amber if not already worse)
        if rate_of_change is not None and alert is None:
            if rate_of_change <= CGM_RATE_THRESHOLDS["rapid_drop"]:
                alert = {
                    "alert_tier": "amber",
                    "trigger_source": "cgm_monitor",
                    "symptoms": f"Rapid glucose drop: {rate_of_change:+.1f} mg/dL/min (current: {glucose_value})",
                    "action_taken": "family_chw_alert",
                    "message": (
                        f"Your glucose is dropping rapidly ({rate_of_change:+.1f} mg/dL/min). "
                        "Consider eating a snack to prevent a low."
                    ),
                }
            elif rate_of_change >= CGM_RATE_THRESHOLDS["rapid_rise"]:
                alert = {
                    "alert_tier": "green",
                    "trigger_source": "cgm_monitor",
                    "symptoms": f"Rapid glucose rise: {rate_of_change:+.1f} mg/dL/min (current: {glucose_value})",
                    "action_taken": "logged_nudge",
                    "message": (
                        f"Your glucose is rising quickly ({rate_of_change:+.1f} mg/dL/min). "
                        "This may be a post-meal spike — monitor closely."
                    ),
                }

        if alert:
            alert["timestamp"] = datetime.now().isoformat()
            alert["vitals_at_time"] = [{"type": "glucose_cgm", "value": str(glucose_value), "unit": "mg/dL"}]
            alert["user_id"] = user_id

        return alert

    # ------------------------------------------------------------------
    # CGM trend arrow calculation
    # ------------------------------------------------------------------

    @staticmethod
    def calculate_trend_arrow(readings: list[dict]) -> str:
        """Calculate CGM trend arrow from recent readings.

        Returns one of: ↑↑ (rising fast), ↑ (rising), ↗ (rising slowly),
        → (stable), ↘ (falling slowly), ↓ (falling), ↓↓ (falling fast)
        """
        if len(readings) < 2:
            return "→"

        # Use last 3 readings (15 min window) for trend
        recent = sorted(readings, key=lambda r: r.get("timestamp", r.get("time", "")))[-3:]
        first_val = float(recent[0].get("value", 0))
        last_val = float(recent[-1].get("value", 0))
        diff = last_val - first_val
        minutes = max(len(recent) * 5, 1)  # ~5 min per reading
        rate = diff / minutes

        if rate > 3:
            return "↑↑"
        elif rate > 2:
            return "↑"
        elif rate > 1:
            return "↗"
        elif rate > -1:
            return "→"
        elif rate > -2:
            return "↘"
        elif rate > -3:
            return "↓"
        else:
            return "↓↓"

    @staticmethod
    def calculate_time_in_range(readings: list[dict], low: float = 80, high: float = 180) -> float:
        """Calculate percentage of CGM readings within target range."""
        if not readings:
            return 0.0
        in_range = sum(1 for r in readings if low <= float(r.get("value", 0)) <= high)
        return round((in_range / len(readings)) * 100, 1)

    @staticmethod
    def calculate_gmi(avg_glucose: float) -> float:
        """Calculate Glucose Management Indicator (estimated A1c) from average glucose."""
        # GMI formula: 3.31 + (0.02392 × mean glucose in mg/dL)
        return round(3.31 + (0.02392 * avg_glucose), 1)
