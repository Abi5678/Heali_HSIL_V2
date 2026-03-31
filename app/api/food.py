import base64
import json
import logging
from typing import Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google import genai
from google.genai import types
import os

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/food", tags=["food"])

# Determine which client to use based on env vars (like in main.py)
use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "FALSE").upper() == "TRUE"
project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "medlive")
location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")

if use_vertex:
    client = genai.Client(
        vertexai=True,
        project=project_id,
        location=location,
    )
else:
    client = genai.Client()

FOOD_ANALYSIS_MODEL = "gemini-2.5-pro"

class FoodAnalyzeRequest(BaseModel):
    image_base64: str  # The raw base64 string, without the data:image/jpeg;base64, prefix

class FoodAnalyzeResponse(BaseModel):
    food_items: list[str]
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int

@router.post("/analyze", response_model=FoodAnalyzeResponse)
async def analyze_food(request: FoodAnalyzeRequest):
    """
    Takes a base64 encoded image of a food plate and uses Gemini 2.5 Pro Vision
    to estimate the macronutrients.
    """
    try:
        # Decode the base64 string
        try:
            image_bytes = base64.b64decode(request.image_base64)
        except Exception as e:
            logger.error(f"Failed to decode base64 image: {e}")
            raise HTTPException(status_code=400, detail="Invalid base64 image data")

        # Create the prompt and config
        prompt = (
            "You are an expert nutritionist. Analyze this image of a food plate. "
            "Identify the food items visible and provide a realistic estimate of the macros "
            "(Calories, Protein, Carbs, Fat) for the entire plate. "
            "If there are multiple items, sum them up for the total. "
            "If it is clearly not food, return 0 for all macros and an empty list for food_items. "
            "You MUST respond with valid JSON matching the requested schema."
        )

        # We'll use the structured outputs feature of the new SDK
        response_schema = {
            "type": "OBJECT",
            "properties": {
                "food_items": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "List of food items identified on the plate."},
                "calories": {"type": "INTEGER", "description": "Total estimated calories."},
                "protein_g": {"type": "INTEGER", "description": "Total estimated protein in grams."},
                "carbs_g": {"type": "INTEGER", "description": "Total estimated carbohydrates in grams."},
                "fat_g": {"type": "INTEGER", "description": "Total estimated fat in grams."},
            },
            "required": ["food_items", "calories", "protein_g", "carbs_g", "fat_g"]
        }

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
            temperature=0.2, # Low temp for factual estimation
        )
        
        # Prepare the image part
        image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg") # Defaulting to jpeg assumption

        logger.info(f"Sending image to {FOOD_ANALYSIS_MODEL} for macro extraction...")
        response = client.models.generate_content(
            model=FOOD_ANALYSIS_MODEL,
            contents=[prompt, image_part],
            config=config,
        )

        # Parse the JSON response
        try:
            result_json = json.loads(response.text)
            logger.info(f"Successfully extracted macros: {result_json}")
            return FoodAnalyzeResponse(**result_json)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from Gemini: {response.text}")
            raise HTTPException(status_code=500, detail="Failed to parse analysis results")

    except Exception as e:
        logger.error(f"Error analyzing food image: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Image analysis failed: {str(e)}")


class FoodLogRequest(BaseModel):
    uid: str
    food_items: list[str]
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int
    meal_type: str = "snack"
    description: str = ""


@router.get("/logs")
async def get_food_logs(uid: str, limit: int = 20, date: str | None = None):
    """Returns the most recent food log entries for a patient, optionally filtered by date (YYYY-MM-DD)."""
    try:
        from agents.shared.firestore_service import FirestoreService

        fs = FirestoreService.get_instance()
        if not fs.is_available:
            from agents.shared.mock_data import FOOD_LOGS
            logs = FOOD_LOGS[-limit:]
            if date:
                logs = [l for l in logs if l.get("date") == date]
            return {"logs": logs}

        logs = await fs.get_food_logs(uid, limit=limit, date=date)
        return {"logs": logs}
    except Exception as e:
        logger.error(f"Error fetching food logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/log")
async def log_food(request: FoodLogRequest):
    """Saves a food log entry to the patient's Firestore record."""
    try:
        from agents.shared.firestore_service import FirestoreService
        
        fs = FirestoreService.get_instance()
        if not fs.is_available:
            from agents.shared.mock_data import FOOD_LOGS
            FOOD_LOGS.append({**request.dict(), "timestamp": "now"})
            return {"status": "success", "message": "Saved to mock data"}
            
        await fs.add_food_log(request.uid, request.dict())
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error saving food log: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/log")
async def delete_food_log(uid: str, log_id: str):
    """Deletes a food log entry by its Firestore document ID."""
    try:
        from agents.shared.firestore_service import FirestoreService

        fs = FirestoreService.get_instance()
        if not fs.is_available:
            return {"status": "success", "message": "Mock mode — nothing deleted"}

        await fs.delete_food_log(uid, log_id)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error deleting food log: {e}")
        raise HTTPException(status_code=500, detail=str(e))

