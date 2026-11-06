"""plugNmeet Cloud client — signed API calls for live classes.

The classroom UI is plugNmeet's own client (we never rebuild it): the backend
creates rooms and mints short-lived, one-time join tokens, then returns the
fully-qualified join URL so the web clients can redirect into
https://<plugnmeet-host>/?access_token=<token>.

The API secret stays on the server; only the derived HASH-SIGNATURE leaves it.
Docs: https://www.plugnmeet.org/docs/api/intro
"""

import asyncio
import hashlib
import hmac
import json
import threading
import time

import httpx

from app.core.config import settings

# Cached "this room was just active" timestamps — lets ensure_room skip the
# isRoomActive API roundtrip when another join confirmed it seconds earlier.
_recent_active: dict[str, float] = {}

# ── Base endpoints (all authenticated calls are POST to <host>/auth/<method>) ──

_API_PATH = "/auth"


def pnm_configured() -> bool:
    """True when server URL + key + secret are all present (secret never ships)."""
    return bool(
        (settings.PLUGNMEET_URL or "").strip()
        and (settings.PLUGNMEET_API_KEY or "").strip()
        and (settings.PLUGNMEET_API_SECRET or "").strip()
    )


def _base_url() -> str:
    return (settings.PLUGNMEET_URL or "").strip().rstrip("/")


_http_lock = threading.Lock()
_http_client: httpx.Client | None = None


def _http() -> httpx.Client:
    """One pooled keep-alive client for every plugNmeet call.

    Each call used to open a fresh TLS connection: from the API host that is
    ~1.2s of handshake before the request even starts, and opening a class
    makes three of them (room check, create, join token) — so most of the
    "joining is slow" wait was connection setup, not plugNmeet itself. With a
    reused connection the same calls measure ~0.2s each.
    """
    global _http_client
    if _http_client is None:
        with _http_lock:
            if _http_client is None:
                _http_client = httpx.Client(
                    timeout=25.0,
                    limits=httpx.Limits(max_keepalive_connections=8, max_connections=16),
                )
    return _http_client


def _call(path: str, payload: dict) -> dict:
    """Signed POST to the plugNmeet API. HMAC-SHA256 hex signature of raw body."""
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(
        (settings.PLUGNMEET_API_SECRET or "").encode(), body, hashlib.sha256
    ).hexdigest()
    url = _base_url() + _API_PATH + path
    headers = {
        "API-KEY": (settings.PLUGNMEET_API_KEY or "").strip(),
        "HASH-SIGNATURE": signature,
        "Content-Type": "application/json",
    }
    resp = None
    for attempt in (1, 2):
        try:
            resp = _http().post(url, content=body, headers=headers)
            break
        except httpx.HTTPError:
            # A pooled socket the server already closed fails exactly once;
            # retry on a fresh connection instead of failing the join.
            if attempt == 2:
                raise
    if resp.status_code >= 400:
        # Same contract as before: an HTTP-level failure is an exception the
        # callers already handle (they fall back to a clean retry).
        raise RuntimeError(f"plugNmeet {path} returned HTTP {resp.status_code}")
    return resp.json()


async def acall(path: str, payload: dict) -> dict:
    """Same signed call, run on a worker thread so FastAPI is never blocked."""
    return await asyncio.to_thread(_call, path, payload)


# ── Room feature flags (plugNmeet's standard client renders these) ────────────

DEFAULT_MAX_PARTICIPANTS = 50
DEFAULT_EMPTY_TIMEOUT = 600  # seconds the room lives with nobody in it


def _room_features() -> dict:
    return {
        "allow_webcams": True,
        "mute_on_start": False,
        "allow_screen_share": True,
        "admin_only_webcams": False,
        "allow_view_other_webcams": True,
        "allow_view_other_users_list": True,
        "allow_raise_hand": True,
        "auto_gen_user_id": False,
        "room_duration": 0,
        "recording_features": {
            "is_allow": False,
            "is_allow_cloud": False,
            "is_allow_local": False,
        },
        "chat_features": {"is_allow": True, "is_allow_file_upload": False},
        "shared_note_pad_features": {"is_allow": True},
        "whiteboard_features": {"is_allow": True},
        "external_media_player_features": {"is_allow": True},
        "waiting_room_features": {"is_active": False},
        "breakout_room_features": {
            "is_allow": True,
            "allowed_number_rooms": 6,
            "allow_return_to_main_room": True,
        },
        "display_external_link_features": {"is_allow": False},
        "polls_features": {"is_allow": True},
    }


