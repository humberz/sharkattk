import json
import os
from pathlib import Path
from models import AppSettings

SETTINGS_FILE = Path(__file__).parent.parent / "settings.json"


def load_settings() -> AppSettings:
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE) as f:
            data = json.load(f)
        return AppSettings(**data)
    return AppSettings()


def save_settings(settings: AppSettings) -> None:
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings.model_dump(), f, indent=2)


def get_api_key(settings: AppSettings) -> str:
    return settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
