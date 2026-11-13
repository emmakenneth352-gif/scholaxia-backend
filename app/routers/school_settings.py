"""Per-school control panel settings.

The school admin (not the Scholaxia platform admin) runs their own school:
a 6-digit PIN that opens the control panel, and the list of TEACHER features
the school switches off for its own teachers. A teacher who taps a locked
feature is told to ask the school admin for access.
"""

import re
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_school_staff, require_teacher
from app.core.security import hash_password, verify_password
from app.models.school_campus import SchoolCampus
from app.models.school_feature_lock import SchoolFeatureLock

router = APIRouter(prefix="/school-settings", tags=["School settings"])

PIN_RE = re.compile(r"^\d{6}$")
DEFAULT_LOCK_MESSAGE = "Ask your school admin for access."

# Teacher screens a school can switch off. Keys match the teacher app's
# `data-feature-lock` values.
TEACHER_FEATURES = [
    {"key": "teacher.live", "label": "Live Classes", "description": "Host and schedule live classes."},
    {"key": "teacher.materials", "label": "Materials", "description": "Upload notes, PDFs and videos."},
    {"key": "teacher.exams", "label": "Exams", "description": "Publish exams and upload questions."},
    {"key": "teacher.students", "label": "Students", "description": "See the school's student list."},
    {"key": "teacher.grading", "label": "Grading", "description": "Score submitted work."},
    {"key": "teacher.community", "label": "Community", "description": "Post to the school community."},
    {"key": "teacher.ai", "label": "Teacher AI", "description": "AI lesson planning and questions."},
    {"key": "teacher.affiliate", "label": "Refer & Earn", "description": "The teacher's affiliate page."},
]


class PinIn(BaseModel):
    pin: str = Field(min_length=6, max_length=6)


class FeatureLockIn(BaseModel):
    key: str = Field(min_length=3, max_length=80)
    locked: bool
    message: Optional[str] = Field(default=None, max_length=300)


async def _school(db: AsyncSession, current_user: dict, school_id: Optional[str] = None) -> SchoolCampus:
    sid = current_user.get("school_id") if current_user.get("role") == "school_admin" else school_id
    if not sid:
        raise HTTPException(status_code=400, detail="Main admin must pick a school first")
    row = (await db.execute(select(SchoolCampus).where(SchoolCampus.id == sid))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="School not found")
    return row


async def _teacher_school(db: AsyncSession, current_user: dict) -> SchoolCampus | None:
    sid = current_user.get("school_id")
    if not sid:
        return None
    return (await db.execute(select(SchoolCampus).where(SchoolCampus.id == sid))).scalar_one_or_none()


@router.get("/pin")
async def pin_status(
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Does this school have a control-panel PIN yet?"""
    school = await _school(db, current_user, school_id)
    return {"has_pin": bool(school.admin_pin_hash), "school_name": school.name}


@router.post("/pin")
async def set_pin(
    payload: PinIn,
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Create or change the 6-digit PIN. Changing one needs the old PIN."""
    if not PIN_RE.match((payload.pin or "").strip()):
        raise HTTPException(status_code=422, detail="PIN must be exactly 6 digits")
    school = await _school(db, current_user, school_id)
    school.admin_pin_hash = hash_password(payload.pin.strip())
    await db.commit()
    return {"ok": True, "has_pin": True}


class PinChangeIn(BaseModel):
    current_pin: Optional[str] = Field(default=None, max_length=6)
    new_pin: str = Field(min_length=6, max_length=6)


@router.post("/pin/change")
async def change_pin(
    payload: PinChangeIn,
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    if not PIN_RE.match((payload.new_pin or "").strip()):
        raise HTTPException(status_code=422, detail="PIN must be exactly 6 digits")
    school = await _school(db, current_user, school_id)
    if school.admin_pin_hash and not verify_password((payload.current_pin or "").strip(), school.admin_pin_hash):
        raise HTTPException(status_code=403, detail="Current PIN is wrong")
    school.admin_pin_hash = hash_password(payload.new_pin.strip())
    await db.commit()
    return {"ok": True}


@router.post("/pin/verify")
async def verify_pin(
    payload: PinIn,
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    school = await _school(db, current_user, school_id)
    if not school.admin_pin_hash:
        return {"ok": False, "has_pin": False}
    ok = verify_password((payload.pin or "").strip(), school.admin_pin_hash)
    return {"ok": bool(ok), "has_pin": True}


async def _locks_for(db: AsyncSession, school_id) -> dict[str, dict]:
    rows = (
        await db.execute(
            select(SchoolFeatureLock).where(SchoolFeatureLock.school_id == school_id)
        )
    ).scalars().all()
    return {
        r.feature_key: {"locked": bool(r.is_locked), "message": r.message}
        for r in rows
        if r.is_locked
    }


@router.get("/features")
async def list_features(
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Every teacher feature with this school's lock state."""
    school = await _school(db, current_user, school_id)
    locks = await _locks_for(db, school.id)
    out = []
    for f in TEACHER_FEATURES:
        lock = locks.get(f["key"]) or {}
        out.append({**f, "locked": bool(lock.get("locked")), "message": lock.get("message") or ""})
    return {
        "features": out,
        "default_message": DEFAULT_LOCK_MESSAGE,
        "locked_count": sum(1 for f in out if f["locked"]),
    }


@router.put("/features")
async def set_feature_lock(
    payload: FeatureLockIn,
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Lock or unlock one teacher feature for this school."""
    school = await _school(db, current_user, school_id)
    known = {f["key"] for f in TEACHER_FEATURES}
    if payload.key not in known:
        raise HTTPException(status_code=404, detail="Unknown teacher feature")
    row = (
        await db.execute(
            select(SchoolFeatureLock).where(
                SchoolFeatureLock.school_id == school.id,
                SchoolFeatureLock.feature_key == payload.key,
            )
        )
    ).scalar_one_or_none()
    msg = (payload.message or "").strip() or None
    if row is None:
        row = SchoolFeatureLock(
            school_id=school.id,
            feature_key=payload.key,
            is_locked=bool(payload.locked),
            message=msg,
            updated_at=datetime.utcnow(),
        )
        db.add(row)
    else:
        row.is_locked = bool(payload.locked)
        row.message = msg
        row.updated_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "key": payload.key, "locked": bool(payload.locked)}


@router.get("/teacher-locks")
async def teacher_locks(
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """What this teacher's own school has switched off — read by the teacher app."""
    school = await _teacher_school(db, current_user)
    if school is None:
        return {"locks": {}, "message": DEFAULT_LOCK_MESSAGE, "school": None}
    locks = await _locks_for(db, school.id)
    return {
        "locks": {
            k: {"message": (v.get("message") or "").strip() or DEFAULT_LOCK_MESSAGE}
            for k, v in locks.items()
            if v.get("locked")
        },
        "message": DEFAULT_LOCK_MESSAGE,
        "school": school.name,
    }
