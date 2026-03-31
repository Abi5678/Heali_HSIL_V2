#!/usr/bin/env python3
"""Test Gemini Live API connection directly (no ADK)."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv()

from google import genai
from google.genai import types

async def test_live():
    client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    model = "gemini-2.5-flash-native-audio-latest"
    
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
    )
    
    print(f"Connecting to {model}...")
    try:
        async with client.aio.live.connect(model=model, config=config) as session:
            print("Connected! Sending text message...")
            await session.send_client_content(
                turns=types.Content(role="user", parts=[types.Part(text="Hello, say hi")])
            )
            print("Message sent, waiting for response...")
            
            async for response in session.receive():
                print(f"Got response: server_content={response.server_content is not None}, "
                      f"tool_call={response.tool_call is not None}, "
                      f"setup_complete={response.setup_complete is not None}")
                if response.server_content:
                    for part in response.server_content.model_turn.parts if response.server_content.model_turn else []:
                        if part.text:
                            print(f"  Text: {part.text}")
                        if part.inline_data:
                            print(f"  Audio: {len(part.inline_data.data)} bytes, mime={part.inline_data.mime_type}")
                if response.server_content and response.server_content.turn_complete:
                    print("Turn complete!")
                    break
                    
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(asyncio.wait_for(test_live(), timeout=20))
