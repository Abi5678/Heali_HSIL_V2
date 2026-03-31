"""Wearable & CGM Integration API — direct OAuth per provider, no Terra dependency."""

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from agents.shared.firestore_service import FirestoreService
from agents.shared.wearable_service import WearableService
from agents.shared.device_clients import PROVIDER_CLIENTS
from agents.shared.token_encryption import encrypt_token, decrypt_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wearables", tags=["wearables"])

OAUTH_CALLBACK_BASE = os.getenv(
    "OAUTH_CALLBACK_BASE_URL",
    os.getenv("MEDLIVE_APP_URL", "http://localhost:8000"),
).rstrip("/")

SUPPORTED_PROVIDERS = list(PROVIDER_CLIENTS.keys()) + ["apple"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _skip_auth() -> bool:
    v = os.getenv("SKIP_AUTH_FOR_TESTING", "false").lower()
    return v in ("1", "true", "yes")


def _verify_token(authorization: str | None) -> str:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if _skip_auth() and (not token or token == "demo"):
        return "demo_user"
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid auth token")
    try:
        import firebase_admin.auth as fb_auth
        decoded = fb_auth.verify_id_token(token)
        return decoded["uid"]
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {exc}")


def _redirect_uri(provider: str) -> str:
    return f"{OAUTH_CALLBACK_BASE}/api/wearables/callback/{provider}"


# ---------------------------------------------------------------------------
# GET /api/wearables/auth/{provider} — Start OAuth flow
# ---------------------------------------------------------------------------

@router.get("/auth/{provider}")
async def start_auth(provider: str, authorization: str | None = Header(None)):
    """Initiate OAuth authorization for a wearable provider."""
    uid = _verify_token(authorization)

    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    # Apple Health requires a native iOS app
    if provider == "apple":
        return {
            "auth_type": "native_only",
            "message": "Apple Health requires the Heali iOS app. Coming soon!",
        }

    # FreeStyle Libre uses email/password, not OAuth redirect
    if provider == "freestyle_libre":
        return {
            "auth_type": "credentials",
            "fields": ["email", "password"],
            "message": "Enter your LibreView email and password to connect.",
        }

    # Standard OAuth2 providers
    client_cls = PROVIDER_CLIENTS.get(provider)
    if not client_cls:
        raise HTTPException(status_code=400, detail=f"No client for {provider}")

    client = client_cls()
    if not client.is_configured():
        if _skip_auth():
            # Demo mode — return a mock success
            return {
                "auth_url": None,
                "demo_mode": True,
                "message": f"{provider.title()} API keys not configured. Using demo data.",
            }
        raise HTTPException(
            status_code=503, detail=f"{provider.title()} API not configured"
        )

    # Generate state token (encodes uid + provider for validation on callback)
    state = f"{uid}:{provider}:{secrets.token_urlsafe(16)}"
    # Store state temporarily (expires in 10 min)
    fs = FirestoreService.get_instance()
    await fs.set_oauth_state(state, {"uid": uid, "provider": provider})

    auth_url = client.get_authorization_url(state, _redirect_uri(provider))
    await client.close()

    return {"auth_url": auth_url, "auth_type": "oauth2"}


# ---------------------------------------------------------------------------
# POST /api/wearables/auth/freestyle_libre — LibreView credentials auth
# ---------------------------------------------------------------------------

class LibreCredentials(BaseModel):
    email: str
    password: str


@router.post("/auth/freestyle_libre")
async def libre_auth(creds: LibreCredentials, authorization: str | None = Header(None)):
    """Authenticate with LibreView using email + password."""
    uid = _verify_token(authorization)

    from agents.shared.device_clients.libre import LibreClient

    client = LibreClient()
    result = await client.authenticate(creds.email, creds.password)
    await client.close()

    if result.get("error"):
        raise HTTPException(status_code=401, detail=result["error"])

    # Store encrypted tokens
    fs = FirestoreService.get_instance()
    connection = {
        "provider": "freestyle_libre",
        "device": "FreeStyle Libre",
        "connected_at": datetime.now(timezone.utc).isoformat(),
        "last_sync": datetime.now(timezone.utc).isoformat(),
        "status": "active",
        "access_token": encrypt_token(result["access_token"]),
        "refresh_token": "",
        "token_expires_at": (
            datetime.now(timezone.utc) + timedelta(seconds=result.get("expires_in", 86400 * 30))
        ).isoformat(),
        "patient_id": result.get("patient_id", ""),
    }
    await fs.save_wearable_connection(uid, connection)

    return {"status": "connected", "provider": "freestyle_libre", "device": "FreeStyle Libre"}


# ---------------------------------------------------------------------------
# GET /api/wearables/callback/{provider} — OAuth callback
# ---------------------------------------------------------------------------

@router.get("/callback/{provider}", response_class=HTMLResponse)
async def oauth_callback(provider: str, code: str = "", state: str = "", error: str = ""):
    """Handle OAuth callback — exchange code for tokens, close popup."""
    if error:
        return _callback_html(success=False, provider=provider, error=error)

    if not code or not state:
        return _callback_html(success=False, provider=provider, error="Missing code or state")

    # Validate state
    fs = FirestoreService.get_instance()
    state_data = await fs.get_oauth_state(state)
    if not state_data:
        return _callback_html(success=False, provider=provider, error="Invalid or expired state")

    uid = state_data["uid"]

    # Exchange code for tokens
    client_cls = PROVIDER_CLIENTS.get(provider)
    if not client_cls:
        return _callback_html(success=False, provider=provider, error=f"Unknown provider: {provider}")

    client = client_cls()
    try:
        tokens = await client.exchange_code(code, _redirect_uri(provider))
    except Exception as exc:
        await client.close()
        return _callback_html(success=False, provider=provider, error=str(exc))
    await client.close()

    # Store encrypted tokens
    connection = {
        "provider": provider,
        "device": provider.replace("_", " ").title(),
        "connected_at": datetime.now(timezone.utc).isoformat(),
        "last_sync": datetime.now(timezone.utc).isoformat(),
        "status": "active",
        "access_token": encrypt_token(tokens["access_token"]),
        "refresh_token": encrypt_token(tokens.get("refresh_token", "")),
        "token_expires_at": (
            datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
        ).isoformat(),
    }
    await fs.save_wearable_connection(uid, connection)

    # Cleanup state
    await fs.delete_oauth_state(state)

    return _callback_html(success=True, provider=provider)


def _callback_html(success: bool, provider: str, error: str = "") -> str:
    """HTML page that notifies the opener window and closes the popup."""
    status = "connected" if success else "error"
    msg = f"Connected to {provider.replace('_', ' ').title()}!" if success else f"Error: {error}"
    return f"""<!DOCTYPE html>
<html><head><title>Heali — {provider.title()}</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:400px;">
  <h2>{'✅' if success else '❌'} {msg}</h2>
  <p style="color:#666;">This window will close automatically.</p>
</div>
<script>
  if (window.opener) {{
    window.opener.postMessage({{
      type: "wearable_{status}",
      provider: "{provider}",
      error: "{error}"
    }}, "*");
  }}
  setTimeout(() => window.close(), 2000);
</script>
</body></html>"""


# ---------------------------------------------------------------------------
# GET /api/wearables/connections — List connected devices
# ---------------------------------------------------------------------------

@router.get("/connections")
async def get_connections(authorization: str | None = Header(None)):
    """List user's connected wearable devices and sync status."""
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()
    connections = await fs.get_wearable_connections(uid)

    # Strip sensitive fields before returning
    for conn in connections:
        conn.pop("access_token", None)
        conn.pop("refresh_token", None)
        conn.pop("token_expires_at", None)
        conn.pop("patient_id", None)

    # Fall back to mock data in demo mode
    if not connections and _skip_auth():
        from agents.shared.mock_data import WEARABLE_CONNECTIONS
        connections = WEARABLE_CONNECTIONS
    return {"connections": connections}


# ---------------------------------------------------------------------------
# DELETE /api/wearables/connections/{provider} — Disconnect a provider
# ---------------------------------------------------------------------------

@router.delete("/connections/{provider}")
async def disconnect_provider(provider: str, authorization: str | None = Header(None)):
    """Disconnect a wearable provider and revoke tokens."""
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()

    # Get stored token to revoke
    connections = await fs.get_wearable_connections(uid)
    access_token = None
    for conn in connections:
        if conn.get("provider") == provider:
            access_token = decrypt_token(conn.get("access_token", ""))
            break

    # Revoke token via provider API
    if access_token:
        client_cls = PROVIDER_CLIENTS.get(provider)
        if client_cls:
            client = client_cls()
            try:
                await client.revoke_token(access_token)
            except Exception:
                pass
            await client.close()

    await fs.remove_wearable_connection(uid, provider)
    return {"status": "ok", "provider": provider, "disconnected": True}


# ---------------------------------------------------------------------------
# POST /api/wearables/sync/{provider} — Force manual sync
# ---------------------------------------------------------------------------

@router.post("/sync/{provider}")
async def force_sync(provider: str, authorization: str | None = Header(None)):
    """Fetch latest data from a connected provider and store vitals."""
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()
    ws = WearableService.get_instance()

    # Get stored tokens
    connections = await fs.get_wearable_connections(uid)
    conn = None
    for c in connections:
        if c.get("provider") == provider:
            conn = c
            break

    if not conn:
        if _skip_auth():
            # Demo mode — update last_sync only
            await fs.save_wearable_connection(uid, {
                "provider": provider,
                "last_sync": datetime.now(timezone.utc).isoformat(),
                "status": "active",
            })
            return {"status": "ok", "provider": provider, "synced": True, "demo_mode": True}
        raise HTTPException(status_code=404, detail=f"Not connected to {provider}")

    access_token = decrypt_token(conn.get("access_token", ""))
    refresh_token = decrypt_token(conn.get("refresh_token", ""))

    # Check if token is expired and refresh
    expires_at = conn.get("token_expires_at", "")
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp_dt < datetime.now(timezone.utc) and refresh_token:
                client_cls = PROVIDER_CLIENTS.get(provider)
                if client_cls:
                    client = client_cls()
                    try:
                        new_tokens = await client.refresh_access_token(refresh_token)
                        access_token = new_tokens["access_token"]
                        refresh_token = new_tokens.get("refresh_token", refresh_token)
                        # Update stored tokens
                        await fs.save_wearable_connection(uid, {
                            "provider": provider,
                            "access_token": encrypt_token(access_token),
                            "refresh_token": encrypt_token(refresh_token),
                            "token_expires_at": (
                                datetime.now(timezone.utc) +
                                timedelta(seconds=new_tokens.get("expires_in", 3600))
                            ).isoformat(),
                        })
                    except Exception as exc:
                        await client.close()
                        raise HTTPException(status_code=401, detail=f"Token refresh failed: {exc}")
                    await client.close()
        except ValueError:
            pass

    # Fetch data from provider
    client_cls = PROVIDER_CLIENTS.get(provider)
    if not client_cls:
        raise HTTPException(status_code=400, detail=f"No client for {provider}")

    client = client_cls()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    all_entries: list[dict] = []

    try:
        if provider == "freestyle_libre":
            patient_id = conn.get("patient_id", "")
            body = await client.fetch_body_data(access_token, today, patient_id=patient_id)
        else:
            body = await client.fetch_body_data(access_token, today)
        activity = await client.fetch_activity_data(access_token, today)
        sleep = await client.fetch_sleep_data(access_token, today)
        all_entries = body + activity + sleep
    except Exception as exc:
        logger.warning("Sync fetch failed for %s: %s", provider, exc)
    finally:
        await client.close()

    # Store vitals
    if all_entries:
        # Convert to vitals_log format
        vitals = []
        for entry in all_entries:
            vitals.append({
                "type": entry["vital_type"],
                "value": entry["value"],
                "unit": entry["unit"],
                "date": today,
                "time": entry.get("timestamp", "").split("T")[-1] if "T" in entry.get("timestamp", "") else "",
                "timestamp": entry.get("timestamp", ""),
                "source": entry.get("source", provider),
            })
        await fs.add_vitals_batch(uid, vitals)

    # Check CGM alerts for glucose readings
    cgm_alerts = []
    glucose_entries = [e for e in all_entries if e.get("vital_type") == "glucose_cgm"]
    for i, entry in enumerate(glucose_entries):
        glucose_val = float(entry["value"])
        rate = None
        if i > 0:
            prev_val = float(glucose_entries[i - 1]["value"])
            rate = (glucose_val - prev_val) / 5.0
        alert = ws.check_cgm_alerts(glucose_val, rate, uid)
        if alert:
            alert["patient_acknowledged"] = False
            alert["resolution"] = None
            alert["human_notified"] = []
            await fs.add_safety_log(uid, alert)
            cgm_alerts.append(alert)

    # Update last sync
    await fs.save_wearable_connection(uid, {
        "provider": provider,
        "last_sync": datetime.now(timezone.utc).isoformat(),
        "status": "active",
    })

    return {
        "status": "ok",
        "provider": provider,
        "synced": True,
        "entries_count": len(all_entries),
        "alerts_count": len(cgm_alerts),
    }


# ---------------------------------------------------------------------------
# GET /api/wearables/cgm/current — Latest CGM reading + trend
# ---------------------------------------------------------------------------

@router.get("/cgm/current")
async def get_cgm_current(authorization: str | None = Header(None)):
    """Get the latest CGM glucose reading with trend arrow."""
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()
    ws = WearableService.get_instance()

    since = (datetime.now() - timedelta(hours=3)).strftime("%Y-%m-%d")
    readings = await fs.get_cgm_readings(uid, since_date=since)

    if not readings and _skip_auth():
        from agents.shared.mock_data import VITALS_LOG
        readings = [v for v in VITALS_LOG if v.get("type") == "glucose_cgm"]

    if not readings:
        return {"available": False, "message": "No CGM data available"}

    latest = readings[-1]
    trend_arrow = ws.calculate_trend_arrow(readings[-6:] if len(readings) >= 6 else readings)

    rate = None
    if len(readings) >= 2:
        prev = readings[-2]
        rate = (float(latest["value"]) - float(prev["value"])) / 5.0

    last_24h = [
        r for r in readings
        if r.get("date", "") >= (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    ]
    time_in_range = ws.calculate_time_in_range(last_24h)

    return {
        "available": True,
        "value": latest["value"],
        "unit": "mg/dL",
        "trend": trend_arrow,
        "rate_of_change": rate,
        "timestamp": latest.get("timestamp", latest.get("time", "")),
        "source": latest.get("source", "cgm"),
        "time_in_range": time_in_range,
    }


# ---------------------------------------------------------------------------
# GET /api/wearables/cgm/history — CGM readings for time range
# ---------------------------------------------------------------------------

@router.get("/cgm/history")
async def get_cgm_history(
    hours: int = 24,
    authorization: str | None = Header(None),
):
    """Get CGM glucose readings for a time range (for graphs)."""
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()
    ws = WearableService.get_instance()

    since = (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%d")
    readings = await fs.get_cgm_readings(uid, since_date=since)

    if not readings and _skip_auth():
        from agents.shared.mock_data import VITALS_LOG
        readings = [v for v in VITALS_LOG if v.get("type") == "glucose_cgm"]

    if readings:
        values = [float(r["value"]) for r in readings]
        avg_glucose = round(sum(values) / len(values), 1)
        time_in_range = ws.calculate_time_in_range(readings)
        gmi = ws.calculate_gmi(avg_glucose)
        hypo_events = sum(1 for v in values if v < 70)
        hyper_events = sum(1 for v in values if v > 180)
    else:
        avg_glucose = time_in_range = gmi = hypo_events = hyper_events = 0

    return {
        "readings": readings,
        "count": len(readings),
        "summary": {
            "avg_glucose": avg_glucose,
            "time_in_range": time_in_range,
            "gmi": gmi,
            "hypo_events": hypo_events,
            "hyper_events": hyper_events,
        },
    }
