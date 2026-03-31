"""Exercise agent tools: session management, progress logging, and history."""

import json
import uuid
from datetime import datetime, timezone

from agents.shared.firestore_service import FirestoreService
from agents.shared.ui_tools import emit_ui_update

# #region debug instrumentation
import os as _os
import logging as _logging
_debug_logger = _logging.getLogger("exercise_tools_debug")

def _dbg(tool: str, message: str, data: dict, hypothesis_id: str = ""):
    import time
    payload = {"sessionId": "5959a7", "location": f"tools.py:{tool}", "message": message, "data": data, "timestamp": int(time.time() * 1000), "hypothesisId": hypothesis_id}
    _debug_logger.info("[DEBUG-5959a7] %s", json.dumps(payload))
    try:
        base = _os.path.dirname(_os.path.dirname(_os.path.dirname(__file__)))
        path = _os.path.join(base, ".cursor", "debug-5959a7.log")
        _os.makedirs(_os.path.dirname(path), exist_ok=True)
        with open(path, "a") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass
# #endregion


EXERCISE_PHASES = [
    {"phase": "Breathing", "exercises": ["Box Breathing"]},
    {"phase": "Stretches", "exercises": ["Neck Rolls", "Seated Side Bend"]},
    {"phase": "Cool-Down", "exercises": ["Final Relaxation"]},
]

TOTAL_EXERCISES = 4

# Ordered list for get_next_exercise
EXERCISE_LIST = [
    ("Box Breathing", 35),
    ("Neck Rolls", 30),
    ("Seated Side Bend", 60),
    ("Final Relaxation", 60),
]

# Per-user exercise progress tracking for backend interception (main.py imports this)
EXERCISE_PROGRESS: dict[str, int] = {}


def get_next_exercise(tool_context=None) -> dict:
    """Returns the next exercise to do.

    It automatically determines the next exercise based on your logged progress in Firestore.
    """
    _dbg("get_next_exercise", "entry", {}, "H1")
    uid = _get_user_id(tool_context)

    # In-memory state is the authoritative source within a session (updated synchronously).
    state_count = 0
    if tool_context and hasattr(tool_context, "state"):
        state_count = tool_context.state.get("exercises_completed", 0)

    # Firestore as persistence fallback (may lag behind in-memory state).
    fs = FirestoreService.get_instance()
    firestore_count = 0
    if fs.is_available:
        try:
            firestore_count = fs.get_exercise_progress_sync(uid)
            _dbg("get_next_exercise", "firestore_read", {"uid": uid, "firestore_count": firestore_count})
        except Exception as e:
            _dbg("get_next_exercise", "firestore_error", {"error": str(e)})

    # Use the higher of the two — prevents re-running the same exercise if
    # the Firestore write hasn't landed yet or is behind in-memory state.
    highest_logged = max(state_count, firestore_count)
    _dbg("get_next_exercise", "resolved", {"state_count": state_count, "firestore_count": firestore_count, "highest_logged": highest_logged}, "H1")

    if highest_logged >= TOTAL_EXERCISES:
        return {"next": None, "message": "Session complete. Call complete_exercise_session."}

    idx = highest_logged
    name, duration = EXERCISE_LIST[idx]
    out = {
        "exercise_name": name,
        "exercise_number": idx + 1,
        "duration_seconds": duration,
        "message": f"Next: {name} ({duration}s). Introduce this — do not skip."
    }
    _dbg("get_next_exercise", "exit", {"highest_logged": highest_logged, **out}, "H1")
    return out


def _get_user_id(tool_context) -> str:
    if tool_context and hasattr(tool_context, "state"):
        return tool_context.state.get("user_id", "demo_user")
    return "demo_user"


def _use_firestore(tool_context) -> bool:
    fs = FirestoreService.get_instance()
    return fs.is_available and tool_context is not None


def _get_phase_for_exercise(exercise_number: int) -> str:
    count = 0
    for phase in EXERCISE_PHASES:
        count += len(phase["exercises"])
        if exercise_number <= count:
            return phase["phase"]
    return "Cool-Down"


def _exercise_name_to_number(name: str) -> int:
    """Return 1-based exercise number for name, or 0 if unknown."""
    for i, (n, _) in enumerate(EXERCISE_LIST):
        if n == name:
            return i + 1
    return 0


def await_exercise_completion(
    exercise_name: str,
    duration_seconds: int = 30,
    tool_context=None,
) -> dict:
    """Updates the frontend UI to start the purely-visual timer for the user.

    The duration is only for the on-screen countdown; the agent decides when
    the exercise is done by watching the camera feed.
    """
    _dbg("await_exercise_completion", "entry", {"exercise_name": exercise_name, "duration_seconds": duration_seconds}, "H1")
    actual_duration = max(duration_seconds, 15)

    emit_ui_update(
        "exercise_timer_started",
        {"exercise_name": exercise_name, "duration_seconds": actual_duration},
        tool_context,
    )

    return {
        "status": "timer_started",
        "message": "UI updated. Guide the user, watch them via camera, and wrap up when they finish.",
    }


def notify_timer_complete(exercise_name: str, tool_context=None) -> dict:
    """Stub — kept for imports. Agent uses camera to detect completion."""
    return {"status": "ok", "message": "Acknowledged."}


def wait_for_user_confirmation(tool_context=None) -> dict:
    """Call after asking "Are you ready for the next one?" — signals you must end your turn and wait for the user."""
    _dbg("wait_for_user_confirmation", "called", {}, "H2")
    return {
        "status": "waiting",
        "stop_speaking": True,
        "message": "STOP SPEAKING NOW. End your turn. Do not say another word. Wait for the user to say yes, ready, or let's go. When they do, call log_exercise_progress(...) for the exercise you just completed, then call get_next_exercise() — if it returns an exercise, introduce it once; if it returns next=null, call complete_exercise_session().",
    }


