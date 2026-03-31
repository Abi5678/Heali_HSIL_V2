"""Avatar generation API using Gemini + Imagen."""

import base64
import logging
import os

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/avatar", tags=["avatar"])

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

_gemini_client: genai.Client | None = None
_imagen_client: genai.Client | None = None


def _get_gemini_client() -> genai.Client:
    """Gemini client using API key (for image generation with photo input)."""
    global _gemini_client
    if _gemini_client is None:
        proj = os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
        loc = os.environ.pop("GOOGLE_CLOUD_LOCATION", None)
        use_vertex = os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)
        try:
            _gemini_client = genai.Client(
                api_key=os.getenv("GOOGLE_API_KEY"),
                http_options={'api_version': 'v1alpha'}
            )
        finally:
            if proj is not None:
                os.environ["GOOGLE_CLOUD_PROJECT"] = proj
            if loc is not None:
                os.environ["GOOGLE_CLOUD_LOCATION"] = loc
            if use_vertex is not None:
                os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = use_vertex
    return _gemini_client


def _get_imagen_client() -> genai.Client:
    """Imagen client on Vertex AI (for text-only random avatar generation)."""
    global _imagen_client
    if _imagen_client is None:
        _imagen_client = genai.Client(
            vertexai=True,
            project=os.getenv("GOOGLE_CLOUD_PROJECT", "medlive-488722"),
            location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )
    return _imagen_client


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

UPLOAD_PHOTO_PROMPT_TEMPLATE = """PRESERVE from the original photo:
- The person's facial features, face shape, and likeness
- Their general expression and personality
- Any distinctive features (glasses, facial hair, etc.)

TRANSFORM with this style:
- Digital illustration style, clean lines, vibrant saturated colors
- Add a Casual Genz wear attire, Tech Wear
- Suit color: {suit_color}
- Background: Pure solid white (#FFFFFF) - no gradients or elements
- Frame: Head and shoulders, 3/4 view
- Lighting: Soft diffused studio lighting
- Art style: Modern animated movie character (Pixar/Dreamworks aesthetic)

The result should be clearly recognizable as THIS specific person, but illustrated as a casual happy genz tech worker.
CRITICAL INSTRUCTION: DO NOT include any text, words, UI elements, or prompt descriptions in the image. The image must ONLY contain the character artwork."""

RANDOM_AVATAR_PROMPT_TEMPLATE = """A friendly {companion_name} character. {avatar_description}
Digital illustration style, clean lines, vibrant saturated colors.
Add a Casual Genz wear attire, Tech Wear.
Suit color: {suit_color}
Background: Pure solid white (#FFFFFF) - no gradients or elements
Frame: Head and shoulders, 3/4 view
Lighting: Soft diffused studio lighting
Art style: Modern animated movie character (Pixar/Dreamworks aesthetic)

The character should be a casual happy genz tech worker.
CRITICAL INSTRUCTION: DO NOT include any text, words, UI elements, or prompt descriptions in the image. The image must ONLY contain the character artwork."""


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/generate")
async def generate_avatar(
    companion_name: str = Form(default="Health Companion"),
    photo: UploadFile | None = File(default=None),
    avatar_description: str = Form(default="Wearing casual tech wear in navy blue"),
):
    """Generate a hand-drawn avatar.

    - If a photo is provided, use Gemini Flash to transform it (preserves likeness).
    - If no photo, use Imagen to generate a random avatar.

    Returns: {"avatar_b64": "data:image/png;base64,..."}
    """
    try:
        if getattr(photo, "size", 0) and photo.size > 0:
            # --- Photo → Gemini Flash image generation (best likeness) ---
            photo_bytes = await photo.read()
            # Prevent empty description from breaking prompt
            desc = avatar_description.strip() or "Wearing casual tech wear in navy blue"
            prompt = UPLOAD_PHOTO_PROMPT_TEMPLATE.format(suit_color="navy blue")
            logger.info(
                "Avatar: Gemini photo-to-avatar for '%s', desc='%s', photo=%d bytes",
                companion_name,
                desc,
                len(photo_bytes),
            )

            # Detect photo MIME type
            photo_mime = "image/jpeg"
            if photo_bytes[:4] == b"\x89PNG":
                photo_mime = "image/png"
            elif photo_bytes[:4] == b"RIFF":
                photo_mime = "image/webp"

            client = _get_gemini_client()
            response = client.models.generate_content(
                model="gemini-2.0-flash-exp-image-generation",
                contents=[
                    genai_types.Part.from_bytes(
                        data=photo_bytes,
                        mime_type=photo_mime,
                    ),
                    prompt,
                ],
                config=genai_types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                ),
            )

            # Extract image from Gemini response
            img_bytes = None
            mime = "image/png"
            if response.candidates:
                for part in response.candidates[0].content.parts:
                    if part.inline_data and part.inline_data.data:
                        img_bytes = part.inline_data.data
                        mime = part.inline_data.mime_type or "image/png"
                        break

            if not img_bytes:
                raise ValueError("Gemini returned no image in response")

        else:
            # --- Text → Imagen avatar (random generation) ---
            desc = avatar_description.strip() or "A happy tech professional with a warm smile"
            prompt = RANDOM_AVATAR_PROMPT_TEMPLATE.format(
                companion_name=companion_name,
                avatar_description=desc,
                suit_color="navy blue"
            )
            logger.info("Avatar: text-to-image for '%s' with desc '%s'", companion_name, desc)

            client = _get_imagen_client()
            response = client.models.generate_images(
                model="imagen-4.0-generate-001",
                prompt=prompt,
                config=genai_types.GenerateImagesConfig(
                    number_of_images=1,
                    aspect_ratio="1:1",
                    person_generation=genai_types.PersonGeneration.ALLOW_ADULT,
                ),
            )

            # Extract image bytes from Imagen response
            images = getattr(response, "generated_images", None)
            if not images:
                raise ValueError("Imagen returned no images")

            img_obj = images[0].image
            img_bytes = img_obj.image_bytes if img_obj else None

            if not img_bytes:
                rai = images[0].rai_filtered_reason
                raise ValueError(
                    f"Imagen returned empty image bytes. RAI filter reason: {rai}"
                )

            mime = "image/png" if img_bytes[:4] == b"\x89PNG" else "image/jpeg"

        # Encode and return
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        avatar_b64 = f"data:{mime};base64,{b64}"

        logger.info("Avatar generated, size=%d chars", len(avatar_b64))
        return JSONResponse({"avatar_b64": avatar_b64})

    except Exception as e:
        logger.error("Avatar generation failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Avatar generation failed: {str(e)}",
        )

