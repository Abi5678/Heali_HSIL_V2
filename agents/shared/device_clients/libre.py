"""FreeStyle Libre — LibreView API integration.

Uses LibreView's REST API (email/password auth, not OAuth2).
Data: CGM glucose readings from FreeStyle Libre sensors.
"""

from __future__ import annotations

import os
import logging

from agents.shared.device_clients.base import BaseDeviceClient

logger = logging.getLogger(__name__)

LIBRE_API_URL = "https://api.libreview.io"
LIBRE_API_HEADERS = {
    "Content-Type": "application/json",
    "product": "llu.android",
    "version": "4.7.0",
    "Accept-Encoding": "gzip",
}


class LibreClient(BaseDeviceClient):
    provider_name = "freestyle_libre"
    oauth_type = "credentials"  # email + password, not OAuth2
    base_url = LIBRE_API_URL

    def __init__(self) -> None:
        super().__init__()

    # ------------------------------------------------------------------
    # Auth — credentials-based (not OAuth redirect)
    # ------------------------------------------------------------------

    def get_authorization_url(self, state: str, redirect_uri: str) -> str:
        raise NotImplementedError(
            "LibreView uses email/password, not OAuth redirect."
        )

    async def authenticate(self, email: str, password: str) -> dict:
        """Login to LibreView and get a bearer token + patient ID."""
        try:
            resp = await self._http.post(
                f"{self.base_url}/llu/auth/login",
                json={"email": email, "password": password},
                headers=LIBRE_API_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            logger.warning("LibreView login failed: %s", exc)
            return {"error": str(exc)}

        auth_ticket = data.get("data", {}).get("authTicket", {})
        token = auth_ticket.get("token", "")
        if not token:
            return {"error": "No auth token in response"}

        # Get the patient connection ID
        patient_id = ""
        try:
            conn_resp = await self._http.get(
                f"{self.base_url}/llu/connections",
                headers={**LIBRE_API_HEADERS, "Authorization": f"Bearer {token}"},
            )
            conn_resp.raise_for_status()
            connections = conn_resp.json().get("data", [])
            if connections:
                patient_id = connections[0].get("patientId", "")
        except Exception as exc:
            logger.warning("LibreView connections fetch failed: %s", exc)

        return {
            "access_token": token,
            "refresh_token": "",  # LibreView tokens are long-lived
            "expires_in": 86400 * 30,  # ~30 days
            "patient_id": patient_id,
        }

    async def exchange_code(self, code: str, redirect_uri: str) -> dict:
        raise NotImplementedError("Use authenticate() for LibreView.")

    async def refresh_access_token(self, refresh_token: str) -> dict:
        raise NotImplementedError(
            "LibreView tokens are long-lived. Re-authenticate if expired."
        )

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------

    async def fetch_body_data(
        self, access_token: str, date: str, patient_id: str = ""
    ) -> list[dict]:
        """Fetch glucose readings from LibreView graph endpoint."""
        if not patient_id:
            # Try to get patient_id from connections
            try:
                resp = await self._http.get(
                    f"{self.base_url}/llu/connections",
                    headers={**LIBRE_API_HEADERS, "Authorization": f"Bearer {access_token}"},
                )
                resp.raise_for_status()
                connections = resp.json().get("data", [])
                if connections:
                    patient_id = connections[0].get("patientId", "")
            except Exception:
                pass

        if not patient_id:
            logger.warning("LibreView: no patient_id available")
            return []

        try:
            resp = await self._http.get(
                f"{self.base_url}/llu/connections/{patient_id}/graph",
                headers={**LIBRE_API_HEADERS, "Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            logger.warning("LibreView graph fetch failed: %s", exc)
            return []

        entries = []
        graph_data = data.get("data", {}).get("graphData", [])
        for reading in graph_data:
            value = reading.get("Value") or reading.get("ValueInMgPerDl")
            if value is None:
                continue
            ts = reading.get("Timestamp", reading.get("FactoryTimestamp", ""))
            entries.append({
                "vital_type": "glucose_cgm",
                "value": value,
                "unit": "mg/dL",
                "timestamp": ts,
                "source": "freestyle_libre",
            })
        return entries

    async def fetch_activity_data(self, access_token: str, date: str) -> list[dict]:
        return []

    async def fetch_sleep_data(self, access_token: str, date: str) -> list[dict]:
        return []
