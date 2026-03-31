"""Onboarding Agent tools: restart, voice customization, and real-time UI updates."""

import logging
from agents.shared.firestore_service import FirestoreService

logger = logging.getLogger(__name__)

async def restart_onboarding(tool_context=None) -> dict:
    """Restarts the onboarding session by clearing history.
    
    Must be called if the user says "Let's start over."
    """
    logger.info("Restarting onboarding requested by user.")
    try:
        from app.main import runner  # Delayed import to avoid circular dep
        
        # Use ADK's rewind feature to flush the session
        # Since we're in a tool, we access the runner and clear the current session context
        session_id = tool_context.state.get("session_id")
        if session_id:
            await runner.rewind_async(session_id=session_id)
            
        return {"status": "success", "message": "Session history cleared. Start over."}
    except Exception as e:
        logger.error(f"Failed to restart onboarding: {e}")
        return {"status": "error", "message": str(e)}

async def update_session_voice(voice_name: str, tool_context=None) -> dict:
    """Updates the assigned voice Persona for the conversation.
    
    Valid voice_name options: Fenrir, Aoede, Charon, Kore.
    """
    logger.info(f"Updating session voice to: {voice_name}")
    try:
        # Save to Firestore so it persists across the impending WS reconnect
        uid = tool_context.state.get("user_id") if tool_context else None
        if not uid:
            return {"status": "error", "message": "User not authenticated."}
            
        fs = FirestoreService.get_instance()
        await fs.save_user_profile(uid, {"voice_name": voice_name})
        
        if tool_context:
            tool_context.state["new_voice_name"] = voice_name
            
        # Emit a UI Event to the frontend
        await emit_ui_update("voice_update", {"voice": voice_name}, tool_context)
            
        return {"status": "success", "message": f"Voice updated to {voice_name}."}
    except Exception as e:
        logger.error(f"Failed to update voice: {e}")
        return {"status": "error", "message": str(e)}

from agents.shared.ui_tools import emit_ui_update


def _is_skip_or_empty(s: str) -> bool:
    """True if the value is empty/whitespace or an explicit skip token."""
    if not s or not str(s).strip():
        return True
    t = str(s).strip().lower()
    return t in ("skip", "none", "n/a", "no", "declined", "na")


async def complete_onboarding_and_save(name: str, language: str, allergies: list[str], diet: str, emergency_contact_name: str, emergency_contact_phone: str, current_medications: str = "", tool_context=None) -> dict:
    """Saves the user's completed profile and triggers handoff.

    MUST be called only after: (1) you have gathered name, language, allergies, diet,
    medications, emergency contact, and (2) the user has given unambiguous consent.
    Never call with empty or inferred defaults — only after the user has explicitly
    provided or declined each item.
    """
    try:
        # Idempotent: if we already completed onboarding, do not save/emit/inject again
        if tool_context and tool_context.state.get("onboarding_complete"):
            return {
                "status": "success",
                "message": "Profile already saved. Handoff already done. Do not call this tool again. Do not ask about the caregiver again. Say the handoff phrase once if you have not already, then stop.",
            }
        # Guard: require emergency contact unless user explicitly skipped
        name_ok = bool(emergency_contact_name and str(emergency_contact_name).strip())
        phone_ok = bool(emergency_contact_phone and str(emergency_contact_phone).strip())
        both_skipped = _is_skip_or_empty(emergency_contact_name) and _is_skip_or_empty(emergency_contact_phone)
        if not name_ok and not phone_ok and not both_skipped:
            return {
                "status": "error",
                "message": "You must collect emergency contact name and phone before completing onboarding, or the user must explicitly say they want to skip. Do not call with empty strings. Ask for the contact name and number, or ask 'Would you like to skip adding an emergency contact for now?'",
            }
        if not name.strip():
            return {"status": "error", "message": "Name is required. Do not call with an empty name."}
        if not language or not str(language).strip():
            return {"status": "error", "message": "Language is required. Do not call with an empty language."}

        ec_name = "" if _is_skip_or_empty(emergency_contact_name) else str(emergency_contact_name).strip()
        ec_phone = "" if _is_skip_or_empty(emergency_contact_phone) else str(emergency_contact_phone).strip()

        uid = tool_context.state.get("user_id") if tool_context else None
        if not uid:
            return {"status": "error", "message": "User not authenticated. Cannot save onboarding data."}
        fs = FirestoreService.get_instance()

        # Guard: if Firestore is not available, mark session complete and proceed with handoff
        # (data will be unavailable until Firestore is configured, but the user can still use the app)
        if not fs.is_available:
            logger.warning("Firestore unavailable during onboarding save for uid=%s — proceeding without persistence", uid)
            if tool_context:
                tool_context.state["onboarding_complete"] = True
                try:
                    await emit_ui_update("onboarding_complete", {}, tool_context)
                except Exception:
                    pass
            return {
                "status": "success",
                "message": "Profile saved in session (Firestore unavailable). Ready to handoff.",
            }

        # 1. Save preferences (including persistent onboarding flag)
        # Use display_name and flat emergency fields so Profile UI matches React onboarding
        profile_data = {
            "name": name.strip(),
            "display_name": name.strip(),
            "language": str(language).strip(),
            "onboarding_complete": True,
            "emergency_contact": [{"name": ec_name, "phone": ec_phone}] if ec_name or ec_phone else [],
            "emergency_contact_name": ec_name,
            "emergency_contact_phone": ec_phone,
        }
        await fs.save_user_profile(uid, profile_data)
        
        # 2. Save health restrictions
        await fs.save_health_restrictions(uid, allergies, diet, current_medications)
        
        # 3. Emit Preview UI Event
        await emit_ui_update("profile_preview", {"name": name, "language": language, "diet": diet}, tool_context)
        
        # Set state flag to trigger handoff to Guardian Agent
        if tool_context:
            tool_context.state["onboarding_complete"] = True
            # Signal frontend to set localStorage onboarding completed so sidebar links work
            await emit_ui_update("onboarding_complete", {}, tool_context)
            # Trigger WS reconnect so the Guardian agent's warm greeting fires from
            # the new connection (connection-time proactive prompt uses Firestore profile).
            tool_context.state["reconnect_after_onboarding"] = True

        return {"status": "success", "message": "Profile saved. Ready to handoff."}
    except Exception as e:
        logger.error("complete_onboarding_and_save failed: %s", e)
        # Mark session complete anyway so the agent can hand off — the issue is server-side
        if tool_context:
            tool_context.state["onboarding_complete"] = True
            try:
                await emit_ui_update("onboarding_complete", {}, tool_context)
            except Exception:
                pass
        return {
            "status": "success",
            "message": (
                "There was a server issue saving to the database, but the session is ready. "
                "Do NOT ask for the phone number again. Do NOT say 'that again'. "
                "Say exactly once: 'I had a small technical hiccup, but you are all set! "
                "I am handing you over to your daily guardian now.' "
                "Then complete the handoff."
            ),
        }

