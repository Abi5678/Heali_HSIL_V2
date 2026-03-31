"""Simple symmetric encryption for OAuth tokens stored in Firestore.

Usage:
    from agents.shared.token_encryption import encrypt_token, decrypt_token

    encrypted = encrypt_token("access_token_abc123")
    plaintext = decrypt_token(encrypted)

Generate a key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

from __future__ import annotations

import os
import logging
import base64
import hashlib

logger = logging.getLogger(__name__)

_KEY = os.getenv("WEARABLE_TOKEN_ENCRYPTION_KEY", "")


def _get_fernet():
    """Get Fernet cipher. Falls back to a derived key if none set (dev only)."""
    try:
        from cryptography.fernet import Fernet
    except ImportError:
        logger.warning("cryptography not installed — tokens stored in plaintext")
        return None

    key = _KEY
    if not key:
        # Dev fallback: derive from a fixed phrase (NOT secure for production)
        logger.warning("WEARABLE_TOKEN_ENCRYPTION_KEY not set — using dev fallback")
        key = base64.urlsafe_b64encode(
            hashlib.sha256(b"heali-dev-token-key").digest()
        ).decode()

    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:
        logger.error("Invalid encryption key: %s", exc)
        return None


def encrypt_token(plaintext: str) -> str:
    """Encrypt a token string. Returns encrypted base64 or plaintext if crypto unavailable."""
    if not plaintext:
        return plaintext
    f = _get_fernet()
    if f is None:
        return plaintext
    return f.encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a token. Returns plaintext. If decryption fails, returns the input as-is."""
    if not ciphertext:
        return ciphertext
    f = _get_fernet()
    if f is None:
        return ciphertext
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except Exception:
        # Might already be plaintext (e.g. from before encryption was added)
        return ciphertext
