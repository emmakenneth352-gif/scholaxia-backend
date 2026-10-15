"""
WebSocket handler for live class real-time features:
- Authoritative participant registry (upsert on reconnect)
- Room snapshot for late joiners
- Chat, whiteboard, raise hand, reactions, mic/camera grants
"""
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import json
import asyncio

from app.services.live_class_room import (
    grant_whiteboard,
    revoke_whiteboard,
    has_whiteboard_access,
    grant_mic,
    revoke_mic,
    grant_camera,
    revoke_camera,
    cleanup_room,
    record_board_event,
    get_board_replay_messages,
    upsert_participant,
    mark_participant_disconnected,
    get_room_snapshot,
    record_chat_message,
    raise_hand,
    lower_hand,
    lower_all_hands,
    list_participants,
    new_event_id,
    set_room_meta,
    upsert_participant_flags,
    get_room_permissions,
    set_room_permissions,
)

# room_id -> list of connected websockets with metadata
rooms: Dict[str, List[dict]] = {}
_pending_room_cleanup: Dict[str, asyncio.Task] = {}


def _is_teacher_role(role: str) -> bool:
    r = str(role or "").strip().lower().replace("userrole.", "")
    return r in ("teacher", "admin", "host")


def _uid(user_id: str) -> str:
    return str(user_id or "").strip().lower()


async def connect(room_id: str, websocket: WebSocket, user_id: str, role: str, display_name: str = ""):
    pending = _pending_room_cleanup.pop(room_id, None)
    if pending and not pending.done():
        pending.cancel()
    await websocket.accept()
    if room_id not in rooms:
        rooms[room_id] = []

    # Drop prior sockets for the same user (reconnect upsert — no duplicate peers)
    uid = _uid(user_id)
    lst = rooms.get(room_id)
    stale = [c for c in (lst or []) if _uid(c.get("user_id")) == uid and c["ws"] is not websocket]
    for c in stale:
        try:
            await c["ws"].close()
        except Exception:
            pass
        # close() awaits, letting other coroutines run — the room registry
        # may have been deleted meanwhile; never assume rooms[room_id].
        cur = rooms.get(room_id)
        if cur is not None:
            try:
                cur.remove(c)
            except ValueError:
                pass

    rooms[room_id].append({
        "ws": websocket,
        "user_id": user_id,
        "role": role,
        "display_name": display_name or ("Teacher" if _is_teacher_role(role) else "Student"),
    })


def disconnect(room_id: str, websocket: WebSocket):
    if room_id in rooms:
        rooms[room_id] = [c for c in rooms[room_id] if c["ws"] != websocket]
        if not rooms[room_id]:
            del rooms[room_id]

            async def _delayed_cleanup() -> None:
                await asyncio.sleep(120)
                if room_id not in rooms:
                    cleanup_room(room_id)

            old = _pending_room_cleanup.pop(room_id, None)
            if old and not old.done():
                old.cancel()
            _pending_room_cleanup[room_id] = asyncio.create_task(_delayed_cleanup())


async def broadcast(room_id: str, message: dict, exclude: WebSocket = None):
    # Snapshot the connection list: a client can disconnect mid-broadcast,
    # and disconnect() may then delete rooms[room_id] entirely. Iterating a
    # dead registry entry here used to raise KeyError and kill the SENDER's
    # websocket handler (every later event silently never delivered).
    conns = list(rooms.get(room_id) or [])
    if not conns:
        return
    payload = json.dumps(message)
    dead = []
    for conn in conns:
        if conn["ws"] == exclude:
            continue
        try:
            # A slow/dead client must never stall the room: board text, erase
            # and clear must reach every healthy student the same frame the
            # teacher sends them. Cap each send; the laggard is dropped and
            # rejoins via the normal reconnect path.
            await asyncio.wait_for(conn["ws"].send_text(payload), timeout=3)
        except Exception:
            dead.append(conn)
    if dead:
        remaining = rooms.get(room_id)
        if remaining is not None:
            for conn in dead:
                try:
                    remaining.remove(conn)
                except ValueError:
                    pass


async def replay_board_to_websocket(room_id: str, websocket: WebSocket) -> None:
    for msg in get_board_replay_messages(room_id):
        try:
            await websocket.send_text(json.dumps(msg))
        except Exception:
            break


async def send_to_user(room_id: str, target_user_id: str, message: dict):
    """Send a message to a specific user in the room."""
    conns = list(rooms.get(room_id) or [])
    if not conns:
        return
    target = _uid(target_user_id)
    for conn in conns:
        if _uid(conn.get("user_id")) == target:
            try:
                await conn["ws"].send_text(json.dumps(message))
            except Exception:
                pass


