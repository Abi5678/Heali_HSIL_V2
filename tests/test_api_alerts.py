import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock
import os
from datetime import datetime

# Import the app
from app.main import app

client = TestClient(app)

@pytest.fixture
def mock_skip_auth(monkeypatch):
    """Fixture to enable skip auth for testing."""
    monkeypatch.setenv("SKIP_AUTH_FOR_TESTING", "true")

def test_notify_chw_success(mock_skip_auth):
    """
    🎯 What: Verify that a valid CHW notification request returns 200 OK.
    📊 Scenarios: Valid payload, valid demo authorization.
    ✨ Result: Status 'sent' and correct message returned.
    """
    payload = {
        "patient_uid": "test_patient_123",
        "alert_tier": "critical",
        "symptoms": "Chest pain, shortness of breath",
        "message": "Immediate attention required"
    }
    response = client.post(
        "/api/alerts/chw",
        json=payload,
        headers={"Authorization": "Bearer demo"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "sent"
    assert data["channel"] == "demo_log"
    assert "test_patient_123" in data["message"]
    assert "critical" in data["message"]
    assert "timestamp" in data

    # Verify timestamp is valid ISO format
    ts = data["timestamp"].replace("Z", "+00:00")
    try:
        datetime.fromisoformat(ts)
    except ValueError:
        pytest.fail(f"Timestamp {data['timestamp']} is not in valid ISO format")

def test_notify_chw_unauthorized(monkeypatch):
    """
    🎯 What: Verify that a request without authorization returns 401.
    📊 Scenarios: Auth enabled in environment, no Authorization header.
    """
    monkeypatch.setenv("SKIP_AUTH_FOR_TESTING", "false")
    payload = {
        "patient_uid": "test_patient_123",
        "alert_tier": "low",
        "symptoms": "Mild cough",
    }
    response = client.post("/api/alerts/chw", json=payload)
    assert response.status_code == 401
    assert "Missing or invalid auth token" in response.json()["detail"]

def test_notify_chw_invalid_payload(mock_skip_auth):
    """
    🎯 What: Verify that an invalid payload returns 422 Unprocessable Entity.
    📊 Scenarios: Missing required fields.
    """
    # Missing required field 'alert_tier'
    payload = {
        "patient_uid": "test_patient_123",
        "symptoms": "Mild cough",
    }
    response = client.post(
        "/api/alerts/chw",
        json=payload,
        headers={"Authorization": "Bearer demo"}
    )
    assert response.status_code == 422

def test_notify_chw_malformed_json(mock_skip_auth):
    """
    🎯 What: Verify that malformed JSON returns 400 Bad Request.
    📊 Scenarios: Content is not valid JSON.
    """
    response = client.post(
        "/api/alerts/chw",
        content="not a json",
        headers={"Authorization": "Bearer demo", "Content-Type": "application/json"}
    )
    # FastAPI returns 400 for JSON decode errors
    assert response.status_code == 400

def test_notify_chw_optional_message(mock_skip_auth):
    """
    🎯 What: Verify that the 'message' field is optional in the payload.
    📊 Scenarios: Valid payload without 'message' field.
    """
    payload = {
        "patient_uid": "test_patient_456",
        "alert_tier": "medium",
        "symptoms": "High fever",
    }
    response = client.post(
        "/api/alerts/chw",
        json=payload,
        headers={"Authorization": "Bearer demo"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "sent"

@patch("app.api.alerts.FirestoreService")
def test_get_alert_history_success(mock_fs_class, mock_skip_auth):
    """
    🎯 What: Verify that getting alert history returns 200 OK and data from Firestore.
    📊 Scenarios: Valid patient_uid, valid auth.
    """
    # Setup mock for Firestore
    mock_fs = MagicMock()
    # Since get_safety_logs is async, we need a mock that can be awaited.
    mock_fs.get_safety_logs = AsyncMock(return_value=[
        {"id": "alert1", "tier": "critical", "patient_uid": "test_patient_123"}
    ])
    mock_fs_class.get_instance.return_value = mock_fs

    response = client.get(
        "/api/alerts/history?patient_uid=test_patient_123",
        headers={"Authorization": "Bearer demo"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert data["alerts"][0]["id"] == "alert1"
    # Verify mock was called with correct parameters
    mock_fs.get_safety_logs.assert_called_once_with("test_patient_123", since_date=None, tier=None)
