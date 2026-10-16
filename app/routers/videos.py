from typing import Optional
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, engine
from app.core.deps import require_admin, require_student, require_kind
from app.models.content import Video
from app.models.user import UserRole

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Video tutorials"])


@router.get("/study-access")
async def study_access(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Whether this student's ANY paid subscription unlocks Video Tutorials + Library."""
    from app.services.study_access import get_study_access_info

    info = await get_study_access_info(db, current_user["sub"])
    return info


async def ensure_videos_table() -> None:
    stmts = (
        """
        CREATE TABLE IF NOT EXISTS videos (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title VARCHAR(255) NOT NULL,
            subject VARCHAR(100) NOT NULL,
            tutor_name VARCHAR(150) NULL,
            exam_type VARCHAR(20) NULL,
            video_url VARCHAR(500) NOT NULL,
            thumbnail_url VARCHAR(500) NULL,
            duration_seconds INTEGER NULL,
            uploaded_by UUID NULL REFERENCES users(id),
            audience VARCHAR(20) NOT NULL DEFAULT 'student',
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "ALTER TABLE videos ADD COLUMN IF NOT EXISTS tutor_name VARCHAR(150)",
        "ALTER TABLE videos ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'student'",
        "CREATE INDEX IF NOT EXISTS ix_videos_subject ON videos (subject)",
        "CREATE INDEX IF NOT EXISTS ix_videos_created_at ON videos (created_at)",
        "CREATE INDEX IF NOT EXISTS ix_videos_audience ON videos (audience)",
    )
    try:
        async with engine.begin() as conn:
            for stmt in stmts:
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    logger.warning("videos schema stmt skipped: %s", exc)
    except Exception as exc:
        logger.warning("ensure_videos_table failed: %s", exc)


def _video_dict(row: Video) -> dict:
    return {
        "id": str(row.id),
        "title": row.title,
        "subject": row.subject,
        "tutor_name": getattr(row, "tutor_name", None) or "",
        "exam_type": row.exam_type,
        "video_url": row.video_url,
        "thumbnail_url": row.thumbnail_url,
        "duration_seconds": row.duration_seconds,
        "audience": getattr(row, "audience", None) or "student",
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


class VideoCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    subject: str = "General"
    tutor_name: Optional[str] = None
    exam_type: Optional[str] = None
    video_url: str = Field(..., min_length=8, max_length=500)
    thumbnail_url: Optional[str] = None
    audience: str = "student"  # student | kind


@router.get("/videos")
async def list_videos(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student Video Tutorials — excludes Kids-only uploads."""
    await ensure_videos_table()
    rows = (
        await db.execute(
            select(Video)
            .where(or_(Video.audience == "student", Video.audience.is_(None)))
            .order_by(Video.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    return {"videos": [_video_dict(r) for r in rows]}


@router.get("/videos/kind")
async def list_kind_videos(
    current_user: dict = Depends(require_kind),
    db: AsyncSession = Depends(get_db),
):
    """Kids app videos — separate from student Video Tutorials."""
    await ensure_videos_table()
    rows = (
        await db.execute(
            select(Video)
            .where(Video.audience == "kind")
            .order_by(Video.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    return {"videos": [_video_dict(r) for r in rows]}


@router.get("/admin/videos")
async def admin_list_videos(
    audience: Optional[str] = Query(None),
    q: Optional[str] = None,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await ensure_videos_table()
    query = select(Video)
    if audience and audience.strip():
        query = query.where(Video.audience == audience.strip().lower())
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.where(
            or_(
                Video.title.ilike(term),
                Video.subject.ilike(term),
                Video.tutor_name.ilike(term),
            )
        )
    rows = (await db.execute(query.order_by(Video.created_at.desc()).limit(200))).scalars().all()
    return {"videos": [_video_dict(r) for r in rows]}


@router.post("/admin/videos", status_code=201)
async def create_video(
    payload: VideoCreate,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await ensure_videos_table()
    url = payload.video_url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="video_url must be an http(s) link")
    aud = (payload.audience or "student").strip().lower()
    if aud not in ("student", "kind"):
        raise HTTPException(status_code=400, detail="audience must be student or kind")
    uploaded_by = None
    try:
        uploaded_by = uuid.UUID(str(current_user["sub"]))
    except Exception:
        uploaded_by = None
    row = Video(
        title=payload.title.strip(),
        subject=(payload.subject or "General").strip(),
        tutor_name=((payload.tutor_name or "").strip() or None),
        exam_type=payload.exam_type,
        video_url=url,
        thumbnail_url=payload.thumbnail_url,
        audience=aud,
        uploaded_by=uploaded_by,
    )
    db.add(row)
    await db.flush()
    return _video_dict(row)


@router.delete("/admin/videos/{video_id}")
async def delete_video(
    video_id: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(Video).where(Video.id == video_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Video not found")
    await db.delete(row)
    await db.flush()
    return {"ok": True}
