"""Fitbit — OAuth2 direct integration.

API docs: https://dev.fitbit.com/build/reference/web-api/
Free tier: personal apps (unlimited for a single user).
Data: heart rate, SpO2, steps, distance, calories, sleep, temperature.
"""

from __future__ import annotations

import os
import logging
import base64

from agents.shared.device_clients.base import BaseDeviceClient

logger = logging.getLogger(__name__)


class FitbitClient(BaseDeviceClient):
    provider_name = "fitbit"
    oauth_type = "oauth2"
    base_url = "https://api.fitbit.com"
    auth_url = "https://www.fitbit.com/oauth2/authorize"
    token_url = "https://api.fitbit.com/oauth2/token"
    scopes = [
        "activity",
        "heartrate",
        "sleep",
        "oxygen_saturation",
        "temperature",
        "profile",
    ]

    def __init__(self) -> None:
        super().__init__()
        self.client_id = os.getenv("FITBIT_CLIENT_ID", "")
        self.client_secret = os.getenv("FITBIT_CLIENT_SECRET", "")

    # Fitbit requires Basic auth header for token exchange
    async def exchange_code(self, code: str, redirect_uri: str) -> dict:
        credentials = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()
        ).decode()
        resp = await self._http.post(
            self.token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", ""),
            "expires_in": data.get("expires_in", 28800),
            "token_type": data.get("token_type", "Bearer"),
        }

    async def refresh_access_token(self, refresh_token: str) -> dict:
        credentials = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()
        ).decode()
        resp = await self._http.post(
            self.token_url,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", refresh_token),
            "expires_in": data.get("expires_in", 28800),
        }

    async def revoke_token(self, access_token: str) -> bool:
        try:
            credentials = base64.b64encode(
                f"{self.client_id}:{self.client_secret}".encode()
            ).decode()
            await self._http.post(
                "https://api.fitbit.com/oauth2/revoke",
                data={"token": access_token},
                headers={"Authorization": f"Basic {credentials}"},
            )
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------

    async def fetch_body_data(self, access_token: str, date: str) -> list[dict]:
        headers = self._auth_header(access_token)
        entries = []

        # Heart rate
        try:
            resp = await self._http.get(
                f"{self.base_url}/1/user/-/activities/heart/date/{date}/1d.json",
                headers=headers,
            )
            resp.raise_for_status()
            hr_data = resp.json()
            zones = hr_data.get("activities-heart", [])
            if zones:
                resting = zones[0].get("value", {}).get("restingHeartRate")
                if resting:
                    entries.append({
                        "vital_type": "resting_heart_rate",
                        "value": resting,
                        "unit": "bpm",
                        "timestamp": f"{date}T12:00:00",
                        "source": "fitbit",
                    })
                # Intraday HR (if authorized) — use summary avg
                intraday = hr_data.get("activities-heart-intraday", {}).get("dataset", [])
                if intraday:
                    avg_hr = sum(d["value"] for d in intraday) // len(intraday)
                    entries.append({
                        "vital_type": "heart_rate",
                        "value": avg_hr,
                        "unit": "bpm",
                        "timestamp": f"{date}T12:00:00",
                        "source": "fitbit",
                    })
        except Exception as exc:
            logger.debug("Fitbit HR fetch: %s", exc)

        # SpO2
        try:
            resp = await self._http.get(
                f"{self.base_url}/1/user/-/spo2/date/{date}.json",
                headers=headers,
            )
            if resp.status_code == 200:
                spo2_data = resp.json()
                avg_spo2 = spo2_data.get("value", {}).get("avg")
                if avg_spo2:
                    entries.append({
                        "vital_type": "spo2",
                        "value": avg_spo2,
                        "unit": "%",
                        "timestamp": f"{date}T08:00:00",
                        "source": "fitbit",
                    })
        except Exception as exc:
            logger.debug("Fitbit SpO2 fetch: %s", exc)

        # Skin temperature
        try:
            resp = await self._http.get(
                f"{self.base_url}/1/user/-/temp/skin/date/{date}.json",
                headers=headers,
            )
            if resp.status_code == 200:
                temp_data = resp.json()
                temps = temp_data.get("tempSkin", [])
                if temps:
                    deviation = temps[0].get("value", {}).get("nightlyRelative")
                    if deviation is not None:
                        # Relative to baseline (~97.7F / 36.5C)
                        entries.append({
                            "vital_type": "body_temperature",
                            "value": round(36.5 + deviation, 1),
                            "unit": "C",
                            "timestamp": f"{date}T06:00:00",
                            "source": "fitbit",
                        })
        except Exception as exc:
            logger.debug("Fitbit temp fetch: %s", exc)

        return entries

    async def fetch_activity_data(self, access_token: str, date: str) -> list[dict]:
        headers = self._auth_header(access_token)
        entries = []

        try:
            resp = await self._http.get(
                f"{self.base_url}/1/user/-/activities/date/{date}.json",
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            summary = data.get("summary", {})

            steps = summary.get("steps")
            if steps is not None:
                entries.append({
                    "vital_type": "steps",
                    "value": steps,
                    "unit": "steps",
                    "timestamp": f"{date}T23:59:00",
                    "source": "fitbit",
                })

            distance_km = 0
            for d in summary.get("distances", []):
                if d.get("activity") == "total":
                    distance_km = d.get("distance", 0)
                    break
            if distance_km:
                entries.append({
                    "vital_type": "distance",
                    "value": round(distance_km, 2),
                    "unit": "km",
                    "timestamp": f"{date}T23:59:00",
                    "source": "fitbit",
                })

            calories = summary.get("caloriesOut")
            if calories:
                entries.append({
                    "vital_type": "calories_burned",
                    "value": calories,
                    "unit": "kcal",
                    "timestamp": f"{date}T23:59:00",
                    "source": "fitbit",
                })

            active_mins = (
                summary.get("fairlyActiveMinutes", 0)
                + summary.get("veryActiveMinutes", 0)
            )
            if active_mins:
                entries.append({
                    "vital_type": "active_minutes",
                    "value": active_mins,
                    "unit": "minutes",
                    "timestamp": f"{date}T23:59:00",
                    "source": "fitbit",
                })
        except Exception as exc:
            logger.debug("Fitbit activity fetch: %s", exc)

        return entries

    async def fetch_sleep_data(self, access_token: str, date: str) -> list[dict]:
        headers = self._auth_header(access_token)
        entries = []

        try:
            resp = await self._http.get(
                f"{self.base_url}/1.2/user/-/sleep/date/{date}.json",
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            summary = data.get("summary", {})

            total_minutes = summary.get("totalMinutesAsleep", 0)
            if total_minutes:
                entries.append({
                    "vital_type": "sleep_duration",
                    "value": round(total_minutes / 60, 2),
                    "unit": "hours",
                    "timestamp": f"{date}T08:00:00",
                    "source": "fitbit",
                })

            # Fitbit sleep score (only on newer devices)
            sleep_logs = data.get("sleep", [])
            if sleep_logs:
                score = sleep_logs[0].get("efficiency")
                if score:
                    entries.append({
                        "vital_type": "sleep_score",
                        "value": score,
                        "unit": "score",
                        "timestamp": f"{date}T08:00:00",
                        "source": "fitbit",
                    })
        except Exception as exc:
            logger.debug("Fitbit sleep fetch: %s", exc)

        return entries
