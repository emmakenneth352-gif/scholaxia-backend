"""Tutor hub: the admin sends study material to tutors, tutors send lesson notes.

Deliberately separate from the school portal — this is the Scholaxia admin
talking to individual tutors (teachers) on the platform.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.tutor_hub import TutorLessonNote, TutorMaterial
from app.models.user import User, UserRole

router = APIRouter(prefix="/tutor-hub", tags=["Tutor hub"])

NOTE_STATUSES = ("submitted", "approved", "needs_work")


def _role(user: dict) -> str:
    return str((user or {}).get("role") or "").lower().replace("userrole.", "")


def _is_admin(user: dict) -> bool:
    return _role(user) == "admin"


def _uid(user: dict) -> UUID:
    return UUID(str(user.get("id") or user.get("sub") or user.get("user_id")))


def _material_dict(m: TutorMaterial, tutor_name: Optional[str] = None) -> dict:
    return {
        "id": str(m.id),
        "title": m.title,
        "subject": m.subject,
        "class_name": m.class_name,
        "description": m.description,
        "link_url": m.link_url,
        "teacher_id": str(m.teacher_id) if m.teacher_id else None,
        "tutor_name": tutor_name or ("Every tutor" if not m.teacher_id else None),
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _note_dict(n: TutorLessonNote, tutor_name: Optional[str] = None) -> dict:
    return {
        "id": str(n.id),
        "teacher_id": str(n.teacher_id),
        "tutor_name": tutor_name,
        "title": n.title,
        "subject": n.subject,
        "class_name": n.class_name,
        "week": n.week,
        "term": n.term,
        "content": n.content,
        "attachment_url": n.attachment_url,
        "status": n.status,
        "admin_comment": n.admin_comment,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "reviewed_at": n.reviewed_at.isoformat() if n.reviewed_at else None,
    }


class MaterialIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    teacher_id: Optional[str] = None  # omitted = every tutor
    subject: Optional[str] = Field(default=None, max_length=120)
    class_name: Optional[str] = Field(default=None, max_length=60)
    description: Optional[str] = Field(default=None, max_length=4000)
    link_url: Optional[str] = Field(default=None, max_length=600)


class NoteIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    content: str = Field(min_length=2, max_length=20000)
    subject: Optional[str] = Field(default=None, max_length=120)
    class_name: Optional[str] = Field(default=None, max_length=60)
    week: Optional[str] = Field(default=None, max_length=40)
    term: Optional[str] = Field(default=None, max_length=40)
    attachment_url: Optional[str] = Field(default=None, max_length=600)


class NoteReviewIn(BaseModel):
    status: str = Field(default="approved")
    admin_comment: Optional[str] = Field(default=None, max_length=2000)


@router.get("/tutors")
async def list_tutors(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Tutors an admin can send material to."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    rows = (
        await db.execute(
            select(User).where(User.role == UserRole.teacher).order_by(User.full_name)
        )
    ).scalars().all()
    return {"tutors": [{"id": str(u.id), "name": u.full_name, "email": u.email} for u in rows]}


@router.get("/materials")
async def list_materials(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin: everything sent. Tutor: the materials addressed to them."""
    q = select(TutorMaterial).order_by(TutorMaterial.created_at.desc())
    if not _is_admin(current_user):
        me = _uid(current_user)
        q = q.where(
            (TutorMaterial.teacher_id == me) | (TutorMaterial.teacher_id.is_(None))
        )
    rows = (await db.execute(q)).scalars().all()
    names: dict[str, str] = {}
    ids = [m.teacher_id for m in rows if m.teacher_id]
    if ids:
        users = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
        names = {str(u.id): u.full_name for u in users}
    return {"materials": [_material_dict(m, names.get(str(m.teacher_id)) if m.teacher_id else None) for m in rows]}


@router.post("/materials", status_code=201)
async def send_material(
    payload: MaterialIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin sends study material straight to one tutor (or all of them)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only the admin can send materials")
    teacher_id = None
    if payload.teacher_id:
        try:
            teacher_id = UUID(payload.teacher_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid tutor id")
        exists = (
            await db.execute(
                select(User).where(User.id == teacher_id, User.role == UserRole.teacher)
            )
        ).scalar_one_or_none()
        if not exists:
            raise HTTPException(status_code=404, detail="Tutor not found")
    row = TutorMaterial(
        admin_id=_uid(current_user),
        teacher_id=teacher_id,
        title=payload.title.strip(),
        subject=(payload.subject or "").strip() or None,
        class_name=(payload.class_name or "").strip() or None,
        description=(payload.description or "").strip() or None,
        link_url=(payload.link_url or "").strip() or None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"ok": True, "material": _material_dict(row)}


@router.delete("/materials/{material_id}")
async def delete_material(
    material_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only the admin can remove materials")
    row = (
        await db.execute(select(TutorMaterial).where(TutorMaterial.id == UUID(material_id)))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.get("/notes")
async def list_notes(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin sees every submitted note; a tutor sees their own."""
    q = select(TutorLessonNote).order_by(TutorLessonNote.created_at.desc())
    if not _is_admin(current_user):
        q = q.where(TutorLessonNote.teacher_id == _uid(current_user))
    elif status_filter in NOTE_STATUSES:
        q = q.where(TutorLessonNote.status == status_filter)
    rows = (await db.execute(q)).scalars().all()
    names: dict[str, str] = {}
    if _is_admin(current_user):
        ids = {n.teacher_id for n in rows}
        if ids:
            users = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
            names = {str(u.id): u.full_name for u in users}
    return {"notes": [_note_dict(n, names.get(str(n.teacher_id))) for n in rows]}


@router.post("/notes", status_code=201)
async def submit_note(
    payload: NoteIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A tutor submits a lesson note for the admin to check."""
    if _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only tutors submit lesson notes")
    row = TutorLessonNote(
        teacher_id=_uid(current_user),
        title=payload.title.strip(),
        content=payload.content.strip(),
        subject=(payload.subject or "").strip() or None,
        class_name=(payload.class_name or "").strip() or None,
        week=(payload.week or "").strip() or None,
        term=(payload.term or "").strip() or None,
        attachment_url=(payload.attachment_url or "").strip() or None,
        status="submitted",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"ok": True, "note": _note_dict(row)}


@router.patch("/notes/{note_id}")
async def review_note(
    note_id: str,
    payload: NoteReviewIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin approves or sends a note back. A tutor may edit their own note
    while it has not been approved yet."""
    row = (
        await db.execute(select(TutorLessonNote).where(TutorLessonNote.id == UUID(note_id)))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Lesson note not found")
    if _is_admin(current_user):
        if payload.status not in NOTE_STATUSES:
            raise HTTPException(status_code=422, detail="status must be submitted, approved or needs_work")
        row.status = payload.status
        row.admin_comment = (payload.admin_comment or "").strip() or row.admin_comment
        row.reviewed_at = datetime.utcnow()
    else:
        if str(row.teacher_id) != str(_uid(current_user)):
            raise HTTPException(status_code=403, detail="This is not your lesson note")
        if row.status == "approved":
            raise HTTPException(status_code=409, detail="This note is already approved")
        if payload.admin_comment is not None:
            raise HTTPException(status_code=403, detail="Only the admin can comment")
    await db.commit()
    await db.refresh(row)
    return {"ok": True, "note": _note_dict(row)}