async def notify_mic_granted(room_id: str, student_id: str) -> None:
    sid = str(student_id or "").strip()
    grant_mic(room_id, sid)
    payload = {
        "event": "mic_access_granted",
        "eventId": new_event_id(),
        "user_id": sid,
        "target_user_id": sid,
        "message": "Your teacher let you speak. Tap Mic to talk.",
    }
    await send_to_user(room_id, sid, payload)
    await broadcast(room_id, {
        "event": "mic_access_update",
        "eventId": new_event_id(),
        "user_id": sid,
        "has_mic": True,
    })
    await broadcast(room_id, {
        "event": "participant_updated",
        "eventId": new_event_id(),
        "participant": next((p for p in list_participants(room_id) if _uid(p.get("userId")) == _uid(sid)), None),
    })


async def notify_mic_revoked(room_id: str, student_id: str) -> None:
    sid = str(student_id or "").strip()
    revoke_mic(room_id, sid)
    payload = {
        "event": "mic_access_revoked",
        "eventId": new_event_id(),
        "user_id": sid,
        "target_user_id": sid,
        "message": "Your teacher muted you.",
    }
    await send_to_user(room_id, sid, payload)
    await broadcast(room_id, {
        "event": "mic_access_update",
        "eventId": new_event_id(),
        "user_id": sid,
        "has_mic": False,
    })


async def notify_camera_granted(room_id: str, student_id: str) -> None:
    sid = str(student_id or "").strip()
    grant_camera(room_id, sid)
    await send_to_user(room_id, sid, {
        "event": "camera_access_granted",
        "eventId": new_event_id(),
        "user_id": sid,
        "target_user_id": sid,
        "message": "Your teacher let you turn on your camera.",
    })
    await broadcast(room_id, {
        "event": "camera_access_update",
        "eventId": new_event_id(),
        "user_id": sid,
        "has_camera": True,
    })
    await broadcast(room_id, {
        "event": "participant_updated",
        "eventId": new_event_id(),
        "participant": next((p for p in list_participants(room_id) if _uid(p.get("userId")) == _uid(sid)), None),
    })


async def notify_camera_revoked(room_id: str, student_id: str) -> None:
    revoke_camera(room_id, student_id)
    await send_to_user(room_id, student_id, {
        "event": "camera_access_revoked",
        "eventId": new_event_id(),
        "message": "Your teacher turned off your camera access.",
    })
    await broadcast(room_id, {
        "event": "camera_access_update",
        "eventId": new_event_id(),
        "user_id": student_id,
        "has_camera": False,
    })


