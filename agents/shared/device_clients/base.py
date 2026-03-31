"""Abstract base class for all wearable/CGM device API clients."""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class BaseDeviceClient(ABC):
    """Every provider client extends this to plug into the unified sync pipeline."""

    provider_name: str = ""
    oauth_type: str = "oauth2"  # "oauth2" | "oauth1a" | "credentials"
    base_url: str = ""
    auth_url: str = ""
    token_url: str = ""
    scopes: list[str] = []

    # Subclasses read their own env vars in __init__
    client_id: str = ""
    client_secret: str = ""

    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=30)

    async def close(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------
    # OAuth helpers
    # ------------------------------------------------------------------

    def get_authorization_url(self, state: str, redirect_uri: str) -> str:
        """Build the URL to redirect the user to for OAuth consent."""
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "state": state,
        }
        if self.scopes:
            params["scope"] = " ".join(self.scopes)
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.auth_url}?{qs}"

    async def exchange_code(self, code: str, redirect_uri: str) -> dict:
        """Exchange an authorization code for access + refresh tokens."""
        resp = await self._http.post(
            self.token_url,
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", ""),
            "expires_in": data.get("expires_in", 3600),
            "token_type": data.get("token_type", "Bearer"),
        }

    async def refresh_access_token(self, refresh_token: str) -> dict:
        """Use a refresh token to get a new access token."""
        resp = await self._http.post(
            self.token_url,
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", refresh_token),
            "expires_in": data.get("expires_in", 3600),
        }

    async def revoke_token(self, access_token: str) -> bool:
        """Attempt to revoke the token. Not all providers support this."""
        return True  # default no-op

    # ------------------------------------------------------------------
    # Data fetching — each returns list[dict] in Heali vitals_log shape
    # ------------------------------------------------------------------

    def _auth_header(self, access_token: str) -> dict:
        return {"Authorization": f"Bearer {access_token}"}

    @abstractmethod
    async def fetch_body_data(
        self, access_token: str, date: str
    ) -> list[dict]:
        """Fetch vitals: glucose, heart rate, SpO2, temperature.
        Returns list of dicts with keys: vital_type, value, unit, timestamp, source.
        """
        ...

    @abstractmethod
    async def fetch_activity_data(
        self, access_token: str, date: str
    ) -> list[dict]:
        """Fetch activity: steps, distance, calories, active_minutes.
        Returns list of dicts with keys: vital_type, value, unit, timestamp, source.
        """
        ...

    @abstractmethod
    async def fetch_sleep_data(
        self, access_token: str, date: str
    ) -> list[dict]:
        """Fetch sleep: duration, score.
        Returns list of dicts with keys: vital_type, value, unit, timestamp, source.
        """
        ...

    def is_configured(self) -> bool:
        """Check if this provider's credentials are set in env."""
        if self.oauth_type == "credentials":
            return True  # credentials-based clients check differently
        return bool(self.client_id and self.client_secret)
