#!/usr/bin/env python3
"""
Generate the four Heali companion avatar PNGs with correct gender for each voice.

- Heali (Balanced) / Aoede -> female
- Heali (Calm) / Kore -> female
- Heali (Energetic) / Puck -> male
- Heali (Informative) / Charon -> male

Uses the same style as app/api/avatar.py: digital illustration, tech wear,
white background, 3/4 view, Pixar/DreamWorks aesthetic. No text in image.

Run from repo root with Vertex AI credentials (GOOGLE_CLOUD_PROJECT, etc.):
  uv run python scripts/generate_heali_avatar_images.py

Output: src/assets/heali_balanced.png, heali_calm.png, heali_energetic.png,
        heali_informative.png (overwrites existing).
"""
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from google import genai
from google.genai import types as genai_types

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "src" / "assets"

# Same style as app/api/avatar.py RANDOM_AVATAR_PROMPT_TEMPLATE
PROMPT_TEMPLATE = """A friendly {companion_name} character. {avatar_description}
Digital illustration style, clean lines, vibrant saturated colors.
Add a Casual Genz wear attire, Tech Wear.
Suit color: {suit_color}
Background: Pure solid white (#FFFFFF) - no gradients or elements
Frame: Head and shoulders, 3/4 view
Lighting: Soft diffused studio lighting
Art style: Modern animated movie character (Pixar/Dreamworks aesthetic)

The character should be a casual happy genz tech worker.
CRITICAL INSTRUCTION: DO NOT include any text, words, UI elements, or prompt descriptions in the image. The image must ONLY contain the character artwork."""

HEALI_PERSONAS = [
    {
        "filename": "heali_balanced.png",
        "companion_name": "Heali Balanced",
        "avatar_description": "Young woman, warm and approachable, health companion. Steady and supportive demeanor.",
    },
    {
        "filename": "heali_calm.png",
        "companion_name": "Heali Calm",
        "avatar_description": "Young woman, calm and soothing, gentle demeanor. Reduces anxiety with a serene expression.",
    },
    {
        "filename": "heali_energetic.png",
        "companion_name": "Heali Energetic",
        "avatar_description": "Young man, energetic and motivational, upbeat. Positive and active vibe.",
    },
    {
        "filename": "heali_informative.png",
        "companion_name": "Heali Informative",
        "avatar_description": "Young man, professional and authoritative, clear and confident. Direct and knowledgeable.",
    },
]


def main() -> None:
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "medlive-488722")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

    client = genai.Client(
        vertexai=True,
        project=project,
        location=location,
    )

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    for p in HEALI_PERSONAS:
        out_path = ASSETS_DIR / p["filename"]
        print(f"Generating {p['filename']} ({p['companion_name']})...")
        prompt = PROMPT_TEMPLATE.format(
            companion_name=p["companion_name"],
            avatar_description=p["avatar_description"],
            suit_color="navy blue",
        )
        response = client.models.generate_images(
            model="imagen-4.0-generate-001",
            prompt=prompt,
            config=genai_types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="1:1",
                person_generation=genai_types.PersonGeneration.ALLOW_ADULT,
            ),
        )
        images = getattr(response, "generated_images", None)
        if not images:
            raise ValueError(f"Imagen returned no images for {p['filename']}")
        img_obj = images[0].image
        img_bytes = img_obj.image_bytes if img_obj else None
        if not img_bytes:
            rai = getattr(images[0], "rai_filtered_reason", None)
            raise ValueError(f"Imagen empty image for {p['filename']}. RAI: {rai}")
        out_path.write_bytes(img_bytes)
        print(f"  Wrote {out_path}")

    print("All four Heali avatar images generated in src/assets/")


if __name__ == "__main__":
    main()
