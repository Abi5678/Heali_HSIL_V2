"""Strava — OAuth2 direct integration.

API docs: https://developers.strava.com/
Free tier: 100 requests/15min, 1000/day.
Data: activities (distance, duration, heart rate, elevation).
"""

from __future__ import annotations

import os
import logging

from agents.shared.device_clients.base import BaseDeviceClient

logger = logging.getLogger(__name__)


class StravaClient(BaseDeviceClient):
    provider_name = "strava"
    oauth_type = "oauth2"
    base_url = "https://www.strava.com/api/v3"
    auth_url = "https://www.strava.com/oauth/authorize"
    token_url = "https://www.strava.com/oauth/token"
    scopes = ["read", "activity:read"]

    def __init__(self) -> None:
        super().__init__()
        self.client_id = os.getenv("STRAVA_CLIENT_ID", "")
        self.client_secret = os.getenv("STRAVA_CLIENT_SECRET", "")

    def get_authorization_url(self, state: str, redirect_uri: str) -> str:
        """Strava uses comma-separated scopes and approval_prompt."""
        scope = ",".join(self.scopes)
        return (
            f"{self.auth_url}?client_id={self.client_id}"
            f"&response_type=code&redirect_uri={redirect_uri}"
            f"&scope={scope}&state={state}&approval_prompt=auto"
        )

    async def revoke_token(self, access_token: str) -> bool:
        try:
            await self._http.post(
                "https://www.strava.com/oauth/deauthorize",
                data={"access_token": access_token},
            )
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------

    async def fetch_body_data(self, access_token: str, date: str) -> list[dict]:
        """Strava has no body/vitals data."""
        return []

    async def fetch_activity_data(self, access_token: str, date: str) -> list[dict]:
        headers = self._auth_header(access_token)
        entries = []

        try:
            # Get activities for the date
            from datetime import datetime, timezone
            dt = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            after = int(dt.timestamp())
            before = after + 86400

            resp = await self._http.get(
                f"{self.base_url}/athlete/activities",
                params={"after": after, "before": before, "per_page": 30},
                headers=headers,
            )
            resp.raise_for_status()
            activities = resp.json()
        except Exception as exc:
            logger.debug("Strava activities fetch: %s", exc)
            return []

        # Aggregate all activities for the day
        total_distance_m = 0
        total_calories = 0
        total_active_secs = 0
        avg_hr_sum = 0
        hr_count = 0

        for act in activities:
            total_distance_m += act.get("distance", 0)
            total_calories += act.get("kilojoules", 0) / 4.184 if act.get("kilojoules") else 0
            total_active_secs += act.get("moving_time", 0)

            hr = act.get("average_heartrate")
            if hr:
                avg_hr_sum += hr
                hr_count += 1

        if total_distance_m:
            entries.append({
                "vital_type": "distance",
                "value": round(total_distance_m / 1000, 2),
                "unit": "km",
                "timestamp": f"{date}T23:59:00",
                "source": "strava",
            })

        if total_calories:
            entries.append({
                "vital_type": "calories_burned",
                "value": round(total_calories),
                "unit": "kcal",
                "timestamp": f"{date}T23:59:00",
                "source": "strava",
            })

        if total_active_secs:
            entries.append({
                "vital_type": "active_minutes",
                "value": total_active_secs // 60,
                "unit": "minutes",
                "timestamp": f"{date}T23:59:00",
                "source": "strava",
            })

        if hr_count:
            entries.append({
                "vital_type": "heart_rate",
                "value": round(avg_hr_sum / hr_count),
                "unit": "bpm",
                "timestamp": f"{date}T18:00:00",
                "source": "strava",
            })

        return entries

    async def fetch_sleep_data(self, access_token: str, date: str) -> list[dict]:
        """Strava has no sleep data."""
        return []
