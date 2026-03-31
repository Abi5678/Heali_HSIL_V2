import logging
import os
from twilio.rest import Client

logger = logging.getLogger(__name__)

class TwilioVoiceService:
    @classmethod
    def get_client(cls):
        account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        api_key = os.getenv("TWILIO_API_KEY")
        api_secret = os.getenv("TWILIO_API_SECRET")
        auth_token = os.getenv("TWILIO_AUTH_TOKEN")

        if api_key and api_secret and account_sid:
            return Client(api_key, api_secret, account_sid)
        if account_sid and auth_token:
            return Client(account_sid, auth_token)
        return None

    @classmethod
    async def make_outbound_call(cls, to_phone: str, twiml_url: str):
        """Initiate an outbound call to the user."""
        client = cls.get_client()
        if not client:
            logger.error("Twilio credentials missing")
            return None

        from_number = os.getenv("TWILIO_FROM_NUMBER")
        if not from_number:
            logger.error("TWILIO_FROM_NUMBER missing")
            return None

        try:
            call = client.calls.create(
                to=to_phone,
                from_=from_number,
                url=twiml_url
            )
            logger.info("Outbound call initiated: sid=%s to=%s", call.sid, to_phone)
            return call.sid
        except Exception as e:
            logger.error("Failed to make outbound call: %s", e)
            return None
