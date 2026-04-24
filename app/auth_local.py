"""Local JWT authentication — replaces Firebase Auth for offline/local development.

Endpoints:
  POST /api/auth/register   { email, password, display_name? }
  POST /api/auth/login      { email, password }
  GET  /api/auth/me         Authorization: Bearer <token>

Users stored in data/users.db (separate from heali.db).
Passwords hashed with bcrypt directly (no passlib).
Tokens are HS256 JWTs signed with JWT_SECRET env var, valid for 30 days.
"""

import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import jwt
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

_USERS_DB = Path(os.getenv("SQLITE_USERS_DB", "data/users.db"))
_JWT_SECRET = os.getenv("JWT_SECRET")
if not _JWT_SECRET:
    # Fallback for local development: generate a random secret if not provided in environment.
    # This prevents using a hardcoded, publicly known secret.
    _JWT_SECRET = secrets.token_urlsafe(32)

_JWT_ALGORITHM = "HS256"
_TOKEN_EXPIRY_DAYS = 30


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

router = APIRouter()


# ---------------------------------------------------------------------------
# DB bootstrap
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    _USERS_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_USERS_DB))
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            uid          TEXT PRIMARY KEY,
            email        TEXT UNIQUE NOT NULL,
            display_name TEXT,
            password_hash TEXT NOT NULL,
            created_at   TEXT
        )
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def _create_token(uid: str, email: str, display_name: str | None) -> str:
    payload = {
        "uid": uid,
        "email": email,
        "display_name": display_name or "",
        "exp": datetime.now(timezone.utc) + timedelta(days=_TOKEN_EXPIRY_DAYS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def verify_local_token(token: str) -> dict:
    """Decode and verify a local JWT. Returns {"uid", "email", "display_name"}.

    Raises jwt.InvalidTokenError on failure (caller converts to HTTP 401).
    """
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM])
        return {
            "uid": payload["uid"],
            "email": payload.get("email", ""),
            "display_name": payload.get("display_name", ""),
        }
    except jwt.ExpiredSignatureError:
        raise jwt.InvalidTokenError("Token has expired")
    except Exception as exc:
        raise jwt.InvalidTokenError(str(exc))


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/register")
def register(body: RegisterRequest):
    """Create a new local user account and return a JWT."""
    with _get_conn() as conn:
        existing = conn.execute(
            "SELECT uid FROM users WHERE email=?", (body.email,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="An account with this email already exists.")

        uid = uuid.uuid4().hex
        password_hash = _hash_password(body.password)
        conn.execute(
            "INSERT INTO users (uid, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
            (uid, body.email, body.display_name, password_hash, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()

    token = _create_token(uid, body.email, body.display_name)
    return JSONResponse({
        "token": token,
        "uid": uid,
        "email": body.email,
        "display_name": body.display_name or "",
    })


@router.post("/login")
def login(body: LoginRequest):
    """Verify credentials and return a JWT."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT uid, display_name, password_hash FROM users WHERE email=?",
            (body.email,),
        ).fetchone()

    if not row or not _verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = _create_token(row["uid"], body.email, row["display_name"])
    return JSONResponse({
        "token": token,
        "uid": row["uid"],
        "email": body.email,
        "display_name": row["display_name"] or "",
    })


@router.get("/me")
def me(authorization: str = Header(default=None)):
    """Return the current user info from a valid JWT."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.split(" ", 1)[1]
    try:
        claims = verify_local_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    return JSONResponse(claims)