def _create_room_payload(room_id: str, title: str, logout_url: str | None = None) -> dict:
    return {
        "room_id": f"sx-{room_id}",
        "max_participants": DEFAULT_MAX_PARTICIPANTS,
        "empty_timeout": DEFAULT_EMPTY_TIMEOUT,
        "metadata": {
            "room_title": title or "Scholaxia Live Class",
            "welcome_message": "Welcome to your Scholaxia live class.",
            # Prefer the origin of the caller that created the room so "end
            # class" lands back on the same app instead of a foreign login
            # screen; falls back to the configured default.
            "logout_url": (
                (logout_url or "").strip()
                or (settings.PLUGNMEET_LOGOUT_URL or "").strip()
            ),
            "room_features": _room_features(),
        },
    }


def _is_room_active_payload(room_id: str) -> dict:
    return {"room_id": f"sx-{room_id}"}


async def ensure_room(
    room_id: str,
    title: str,
    logout_url: str | None = None,
) -> bool:
    """Create the plugNmeet room if it is not active yet. Idempotent."""
    rid = str(room_id or "").strip()
    if not rid:
        return False
    # Recently confirmed active? Skip the isRoomActive roundtrip so joining
    # stays fast (the active flag is refreshed by every successful join_token).
    stamp = _recent_active.get(rid)
    if stamp and (time.monotonic() - stamp) < 600:
        return True
    try:
        active = await acall("/room/isRoomActive", _is_room_active_payload(rid))
        # NB: status is true even when the room is missing — the real signal
        # is the is_active flag (comes back false with ROOM_NOT_FOUND).
        if active.get("status") and bool(active.get("is_active", True)):
            _recent_active[rid] = time.monotonic()
            return True
    except Exception:
        pass
    for _attempt in (1, 2):
        try:
            created = await acall("/room/create", _create_room_payload(rid, title, logout_url))
            if created.get("status"):
                _recent_active[rid] = time.monotonic()
                return True
        except Exception:
            pass
        await asyncio.sleep(0.5)
    # Second active check — another process may have created it concurrently.
    try:
        active = await acall("/room/isRoomActive", _is_room_active_payload(rid))
        if active.get("status") and bool(active.get("is_active", True)):
            _recent_active[rid] = time.monotonic()
            return True
    except Exception:
        pass
    return False


def _join_token_payload(
    room_id: str,
    user_id: str,
    name: str,
    is_admin: bool,
    profile_pic: str = "",
    client_type: str = "WEB",
) -> dict:
    user_metadata = {"preferred_lang": "en-US"}
    if profile_pic:
        user_metadata["profile_pic"] = profile_pic
    # Hybrid mobile (WebView + native LiveKit publisher) must request
    # client_type HYBRID_WEB so plugNmeet hands a publish-only token to the
    # native twin over the bridge. Default stays WEB so laptop/website flow
    # is byte-for-byte unchanged unless the caller opts in.
    ct = str(client_type or "WEB").strip().upper() or "WEB"
    if ct not in ("WEB", "HYBRID_WEB"):
        ct = "WEB"
    return {
        "room_id": f"sx-{room_id}",
        "user_info": {
            "name": name or "Participant",
            "user_id": f"sx-{user_id}",
            "is_admin": bool(is_admin),
            "is_hidden": False,
            "client_type": ct,
            "user_metadata": user_metadata,
        },
    }


async def join_token(
    room_id: str,
    user_id: str,
    name: str,
    is_admin: bool,
    profile_pic: str = "",
    client_type: str = "WEB",
) -> dict | None:
    """Mint a short-lived, one-time join token. Returns {'token','join_url'}."""
    rid = str(room_id or "").strip()
    if not rid:
        return None
    data = await acall(
        "/room/getJoinToken",
        _join_token_payload(rid, user_id, name, is_admin, profile_pic, client_type),
    )
    token = data.get("token") or ""
    if not token:
        # Token failed — the room may have been closed behind our back.
        _recent_active.pop(rid, None)
        return None
    _recent_active[rid] = time.monotonic()
    return {"token": token, "join_url": f"{_base_url()}/?access_token={token}"}


def _end_room_payload(room_id: str) -> dict:
    return {"room_id": f"sx-{room_id}"}


async def end_room(room_id: str) -> bool:
    """Forcefully close a live plugNmeet room (disconnects everyone).

    Used when the teacher/admin ends the class from Scholaxia instead of the
    plugNmeet UI. Closing is important: a room's `logout_url` (where plugNmeet
    sends users after the meeting ends) is fixed at CREATE time, so an old
    room carries any old/broken logout URL forever — ending the room lets the
    next session be recreated with the corrected logout URL.
    """
    rid = str(room_id or "").strip()
    if not rid:
        return False
    _recent_active.pop(rid, None)
    try:
        data = await acall("/room/endRoom", _end_room_payload(rid))
        return bool(data.get("status"))
    except Exception:
        return False
