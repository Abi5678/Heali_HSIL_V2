import logging

logger = logging.getLogger(__name__)

def emit_ui_update(target: str, data: dict, tool_context=None) -> dict:
    """Sends a real-time Generative UI update to the frontend.
    
    Target can be 'profile_preview', 'adherence_chart', etc.
    """
    logger.info(f"Emitting UI update targeted for {target}: {data}")
    try:
        if tool_context:
            # The WS connection loop should listen for these specific state keys
            # and dispatch them as JSON events down to the Javascript client
            if "ui_events" not in tool_context.state:
                tool_context.state["ui_events"] = []
            
            tool_context.state["ui_events"].append({
                "type": "ui_update",
                "target": target,
                "data": data
            })
            
        return {"status": "success", "message": "UI update dispatched"}
    except Exception as e:
        logger.error(f"Failed to dispatch UI event: {e}")
        return {"status": "error", "message": str(e)}


def navigate_to_page(page: str, tool_context=None) -> dict:
    """Navigate the user's Heali app to a specific page.

    Use this when the user needs to move to a feature page with
    specialised UI (e.g. exercise camera, food scanner).

    Args:
        page: Target route path. One of: /exercise, /food, /pills, /booking
    """
    valid = {"/exercise", "/food", "/pills", "/booking", "/prescriptions", "/doctor", "/clinical-brief"}
    if page not in valid:
        return {"status": "error", "message": f"Unknown page: {page}. Valid: {valid}"}
    logger.info(f"Navigating app to {page}")
    emit_ui_update("navigate", {"page": page}, tool_context)
    return {"status": "navigating", "page": page}
