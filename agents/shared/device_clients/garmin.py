"""Garmin — OAuth2 Health API integration.

API docs: https://developer.garmin.com/gc-developer-program/
Free tier: Developer program (apply for access).
Data: steps, heart rate, sleep, stress, body battery, respiration.
"""

from __future__ import annotations

import os
import logging

from agents.shared.device_clients.base import BaseDeviceClient

logger = logging.getLogger(__name__)


class GarminClient(BaseDeviceClient):
    provider_name = "garmin"
    oauth_type = "oauth2"
    base_url = "https://apis.garmin.com"
    auth_url = "https://connect.garmin.com/oauthConfirm"
    token_url = "https://connectapi.garmin.com/oauth-service/oauth/token"
    scopes = []

    def __init__(self) -> None:
        super().__init__()
        self.client_id = os.getenv("GARMIN_CLIENT_ID", os.getenv("GARMIN_CONSUMER_KEY", ""))
        self.client_secret = os.getenv("GARMIN_CLIENT_SECRET", os.getenv("GARMIN_CONSUMER_SECRET", ""))

    # ------------------------------------------------------------------
    # Data — Garmin Health API (wellness endpoints)
    # ------------------------------------------------------------------

    async def fetch_body_data(self, access_token: str, date: str) -> list[dict]:
        headers = self._auth_header(access_token)
        entries = []

        # Daily heart rate
        try:
            resp = await self._http.get(
                f"{self.base_url}/wellness-api/rest/dailies",
                params={"uploadStartTimeInSeconds": _date_to_epoch(date),
                        "uploadEndTimeInSeconds": _date_to_epoch(date) + 86400},
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                for daily in (data if isinstance(data, list) else [data]):
                    rhr = daily.get("restingHeartRateInBeatsPerMinute")
                    if rhr:
                        entries.append({
                            "vital_type": "resting_heart_rate",
                            "value": rhr,
                            "unit": "bpm",
                            "timestamp": f"{date}T12:00:00",
                            "source": "garmin",
                        })
                    avg_hr = daily.get("averageHeartRateInBeatsPerMinute")
                    if avg_hr:
                        entries.append({
                            "vital_type": "heart_rate",
                            "value": avg_hr,
                            "unit": "bpm",
                            "timestamp": f"{date}T12:00:00",
                            "source": "garmin",
                        })
                    spo2 = daily.get("averageSpo2")
                    if spo2:
                        entries.append({
                            "vital_type": "spo2",
                            "value": spo2,
                            "unit": "%",
                            "timestamp": f"{date}T08:00:00",
                            "source": "garmin",
                        })
        except Exception as exc:
            logger.debug("Garmin dailies fetch: %s", exc)

        return entries

    async def fetch_activity_data(self, access_token: str, date: str) -> list[dict]:
        headers = self._auth_header(access_token)
        entries = []

        try:
            resp = await self._http.get(
                f"{self.base_url}/wellness-api/rest/dailies",
                params={"uploadStartTimeInSeconds": _date_to_epoch(date),
                        "uploadEndTimeInSeconds": _date_to_epoch(date) + 86400},
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                for daily in (data if isinstance(data, list) else [data]):
                    steps = daily.get("steps")
                    if steps:
                        entries.append({
                            "vital_type": "steps",
                            "value": steps,
                            "unit": "steps",
                            "timestamp": f"{date}T23:59:00",
                            "source": "garmin",
                        })

                    distance_m = daily.get("distanceInMeters")
                    if distance_m:
                        entries.append({
                            "vital_type": "distance",
                            "value": round(distance_m / 1000, 2),
                            "unit": "km",
                            "timestamp": f"{date}T23:59:00",
                            "source": "garmin",
                        })

                    calories = daily.get("activeKilocalories")
                    if calories:
                        entries.append({
                            "vital_type": "calories_burned",
                            "value": calories,
                            "unit": "kcal",
                            "timestamp": f"{date}T23:59:00",
                            "source": "garmin",
                        })

                    active_secs = daily.get("moderateIntensityDurationInSeconds", 0) + \
                                  daily.get("vigorousIntensityDurationInSeconds", 0)
                    if active_secs:
                        entries.append({
                            "vital_type": "active_minutes",
                            "value": active_secs // 60,
                            "unit": "minutes",
                            "timestamp": f"{date}T23:59:00",
                            "source": "garmin",
                        })
        except Exception as exc:
            logger.debug("Garmin activity fetch: %s", exc)

        return entries

    async def fetch_sleep_data(self, access_token: str, date: str) -> list[dict]:
        headers = self._auth_header(access_token)
        entries = []

        try:
            resp = await self._http.get(
                f"{self.base_url}/wellness-api/rest/sleeps",
                params={"uploadStartTimeInSeconds": _date_to_epoch(date),
                        "uploadEndTimeInSeconds": _date_to_epoch(date) + 86400},
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                for sleep in (data if isinstance(data, list) else [data]):
                    duration_secs = sleep.get("durationInSeconds", 0)
                    if duration_secs:
                        entries.append({
                            "vital_type": "sleep_duration",
                            "value": round(duration_secs / 3600, 2),
                            "unit": "hours",
                            "timestamp": f"{date}T08:00:00",
                            "source": "garmin",
                        })
                    score = sleep.get("overallSleepScore", {})
                    if isinstance(score, dict):
                        score_val = score.get("value")
                    else:
                        score_val = score
                    if score_val:
                        entries.append({
                            "vital_type": "sleep_score",
                            "value": score_val,
                            "unit": "score",
                            "timestamp": f"{date}T08:00:00",
                            "source": "garmin",
                        })
        except Exception as exc:
            logger.debug("Garmin sleep fetch: %s", exc)

        return entries


def _date_to_epoch(date_str: str) -> int:
    """Convert YYYY-MM-DD to Unix epoch seconds (UTC midnight)."""
    from datetime import datetime, timezone
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())
