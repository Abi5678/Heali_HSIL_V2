"""Direct OAuth device clients — replaces Terra API aggregator.

Each client handles OAuth flow + data fetching for a single provider,
returning data in the same normalized shape that WearableService expects.
"""

from agents.shared.device_clients.base import BaseDeviceClient
from agents.shared.device_clients.dexcom import DexcomClient
from agents.shared.device_clients.libre import LibreClient
from agents.shared.device_clients.fitbit import FitbitClient
from agents.shared.device_clients.garmin import GarminClient
from agents.shared.device_clients.strava import StravaClient

PROVIDER_CLIENTS: dict[str, type[BaseDeviceClient]] = {
    "dexcom": DexcomClient,
    "freestyle_libre": LibreClient,
    "fitbit": FitbitClient,
    "garmin": GarminClient,
    "strava": StravaClient,
}

__all__ = [
    "BaseDeviceClient",
    "DexcomClient",
    "LibreClient",
    "FitbitClient",
    "GarminClient",
    "StravaClient",
    "PROVIDER_CLIENTS",
]
