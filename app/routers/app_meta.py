"""App metadata: version gating for the mobile app.

The mobile app calls GET /api/v1/app/version on startup. Bump the
APP_LATEST_* / APP_MIN_SUPPORTED_BUILD settings when you publish a new
build to the store and older installs will show an "update available" prompt
(and are forced to update when their build is below the minimum supported).
"""
from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/app", tags=["app"])


@router.get("/version")
async def app_version():
    return {
        "latest_version": settings.APP_LATEST_VERSION,
        "latest_build": settings.APP_LATEST_BUILD,
        "min_supported_build": settings.APP_MIN_SUPPORTED_BUILD,
        "android_url": settings.APP_UPDATE_ANDROID_URL,
        "ios_url": settings.APP_UPDATE_IOS_URL,
        "message": settings.APP_UPDATE_MESSAGE,
        # Desktop (Electron) fields
        "desktop_latest_version": settings.APP_LATEST_DESKTOP_VERSION,
        "desktop_url": settings.APP_DESKTOP_URL,
        "desktop_message": settings.APP_DESKTOP_UPDATE_MESSAGE,
    }
