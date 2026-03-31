#!/usr/bin/env python3
"""
Generate Heali voice preview WAVs using the Gemini TTS API.

Run from repo root with GOOGLE_API_KEY (or GEMINI_API_KEY) set.
Use the project environment so google-genai is available:

  uv run python scripts/generate_heali_voice_previews.py

Or with a venv that has google-genai installed:
  source .venv/bin/activate  # or your venv
  GOOGLE_API_KEY=your_key python scripts/generate_heali_voice_previews.py

Output: public/assets/audio/companions/heali_balanced.wav, heali_calm.wav,
        heali_energetic.wav, heali_informative.wav
"""
import os
import wave
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from google import genai
from google.genai import types

# Heali voices: id suffix, Gemini voice name, greeting text
VOICES = [
    {"id": "balanced", "voice": "Aoede", "text": "Hello, I am Heali. I'm here to support you."},
    {"id": "calm", "voice": "Kore", "text": "It's okay. Take a deep breath. I'm with you."},
    {"id": "energetic", "voice": "Puck", "text": "You've got this! Let's hit that goal today!"},
    {"id": "informative", "voice": "Charon", "text": "Today's data shows good progress. Let's review the plan."},
]

# Output dir: repo_root/public/assets/audio/companions
REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "public" / "assets" / "audio" / "companions"
MODEL = "gemini-2.5-flash-preview-tts"


def save_wav(filename: Path, pcm: bytes, channels: int = 1, rate: int = 24000, sample_width: int = 2) -> None:
    with wave.open(str(filename), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm)


def main() -> None:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("Set GOOGLE_API_KEY or GEMINI_API_KEY in the environment.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=api_key)

    for v in VOICES:
        print(f"Generating {v['id']} voice using {v['voice']}...")
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=v["text"],
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=v["voice"])
                        )
                    ),
                ),
            )
            part = response.candidates[0].content.parts[0]
            if not part.inline_data or not part.inline_data.data:
                print(f"  No audio data for {v['id']}, skipping")
                continue
            audio_bytes = part.inline_data.data
            out_path = OUTPUT_DIR / f"heali_{v['id']}.wav"
            save_wav(out_path, audio_bytes)
            print(f"  Wrote {out_path}")
        except Exception as e:
            print(f"  Error: {e}")
            raise

    print("All Heali previews generated in public/assets/audio/companions/")


if __name__ == "__main__":
    main()