async def live_class_endpoint(websocket: WebSocket, room_id: str, user_id: str, role: str, display_name: str = ""):
    await connect(room_id, websocket, user_id, role, display_name)
    name = display_name or ("Teacher" if _is_teacher_role(role) else "Student")

    # Detect reconnect: participant already existed
    prior = next((p for p in list_participants(room_id) if _uid(p.get("userId")) == _uid(user_id)), None)
    was_reconnect = bool(prior and prior.get("connectionState") in ("DISCONNECTED", "RECONNECTING", "CONNECTED"))

    participant = upsert_participant(
        room_id,
        user_id,
        role=role,
        name=name,
        reconnect=was_reconnect,
    )

    # Send authoritative snapshot to this client first (prevents race with live events)
    try:
        snapshot = get_room_snapshot(room_id)
        await websocket.send_text(json.dumps(snapshot))
    except Exception:
        pass

    if not _is_teacher_role(role):
        await replay_board_to_websocket(room_id, websocket)

    join_event = {
        "event": "participant_joined" if not was_reconnect else "participant_reconnected",
        "eventId": new_event_id(),
        "user_id": user_id,
        "role": role,
        "name": name,
        "participant": participant,
    }
    await broadcast(room_id, join_event, exclude=websocket)
    # Keep legacy event for older clients
    await broadcast(room_id, {
        "event": "user_joined",
        "eventId": new_event_id(),
        "user_id": user_id,
        "role": role,
        "name": name,
    }, exclude=websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            event = message.get("event")

            if event == "chat":
                perms = get_room_permissions(room_id)
                if not _is_teacher_role(role) and not perms.get("studentsCanChat", True):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Chat is disabled by the teacher.",
                    }))
                else:
                    # Exclude sender — client already shows local "You" echo
                    chat_event = {
                        "event": "chat",
                        "eventId": new_event_id(),
                        "user_id": user_id,
                        "role": role,
                        "name": name,
                        "text": message.get("text", ""),
                    }
                    # Keep a bounded history so reconnecting students don't lose
                    # messages that were sent while their socket was down.
                    record_chat_message(room_id, chat_event)
                    await broadcast(room_id, chat_event, exclude=websocket)

            elif event == "screen_share":
                active = bool(message.get("active"))
                set_room_meta(room_id, screenShareActive=active, presentation="screen" if active else "teacher")
                upsert_participant_flags(room_id, user_id, isScreenSharing=active)
                await broadcast(
                    room_id,
                    {
                        "event": "screen_share",
                        "eventId": new_event_id(),
                        "user_id": user_id,
                        "role": role,
                        "active": active,
                    },
                    exclude=websocket,
                )

            elif event == "whiteboard":
                perms = get_room_permissions(room_id)
                has_access = _is_teacher_role(role) or has_whiteboard_access(room_id, user_id)
                if not _is_teacher_role(role) and not perms.get("studentsCanWriteBoard", False):
                    has_access = False
                if not has_access:
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "You do not have whiteboard access. Ask your teacher.",
                    }))
                else:
                    action = message.get("action")
                    data_payload = message.get("data") or {}
                    if _is_teacher_role(role):
                        record_board_event(room_id, action, data_payload)
                    await broadcast(room_id, {
                        "event": "whiteboard",
                        "eventId": new_event_id(),
                        "user_id": user_id,
                        "action": action,
                        "data": data_payload,
                    }, exclude=websocket)

            elif event == "grant_whiteboard":
                if not _is_teacher_role(role):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Only teachers can grant whiteboard access.",
                    }))
                else:
                    target_id = message.get("target_user_id")
                    if target_id:
                        grant_whiteboard(room_id, target_id)
                        await send_to_user(room_id, target_id, {
                            "event": "whiteboard_access_granted",
                            "message": "Your teacher gave you whiteboard access.",
                        })
                        await broadcast(room_id, {
                            "event": "whiteboard_access_update",
                            "user_id": target_id,
                            "has_access": True,
                        })

            elif event == "revoke_whiteboard":
                if not _is_teacher_role(role):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Only teachers can revoke whiteboard access.",
                    }))
                else:
                    target_id = message.get("target_user_id")
                    if target_id:
                        revoke_whiteboard(room_id, target_id)
                        await send_to_user(room_id, target_id, {
                            "event": "whiteboard_access_revoked",
                            "message": "Your whiteboard access has been removed.",
                        })
                        await broadcast(room_id, {
                            "event": "whiteboard_access_update",
                            "user_id": target_id,
                            "has_access": False,
                        })

            elif event == "grant_mic":
                if not _is_teacher_role(role):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Only the teacher can allow students to speak.",
                    }))
                else:
                    target_id = message.get("target_user_id")
                    if target_id:
                        lower_hand(room_id, str(target_id))
                        await notify_mic_granted(room_id, str(target_id))

            elif event == "grant_camera":
                if not _is_teacher_role(role):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Only the teacher can allow student camera.",
                    }))
                else:
                    target_id = message.get("target_user_id")
                    if target_id:
                        await notify_camera_granted(room_id, str(target_id))

            elif event == "revoke_mic":
                if not _is_teacher_role(role):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Only the teacher can mute students.",
                    }))
                else:
                    target_id = message.get("target_user_id")
                    if target_id:
                        await notify_mic_revoked(room_id, str(target_id))

            elif event == "revoke_camera":
                if not _is_teacher_role(role):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Only the teacher can revoke camera access.",
                    }))
                else:
                    target_id = message.get("target_user_id")
                    if target_id:
                        await notify_camera_revoked(room_id, str(target_id))

            elif event == "request_board_sync":
                await replay_board_to_websocket(room_id, websocket)

            elif event == "request_room_snapshot":
                try:
                    await websocket.send_text(json.dumps(get_room_snapshot(room_id)))
                except Exception:
                    pass

            elif event == "participant_media_state":
                # Client reports local cam/mic so peers can show correct tile states
                upsert_participant_flags(
                    room_id,
                    user_id,
                    cameraEnabled=bool(message.get("cameraEnabled")),
                    microphoneEnabled=bool(message.get("microphoneEnabled")),
                )
                await broadcast(room_id, {
                    "event": "participant_updated",
                    "eventId": new_event_id(),
                    "participant": next(
                        (p for p in list_participants(room_id) if _uid(p.get("userId")) == _uid(user_id)),
                        None,
                    ),
                }, exclude=websocket)

            elif event == "raise_hand":
                perms = get_room_permissions(room_id)
                if not _is_teacher_role(role) and not perms.get("studentsCanRaiseHand", True):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Raise hand is disabled by the teacher.",
                    }))
                else:
                    hand_name = message.get("name") or name or "Student"
                    p = raise_hand(room_id, user_id, hand_name)
                    await broadcast(room_id, {
                        "event": "raise_hand",
                        "eventId": new_event_id(),
                        "user_id": user_id,
                        "name": hand_name,
                        "participant": p,
                        "raisedHands": get_room_snapshot(room_id).get("raisedHands") or [],
                    })

            elif event == "lower_hand":
                target = message.get("target_user_id") or user_id
                if not _is_teacher_role(role) and _uid(target) != _uid(user_id):
                    target = user_id
                lower_hand(room_id, str(target))
                await broadcast(room_id, {
                    "event": "lower_hand",
                    "eventId": new_event_id(),
                    "user_id": target,
                })

            elif event == "lower_all_hands":
                if not _is_teacher_role(role):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Only the teacher can lower all hands.",
                    }))
                else:
                    lowered = lower_all_hands(room_id)
                    await broadcast(room_id, {
                        "event": "lower_all_hands",
                        "eventId": new_event_id(),
                        "user_ids": lowered,
                        "raisedHands": [],
                    })

            elif event == "set_permissions":
                if not _is_teacher_role(role):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Only the teacher can change class permissions.",
                    }))
                else:
                    perms = set_room_permissions(room_id, message.get("permissions") or {})
                    await broadcast(room_id, {
                        "event": "permission_changed",
                        "eventId": new_event_id(),
                        "permissions": perms,
                    })

            elif event == "spotlight":
                mode = str(message.get("mode") or "teacher").strip().lower()
                if mode not in ("teacher", "board", "screen", "grid", "student"):
                    mode = "teacher"
                spotlight_user = message.get("userId") or message.get("user_id") or ""
                if _is_teacher_role(role):
                    meta_kwargs = {"spotlight": mode, "presentation": mode}
                    if mode == "student" and spotlight_user:
                        meta_kwargs["spotlightUserId"] = str(spotlight_user)
                    elif mode != "student":
                        meta_kwargs["spotlightUserId"] = None
                    set_room_meta(room_id, **meta_kwargs)
                    await broadcast(room_id, {
                        "event": "spotlight",
                        "eventId": new_event_id(),
                        "mode": mode,
                        "userId": spotlight_user if mode == "student" else None,
                    }, exclude=websocket)

            elif event == "reaction":
                perms = get_room_permissions(room_id)
                if not _is_teacher_role(role) and not perms.get("studentsCanReact", True):
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "message": "Reactions are disabled by the teacher.",
                    }))
                else:
                    emoji = (message.get("emoji") or "👍").strip()[:8]
                    upsert_participant_flags(room_id, user_id, currentReaction=emoji)
                    await broadcast(room_id, {
                        "event": "reaction",
                        "eventId": new_event_id(),
                        "user_id": user_id,
                        "name": message.get("name") or name,
                        "emoji": emoji,
                        "role": role,
                    }, exclude=websocket)

            elif event == "poll_answer":
                await broadcast(room_id, {
                    "event": "poll_answer",
                    "eventId": new_event_id(),
                    "user_id": user_id,
                    "answer": message.get("answer"),
                })

    except WebSocketDisconnect:
        disconnect(room_id, websocket)
        # Only mark left if no other socket for this user remains
        still_here = any(_uid(c.get("user_id")) == _uid(user_id) for c in rooms.get(room_id, []))
        if not still_here:
            mark_participant_disconnected(room_id, user_id)
            await broadcast(room_id, {
                "event": "participant_left",
                "eventId": new_event_id(),
                "user_id": user_id,
                "role": role,
                "name": name,
            })
            await broadcast(room_id, {
                "event": "user_left",
                "eventId": new_event_id(),
                "user_id": user_id,
                "role": role,
                "name": name,
            })
    except Exception:
        disconnect(room_id, websocket)
        still_here = any(_uid(c.get("user_id")) == _uid(user_id) for c in rooms.get(room_id, []))
        if not still_here:
            mark_participant_disconnected(room_id, user_id)
            try:
                await broadcast(room_id, {
                    "event": "user_left",
                    "user_id": user_id,
                    "role": role,
                    "name": name,
                })
            except Exception:
                pass