def start_exercise_session(tool_context=None) -> dict:
    """Begin a new 10-minute wellness session. Call this when the user is ready to start exercising.

    Creates a session record and notifies the frontend to show the exercise UI.
    """
    _dbg("start_exercise_session", "entry", {}, "H1")
    session_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc)

    # Store session_id in state for subsequent tool calls
    uid = _get_user_id(tool_context)
    if tool_context and hasattr(tool_context, "state"):
        tool_context.state["exercise_session_id"] = session_id
        tool_context.state["exercises_completed"] = 0  # no exercises logged yet
    
    # Persistent Reset
    fs = FirestoreService.get_instance()
    if fs.is_available:
        try:
            fs.save_exercise_progress_sync(uid, 0)
        except Exception:
            pass

    emit_ui_update("exercise_session_started", {
        "session_id": session_id,
        "total_exercises": TOTAL_EXERCISES,
        "phases": [p["phase"] for p in EXERCISE_PHASES],
    }, tool_context)

    return {
        "session_id": session_id,
        "total_exercises": TOTAL_EXERCISES,
        "message": "Session started! Let's begin with Phase 1: Breathing.",
    }


def log_exercise_progress(
    exercise_name: str,
    exercise_number: int,
    posture_notes: str = "",
    completed: bool = True,
    tool_context=None,
) -> dict:
    """Log completion of the exercise. Call after the user confirms they are ready to move on."""
    _dbg("log_exercise_progress", "entry", {"exercise_name": exercise_name, "exercise_number": exercise_number}, "H3")
    uid = _get_user_id(tool_context)
    if tool_context and hasattr(tool_context, "state"):
        tool_context.state["exercises_completed"] = exercise_number
    
    # Persistent Save
    fs = FirestoreService.get_instance()
    if fs.is_available:
        try:
            fs.save_exercise_progress_sync(uid, exercise_number)
        except Exception:
            pass
            
    phase = _get_phase_for_exercise(exercise_number)

    emit_ui_update("exercise_pose_change", {
        "exercise_name": exercise_name,
        "exercise_number": exercise_number,
        "total": TOTAL_EXERCISES,
        "posture_notes": posture_notes,
        "phase": phase,
        "completed": completed,
    }, tool_context)

    return {
        "logged": True,
        "message": "Progress logged. You may now introduce the next exercise.",
    }


def complete_exercise_session(
    exercises_completed: int,
    overall_posture_notes: str = "",
    tool_context=None,
) -> dict:
    """Finalize the session with summary. Call after the last exercise OR when the user interrupts to stop."""
    _dbg("complete_exercise_session", "entry", {"exercises_completed": exercises_completed}, "H4")
    session_id = None
    uid = _get_user_id(tool_context)
    
    # Persistent Load
    fs = FirestoreService.get_instance()
    last_logged = 0
    if fs.is_available:
        try:
            last_logged = fs.get_exercise_progress_sync(uid)
        except Exception:
            pass
            
    if tool_context and hasattr(tool_context, "state"):
        last_logged = max(last_logged, tool_context.state.get("exercises_completed", 0))
        session_id = tool_context.state.get("exercise_session_id")
    # Reject wrong counts: exercises_completed can be at most last_logged + 1 (current exercise just finished)
    if exercises_completed > last_logged + 1:
        return {
            "blocked": True,
            "error": (
                f"BLOCKED: You claimed {exercises_completed} exercises completed, but you've only logged {last_logged}. "
                f"Use the ACTUAL count. If you only did Box Breathing, use 1. Never use 14 unless you completed all 14."
            ),
        }

    # Compute a simple posture score based on notes
    posture_score = min(100, 60 + exercises_completed * 3)
    if overall_posture_notes and "great" in overall_posture_notes.lower():
        posture_score = min(100, posture_score + 10)

    encouragement = "Wonderful session! You're doing great things for your health."
    if exercises_completed >= 12:
        encouragement = "Outstanding! You completed almost the entire routine. Your body thanks you!"
    elif exercises_completed >= 8:
        encouragement = "Great effort! You did more than half the routine. Every bit counts!"

    emit_ui_update("exercise_session_completed", {
        "session_id": session_id,
        "exercises_completed": exercises_completed,
        "total_exercises": TOTAL_EXERCISES,
        "duration_minutes": 10,
        "posture_score": posture_score,
        "posture_summary": overall_posture_notes,
        "encouragement": encouragement,
    }, tool_context)

    return {
        "session_id": session_id,
        "exercises_completed": exercises_completed,
        "duration_minutes": 10,
        "posture_score": posture_score,
        "encouragement": encouragement,
        "summary": f"Completed {exercises_completed}/{TOTAL_EXERCISES} exercises. Posture score: {posture_score}/100.",
    }


def get_exercise_history(tool_context=None) -> dict:
    """Get the user's past exercise sessions for motivation and tracking.

    Returns the last 10 sessions with date, duration, exercises completed, and posture scores.
    """
    # Mock data fallback for demo
    return {
        "sessions": [
            {"date": "2026-03-07", "duration_minutes": 10, "exercises_completed": 14, "posture_score": 85},
            {"date": "2026-03-05", "duration_minutes": 10, "exercises_completed": 12, "posture_score": 78},
        ],
        "total_sessions": 2,
    }
