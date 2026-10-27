"""
Profiles Router
---------------
GET /api/v1/profiles/student/{user_id}  — public student profile
GET /api/v1/profiles/teacher/{user_id}  — public teacher profile
GET /api/v1/teachers/me                 — teacher's own full profile
GET /api/v1/students/me                 — already exists in students.py
"""
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.deps import require_teacher, require_student, get_current_user
from app.models.user import User, StudentProfile, TeacherProfile, UserRole

router = APIRouter(tags=["Profiles"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PublicStudentProfile(BaseModel):
    user_id: str
    full_name: str
    education_level: Optional[str]
    exam_type: Optional[str]
    selected_subjects: List[str]
    profile_picture: Optional[str]
    joined: str


class PublicTeacherProfile(BaseModel):
    user_id: str
    full_name: str
    subjects: List[str]
    bio: Optional[str]
    profile_picture: Optional[str]
    is_approved: bool


class MyTeacherProfile(BaseModel):
    user_id: str
    full_name: str
    email: str
    phone: Optional[str] = None
    subjects: List[str]
    bio: Optional[str]
    profile_picture: Optional[str]
    is_approved: bool
    joined: str


class UpdateProfilePictureRequest(BaseModel):
    profile_picture: str


# ── Student: own profile (token-based, no user_id needed) ────────────────────

@router.get("/profiles/me", response_model=PublicStudentProfile)
async def get_my_student_profile(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Get the authenticated student's own profile. Returns 404 if no profile yet."""
    result = await db.execute(
        select(User, StudentProfile)
        .outerjoin(StudentProfile, StudentProfile.user_id == User.id)
        .where(User.id == current_user["sub"])
    )
    row = result.first()
    if not row or not row[0]:
        raise HTTPException(status_code=404, detail="User not found")

    user, profile = row
    if not profile:
        raise HTTPException(status_code=404, detail="Student profile not found. Complete setup at /students/setup-exam")

    return PublicStudentProfile(
        user_id=str(user.id),
        full_name=user.full_name,
        education_level=profile.education_level,
        exam_type=str(profile.exam_type) if profile.exam_type else None,
        selected_subjects=profile.selected_subjects or [],
        profile_picture=user.profile_picture,
        joined=user.created_at.strftime("%B %Y"),
    )


@router.post("/profiles/me/photo")
async def upload_my_profile_photo(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload the logged-in user's profile photo in one call.

    Tries Cloudinary first; if that fails (e.g. credentials missing) the image
    is resized and stored locally under /uploads/profile/ so the upload still
    works. The user's profile_picture is updated and returned.
    """
    from pathlib import Path

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="No photo received. Pick an image and try again.")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Photo is too large. Maximum is 20MB.")
    try:
        from PIL import Image
        from io import BytesIO

        img = Image.open(BytesIO(content))
        img.verify()
        img = Image.open(BytesIO(content)).convert("RGB")
        img.thumbnail((1024, 1024))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=82)
        jpeg = buf.getvalue()
    except Exception:
        raise HTTPException(status_code=400, detail="That file is not a valid JPG, PNG or WebP image.")

    url = ""
    try:
        from app.services.media_service import upload_file as cloudinary_upload

        result = cloudinary_upload(jpeg, "images", filename="profile")
        url = (result.get("secure_url") or result.get("url") or "").strip()
    except Exception:
        url = ""
    if not url:
        # Local fallback — always available even without Cloudinary credentials.
        import uuid as _uuid

        media_root = Path(__file__).resolve().parent.parent / "uploads" / "profile"
        media_root.mkdir(parents=True, exist_ok=True)
        name = f"{_uuid.uuid4().hex}.jpg"
        (media_root / name).write_bytes(jpeg)
        base = str(request.base_url).rstrip("/")
        url = f"{base}/uploads/profile/{name}"

    result = await db.execute(select(User).where(User.id == UUID(str(current_user["sub"]))))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.profile_picture = url
    await db.flush()
    return {"message": "Profile picture updated", "profile_picture": url}


@router.patch("/profiles/me/picture")
async def update_my_profile_picture(
    payload: UpdateProfilePictureRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set the logged-in user's profile photo URL (after uploading via /community/upload)."""
    from app.core.config import settings

    url = (payload.profile_picture or "").strip()
    if url.startswith("/") and not url.startswith("//"):
        base = (getattr(settings, "PUBLIC_API_BASE", None) or "").rstrip("/")
        if not base:
            # Fallback — clients also resolve relative paths themselves.
            base = "https://scholaxia1.onrender.com"
        url = f"{base}{url}"
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="profile_picture must be a valid image URL")
    if len(url) > 1000:
        raise HTTPException(status_code=400, detail="profile_picture URL is too long")

    result = await db.execute(select(User).where(User.id == current_user["sub"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.profile_picture = url
    await db.flush()
    return {
        "message": "Profile picture updated",
        "profile_picture": user.profile_picture,
        "user_id": str(user.id),
    }


# ── Student public profile ────────────────────────────────────────────────────

@router.get("/profiles/student/{user_id}", response_model=PublicStudentProfile)
async def get_student_profile(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get a student's public profile by user_id."""
    try:
        student_id = UUID(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Student not found") from exc
    result = await db.execute(
        select(User, StudentProfile)
        .join(StudentProfile, StudentProfile.user_id == User.id)
        .where(User.id == student_id, User.role == UserRole.student, User.is_active == True)  # noqa: E712
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Student not found")

    user, profile = row
    return PublicStudentProfile(
        user_id=str(user.id),
        full_name=user.full_name,
        education_level=profile.education_level,
        exam_type=str(profile.exam_type) if profile.exam_type else None,
        selected_subjects=profile.selected_subjects or [],
        profile_picture=user.profile_picture,
        joined=user.created_at.strftime("%B %Y"),
    )


# ── Teacher public profile ────────────────────────────────────────────────────

@router.get("/profiles/teacher/{user_id}", response_model=PublicTeacherProfile)
async def get_teacher_profile(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get a teacher's public profile by user_id."""
    try:
        teacher_id = UUID(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Teacher not found") from exc
    result = await db.execute(
        select(User, TeacherProfile)
        .join(TeacherProfile, TeacherProfile.user_id == User.id)
        .where(User.id == teacher_id, User.role == UserRole.teacher, User.is_active == True)  # noqa: E712
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Teacher not found")

    user, profile = row
    return PublicTeacherProfile(
        user_id=str(user.id),
        full_name=user.full_name,
        subjects=profile.subjects or [],
        bio=profile.bio,
        profile_picture=user.profile_picture,
        is_approved=profile.is_approved,
    )


# ── Teacher: own full profile ─────────────────────────────────────────────────

@router.get("/teachers/me", response_model=MyTeacherProfile)
async def get_my_teacher_profile(
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Teacher fetches their own full profile (includes email)."""
    result = await db.execute(
        select(User, TeacherProfile)
        .join(TeacherProfile, TeacherProfile.user_id == User.id)
        .where(User.id == current_user["sub"])
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")

    user, profile = row
    return MyTeacherProfile(
        user_id=str(user.id),
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        subjects=profile.subjects or [],
        bio=profile.bio,
        profile_picture=user.profile_picture,
        is_approved=profile.is_approved,
        joined=user.created_at.strftime("%B %Y"),
    )


# ── Update teacher bio/subjects ───────────────────────────────────────────────

class UpdateTeacherProfileRequest(BaseModel):
    bio: Optional[str] = None
    subjects: Optional[List[str]] = None
    phone: Optional[str] = None


@router.patch("/teachers/me", response_model=MyTeacherProfile)
async def update_my_teacher_profile(
    payload: UpdateTeacherProfileRequest,
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Teacher updates their own bio or subject list."""
    result = await db.execute(
        select(User, TeacherProfile)
        .join(TeacherProfile, TeacherProfile.user_id == User.id)
        .where(User.id == current_user["sub"])
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")

    user, profile = row
    if payload.bio is not None:
        profile.bio = payload.bio
    if payload.subjects is not None:
        profile.subjects = payload.subjects
    if payload.phone is not None:
        phone = (payload.phone or "").strip()
        if phone and len(phone) < 7:
            raise HTTPException(status_code=400, detail="WhatsApp number looks too short")
        user.phone = phone or None

    await db.flush()

    return MyTeacherProfile(
        user_id=str(user.id),
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        subjects=profile.subjects or [],
        bio=profile.bio,
        profile_picture=user.profile_picture,
        is_approved=profile.is_approved,
        joined=user.created_at.strftime("%B %Y"),
    )


# ── List all teachers (public) ────────────────────────────────────────────────

@router.get("/profiles/teachers", response_model=List[PublicTeacherProfile])
async def list_teachers_public(db: AsyncSession = Depends(get_db)):
    """List all approved teachers — public, no auth needed."""
    result = await db.execute(
        select(User, TeacherProfile)
        .join(TeacherProfile, TeacherProfile.user_id == User.id)
        .where(
            User.role == UserRole.teacher,
            User.is_active == True,  # noqa: E712
            TeacherProfile.is_approved == True,  # noqa: E712
        )
    )
    rows = result.all()
    return [
        PublicTeacherProfile(
            user_id=str(u.id),
            full_name=u.full_name,
            subjects=p.subjects or [],
            bio=p.bio,
            profile_picture=u.profile_picture,
            is_approved=p.is_approved,
        )
        for u, p in rows
    ]
