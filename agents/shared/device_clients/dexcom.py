"""Dexcom CGM — OAuth2 direct integration.

API docs: https://developer.dexcom.com/
Free tier: personal use / development.
Data: Real-time glucose (EGV) every 5 minutes.
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timezone, timedelta

from agents.shared.device_clients.base import BaseDeviceClient

logger = logging.getLogger(__name__)


class DexcomClient(BaseDeviceClient):
    provider_name = "dexcom"
    oauth_type = "oauth2"

    # Sandbox: https://sandbox-api.dexcom.com  |  Prod: https://api.dexcom.com
    base_url = os.getenv("DEXCOM_BASE_URL", "https://sandbox-api.dexcom.com")
    auth_url = f"{os.getenv('DEXCOM_BASE_URL', 'https://sandbox-api.dexcom.com')}/v2/oauth2/login"
    token_url = f"{os.getenv('DEXCOM_BASE_URL', 'https://sandbox-api.dexcom.com')}/v2/oauth2/token"
    scopes = ["offline_access"]

    def __init__(self) -> None:
        super().__init__()
        self.client_id = os.getenv("DEXCOM_CLIENT_ID", "")
        self.client_secret = os.getenv("DEXCOM_CLIENT_SECRET", "")
        # Re-derive URLs from env at init time
        base = os.getenv("DEXCOM_BASE_URL", "https://sandbox-api.dexcom.com")
        self.base_url = base
        self.auth_url = f"{base}/v2/oauth2/login"
        self.token_url = f"{base}/v2/oauth2/token"

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------

    async def fetch_body_data(self, access_token: str, date: str) -> list[dict]:
        """Fetch estimated glucose values (EGVs) for a date."""
        start = f"{date}T00:00:00"
        end = f"{date}T23:59:59"
        try:
            resp = await self._http.get(
                f"{self.base_url}/v2/users/self/egvs",
                params={"startDate": start, "endDate": end},
                headers=self._auth_header(access_token),
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            logger.warning("Dexcom EGV fetch failed: %s", exc)
            return []

        entries = []
        for egv in data.get("egvs", []):
            value = egv.get("value") or egv.get("realtimeValue")
            if value is None:
                continue
            entries.append({
                "vital_type": "glucose_cgm",
                "value": value,
                "unit": "mg/dL",
                "timestamp": egv.get("systemTime", egv.get("displayTime", "")),
                "source": "dexcom",
                "trend": egv.get("trend", ""),
                "trend_rate": egv.get("trendRate", 0),
            })
        return entries

    async def fetch_activity_data(self, access_token: str, date: str) -> list[dict]:
        """Dexcom has no activity data."""
        return []

    async def fetch_sleep_data(self, access_token: str, date: str) -> list[dict]:
        """Dexcom has no sleep data."""
        return []
