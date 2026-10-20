from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta
import httpx
import json
import uuid
from app.core.database import get_db
from app.core.deps import (
    require_student,
    require_student_or_kind,
    require_admin,
    get_current_user,
    require_teacher,
    require_teacher_or_admin,
)
from app.models.cbt import CBTExam, CBTQuestion, CBTSession, ExamProctorLog, normalize_paper_kind
from app.models.user import StudentProfile, User
from app.core.subjects import subject_matches, AVAILABLE_SUBJECTS
from app.services.cbt_access import has_board_access, normalize_board

router = APIRouter(prefix="/cbt", tags=["CBT"])

PRACTICE_BANK_BASE = "https://www.scholaxiacbtexam.blog/practice-exams"


async def _require_paid_practice_access(
    db: AsyncSession,
    current_user: dict,
    exam: CBTExam,
) -> None:
    """School exams stay free; practice exams require an active annual package."""
    if exam.is_school_exam:
        return
    role = (current_user.get("role") or "").lower()
    if role not in {"student", "kind"}:
        return
    board = normalize_board(exam.exam_type)
    if await has_board_access(db, current_user["sub"], board):
        return
    raise HTTPException(
        status_code=402,
        detail={
            "code": "cbt_package_required",
            "board": board,
            "message": (
                "Your annual CBT package is inactive, expired, or your paid "
                "subjects were changed. Choose a package to continue."
            ),
        },
    )


@router.get("/packages")
async def list_cbt_packages(db: AsyncSession = Depends(get_db)):
    """Annual CBT products. Prices come from admin overrides (or defaults)."""
    from app.core.cbt_packages import all_cbt_packages_dict_db

    return {"packages": await all_cbt_packages_dict_db(db)}


@router.get("/practice-bank/{category}")
async def practice_bank(
    category: str,
    current_user: dict = Depends(require_student),
):
    """Proxy Scholaxia CBT question bank (avoids browser CORS blocks)."""
    return await _load_practice_bank(category)


@router.get("/practice-bank/guest/{category}")
async def guest_practice_bank(category: str):
    """Public question-bank feed for local-only guest CBT practice."""
    return await _load_practice_bank(category)


async def _load_practice_bank(category: str):
    cat = category.strip().upper()
    if cat not in {"JAMB", "WAEC", "NECO", "POST_UTME", "POST-UTME"}:
        raise HTTPException(status_code=400, detail="category must be JAMB, WAEC, NECO, or POST_UTME")
    cat_key = cat.replace("-", "_").upper()
    if cat_key == "POST_UTME":
        raise HTTPException(status_code=404, detail="POST-UTME practice bank uses ALOC API only")
    url = f"{PRACTICE_BANK_BASE}/{cat.lower()}.json"
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not load practice bank: {exc}") from exc


# ── ALOC Past Questions (questions.aloc.com.ng) ───────────────────────────────

def _profile_exam_type(profile) -> str:
    if not profile or not profile.exam_type:
        return "JAMB"
    return profile.exam_type.value if hasattr(profile.exam_type, "value") else str(profile.exam_type)


def _aloc_exam_response(exam: dict) -> dict:
    return {
        "session": {
            "session_id": f"aloc-{int(datetime.utcnow().timestamp())}",
            "is_portal": True,
            "is_aloc": True,
            "is_school_exam": False,
        },
        "exam": {
            "id": exam["id"],
            "title": exam["title"],
            "subject": exam["subject"],
            "exam_type": exam["exam_type"],
            "duration_minutes": exam["duration_minutes"],
            "total_questions": len(exam["questions"]),
            "questions": exam["questions"],
            "sections": exam["sections"],
            "is_combined": True,
            "is_aloc": True,
            "selected_year": exam.get("selected_year", ""),
        },
        "meta": exam["meta"],
        "selected_year": exam.get("selected_year", ""),
        "secondsLeft": exam["duration_minutes"] * 60,
    }


async def _get_student_profile(db, user_id: str) -> StudentProfile:
    profile_res = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == user_id)
    )
    profile = profile_res.scalar_one_or_none()
    if not profile or not profile.selected_subjects:
        raise HTTPException(status_code=400, detail="Complete exam setup in Profile first")
    return profile


@router.get("/aloc/status")
async def aloc_status(current_user: dict = Depends(require_student)):
    from app.services.aloc_service import aloc_configured

    return {"configured": aloc_configured(), "provider": "questions.aloc.com.ng"}


@router.get("/aloc/exam-preview")
async def aloc_exam_preview(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    from app.services.aloc_service import aloc_configured, build_combined_exam, normalize_exam_type

    if not aloc_configured():
        raise HTTPException(status_code=404, detail="ALOC is not configured on the server")

    profile = await _get_student_profile(db, current_user["sub"])
    exam_type = normalize_exam_type(_profile_exam_type(profile))
    preview = await build_combined_exam(exam_type, profile.selected_subjects, fetch=False)
    preview.pop("questions", None)
    preview.pop("sections", None)
    return preview


@router.get("/aloc/exam")
async def aloc_exam(
    year: Optional[str] = Query(None),
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    from app.core.config import settings
    from app.services.aloc_service import aloc_configured, build_combined_exam, normalize_exam_type

    if not aloc_configured():
        raise HTTPException(status_code=503, detail="ALOC access token is not configured on the server")

    profile = await _get_student_profile(db, current_user["sub"])
    exam_type = normalize_exam_type(_profile_exam_type(profile))

    if year is not None:
        use_year = str(year).strip() or None
    else:
        use_year = (settings.ALOC_DEFAULT_YEAR or "").strip() or None

    exam = await build_combined_exam(
        exam_type, profile.selected_subjects, year=use_year, fetch=True
    )
    if not exam["questions"]:
        raise HTTPException(status_code=502, detail="ALOC returned no questions for your subjects")

    return _aloc_exam_response(exam)


@router.get("/aloc/jamb-preview")
async def aloc_jamb_preview(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    from app.services.aloc_service import aloc_configured, build_combined_exam

    if not aloc_configured():
        raise HTTPException(status_code=404, detail="ALOC is not configured on the server")

    profile = await _get_student_profile(db, current_user["sub"])
    if _profile_exam_type(profile).upper() != "JAMB" or len(profile.selected_subjects) != 4:
        raise HTTPException(status_code=400, detail="ALOC full JAMB CBT requires exactly 4 JAMB subjects")

    preview = await build_combined_exam("JAMB", profile.selected_subjects, fetch=False)
    preview.pop("questions", None)
    preview.pop("sections", None)
    return preview


@router.get("/aloc/jamb-exam")
async def aloc_jamb_exam(
    year: Optional[str] = Query(None),
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    from app.core.config import settings
    from app.services.aloc_service import aloc_configured, build_combined_exam

    if not aloc_configured():
        raise HTTPException(status_code=503, detail="ALOC access token is not configured on the server")

    profile = await _get_student_profile(db, current_user["sub"])

    if year is not None:
        use_year = str(year).strip() or None
    else:
        use_year = (settings.ALOC_DEFAULT_YEAR or "").strip() or None

    exam = await build_combined_exam("JAMB", profile.selected_subjects, year=use_year, fetch=True)
    if not exam["questions"]:
        raise HTTPException(status_code=502, detail="ALOC returned no questions for your subjects")

    return _aloc_exam_response(exam)


# ── Schemas ───────────────────────────────────────────────────────────────────

class SubmitAnswersRequest(BaseModel):
    session_id: str
    answers: dict  # {question_id: "A"|"B"|"C"|"D"}
    is_auto_submit: bool = False


class SessionResponse(BaseModel):
    session_id: str
    exam_id: str
    started_at: datetime
    duration_minutes: int
    total_questions: int
    is_school_exam: bool = False
    ai_locked: bool = False
    camera_required: bool = False
    block_minimize: bool = False


class ResultResponse(BaseModel):
    score: float
    percentage: float
    total_correct: int
    total_wrong: int
    weak_topics: list
    # Owner spec §22/§25: set to "hidden" for school exams until the school
    # publishes results — clients show a confirmation instead of the score.
    result_status: Optional[str] = None
    message: Optional[str] = None
    # Duplicate-submission safety: True when this exact attempt was already
    # submitted (the response is idempotent — nothing was re-marked).
    already_submitted: Optional[bool] = None
    submitted_at: Optional[datetime] = None


class ExamSummary(BaseModel):
    id: str
    title: str
    subject: str
    exam_type: str
    year: Optional[int] = None
    duration_minutes: int
    total_questions: int
    is_published: bool
    is_school_exam: bool = False
    paper_kind: str = "cbt_practice"
    camera_required: bool = False
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None


def _exam_summary(e: CBTExam) -> ExamSummary:
    return ExamSummary(
        id=str(e.id),
        title=e.title or "Exam",
        subject=e.subject or "General",
        exam_type=str(e.exam_type or "GENERAL"),
        year=e.year,
        duration_minutes=int(e.duration_minutes or 60),
        total_questions=int(e.total_questions or 0),
        is_published=bool(e.is_published),
        is_school_exam=bool(e.is_school_exam),
        paper_kind=normalize_paper_kind(getattr(e, "paper_kind", None)),
        camera_required=bool(getattr(e, "camera_required", False)),
        scheduled_start=e.scheduled_start,
        scheduled_end=e.scheduled_end,
    )


def _school_exam_is_open(exam: CBTExam, now: datetime) -> bool:
    if not exam.is_school_exam:
        return True
    if exam.scheduled_start and now < exam.scheduled_start:
        return False
    if exam.scheduled_end and now > exam.scheduled_end:
        return False
    return True


class SchoolExamQuestionCreate(BaseModel):
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_option: str
    explanation: Optional[str] = None
    topic: Optional[str] = None


class CreateSchoolExamRequest(BaseModel):
    title: str
    subject: str
    duration_minutes: int
    scheduled_start: datetime
    scheduled_end: datetime
    questions: List[SchoolExamQuestionCreate]
    camera_required: bool = False
    ai_locked: bool = False
    block_minimize: bool = False


class QuestionOut(BaseModel):
    id: str
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    topic: Optional[str]
    image_url: Optional[str]


class ExamDownload(BaseModel):
    id: str
    title: str
    subject: str
    exam_type: str
    duration_minutes: int
    total_questions: int
    questions: List[QuestionOut]


# ── CBT SUBJECT LOCK ENDPOINTS ──

class CBTSubjectUpdateRequest(BaseModel):
    """Request to update CBT subjects."""
    exam_type: str = Field(..., description="JAMB, WAEC, NECO, or GENERAL")
    subjects: List[str] = Field(..., description="List of subject names")


class CBTProfileActivateRequest(BaseModel):
    """Request to activate a CBT profile."""
    exam_types: List[str] = Field(..., description="Exam types to activate (JAMB, WAEC, NECO)")
    subjects: dict = Field(..., description="Subjects for each exam type")


class AdminSubjectChangeRequest(BaseModel):
    """Admin request to change a student's subjects."""
    student_id: str
    exam_type: str
    subjects: List[str]
    reason: Optional[str] = Field(None, description="Reason for the change")


class AdminUnlockRequest(BaseModel):
    """Admin request to unlock a student's CBT profile."""
    student_id: str
    reason: Optional[str] = Field(None, description="Reason for unlocking")


@router.get("/profile/subjects")
async def get_cbt_subjects(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Get the current student's CBT subjects and lock state."""
    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user["sub"])
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        return {
            "has_profile": False,
            "is_locked": False,
            "is_active": False,
            "subjects": {},
            "available_exams": [],
            "message": "Complete exam setup in Profile first"
        }

    # Build subjects dict
    subjects = {}
    if profile.jamb_subjects:
        subjects["JAMB"] = profile.jamb_subjects
    if profile.ssce_subjects and profile.ssce_exam_type:
        subjects[profile.ssce_exam_type.upper()] = profile.ssce_subjects
    if profile.selected_subjects and not subjects:
        # Fallback for legacy profiles
        subjects["GENERAL"] = profile.selected_subjects

    # Build available exams list
    available_exams = []
    if profile.jamb_subjects:
        available_exams.append("JAMB")
    if profile.ssce_exam_type:
        available_exams.append(profile.ssce_exam_type.upper())
    if not available_exams and profile.selected_subjects:
        available_exams = ["GENERAL"]

    return {
        "has_profile": True,
        "is_locked": profile.cbt_subjects_locked,
        "is_active": bool(profile.jamb_subjects or profile.ssce_subjects or profile.selected_subjects),
        "subjects": subjects,
        "available_exams": available_exams,
        "education_level": profile.education_level,
        "exam_type": profile.exam_type.value if profile.exam_type else None,
    }


@router.post("/profile/subjects")
async def update_cbt_subjects(
    request: CBTSubjectUpdateRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a student's CBT subjects.

    IMPORTANT: This will be rejected if the profile is locked.
    Students cannot change subjects after activation.
    """
    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user["sub"])
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        from app.models.user import ExamType
        profile = StudentProfile(
            user_id=current_user["sub"],
            exam_type=ExamType.JAMB,
            selected_subjects=[],
            cbt_subjects_locked=False,
        )
        db.add(profile)
        await db.flush()

    # ===== CRITICAL: Check if profile is locked =====
    if profile.cbt_subjects_locked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your CBT profile is locked. You cannot change subjects after activation. Contact your school admin for assistance."
        )

    exam_type = request.exam_type.upper().strip()

    # Validate subjects against available list
    valid_subjects = AVAILABLE_SUBJECTS
    valid_lower = {s.lower(): s for s in valid_subjects}
    validated = []

    for subj in request.subjects:
        subj_lower = subj.strip().lower()
        if subj_lower in valid_lower:
            validated.append(valid_lower[subj_lower])
        else:
            # Try fuzzy match
            found = False
            for valid in valid_subjects:
                if subj_lower in valid.lower() or valid.lower() in subj_lower:
                    validated.append(valid)
                    found = True
                    break
            if not found:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid subject '{subj}'. Available subjects: {', '.join(valid_subjects[:10])}..."
                )

    # Update the appropriate subject list
    if exam_type == "JAMB":
        profile.jamb_subjects = validated
        profile.selected_subjects = validated  # Backward compatibility
    elif exam_type in ("WAEC", "NECO"):
        profile.ssce_subjects = validated
        profile.ssce_exam_type = exam_type
        profile.selected_subjects = validated  # Backward compatibility
    else:
        # General fallback
        profile.selected_subjects = validated

    profile.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "success": True,
        "message": f"{exam_type} subjects updated successfully",
        "subjects": validated,
        "is_locked": profile.cbt_subjects_locked,
        "exam_type": exam_type,
    }


@router.post("/profile/activate")
async def activate_cbt_profile(
    request: CBTProfileActivateRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Activate a student's CBT profile.

    IMPORTANT: Once activated, the profile is LOCKED and subjects cannot be changed.
    This is the point of no return for subject selection.
    """
    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user["sub"])
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        from app.models.user import ExamType
        profile = StudentProfile(
            user_id=current_user["sub"],
            exam_type=ExamType.JAMB,
            selected_subjects=[],
            cbt_subjects_locked=False,
        )
        db.add(profile)
        await db.flush()

    # ===== CRITICAL: Check if already locked =====
    if profile.cbt_subjects_locked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your CBT profile is already activated and locked. Contact your school admin for subject changes."
        )

    # A profile row can exist WITHOUT an exam type (e.g. created by school
    # exam registration). Those students saw an empty CBT catalog forever —
    # "setup_required" even after activating — because nothing ever set
    # exam_type on the existing row. Derive it from the boards activated.
    if not profile.exam_type:
        from app.models.user import ExamType as _ExamType
        _types = " ".join((request.exam_types or [])).upper()
        if "JUNIOR" in _types or "BECE" in _types:
            profile.exam_type = _ExamType.JUNIOR_WAEC
        elif "POST_UTME" in _types or "JAMB" in _types:
            profile.exam_type = _ExamType.JAMB
        else:
            profile.exam_type = _ExamType.WAEC

    valid_subjects = AVAILABLE_SUBJECTS
    valid_lower = {s.lower(): s for s in valid_subjects}

    # Validate and set subjects for each exam type
    for exam_type, subjects in request.subjects.items():
        exam_type = exam_type.upper().strip()
        validated = []

        for subj in subjects:
            subj_lower = subj.strip().lower()
            if subj_lower in valid_lower:
                validated.append(valid_lower[subj_lower])
            else:
                # Fuzzy match
                found = False
                for valid in valid_subjects:
                    if subj_lower in valid.lower() or valid.lower() in subj_lower:
                        validated.append(valid)
                        found = True
                        break
                if not found:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid subject '{subj}' for {exam_type}"
                    )

        if exam_type == "JAMB":
            profile.jamb_subjects = validated
        elif exam_type in ("WAEC", "NECO"):
            profile.ssce_subjects = validated
            profile.ssce_exam_type = exam_type
        else:
            profile.selected_subjects = validated

    # Update selected_subjects for backward compatibility
    if profile.jamb_subjects:
        profile.selected_subjects = profile.jamb_subjects
    elif profile.ssce_subjects:
        profile.selected_subjects = profile.ssce_subjects

    # ===== CRITICAL: Lock the profile =====
    profile.cbt_subjects_locked = True
    profile.locked_at = datetime.utcnow()
    profile.locked_by = uuid.UUID(str(current_user["sub"]))
    profile.updated_at = datetime.utcnow()
    await db.commit()

    # Build response subjects
    subjects_response = {}
    if profile.jamb_subjects:
        subjects_response["JAMB"] = profile.jamb_subjects
    if profile.ssce_subjects and profile.ssce_exam_type:
        subjects_response[profile.ssce_exam_type.upper()] = profile.ssce_subjects

    return {
        "success": True,
        "message": "CBT profile activated and locked. You cannot change subjects now.",
        "is_locked": True,
        "is_active": True,
        "subjects": subjects_response,
    }


# ── ADMIN CBT SUBJECT MANAGEMENT ──

@router.post("/admin/subjects/change")
async def admin_change_student_subjects(
    request: AdminSubjectChangeRequest,
    current_user: dict = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin/Teacher endpoint to change a student's subjects.

    This bypasses the lock mechanism and is the ONLY way to change
    subjects after a student's profile has been activated/locked.
    """
    try:
        student_id = uuid.UUID(request.student_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid student_id format"
        )

    # Verify student exists
    student_result = await db.execute(
        select(User).where(User.id == student_id)
    )
    student = student_result.scalar_one_or_none()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with ID {request.student_id} not found"
        )

    # Get or create profile
    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == student_id)
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        from app.models.user import ExamType
        profile = StudentProfile(
            user_id=student_id,
            exam_type=ExamType.JAMB,
            selected_subjects=[],
            cbt_subjects_locked=False,
        )
        db.add(profile)
        await db.flush()

    exam_type = request.exam_type.upper().strip()

    # Validate subjects
    valid_subjects = AVAILABLE_SUBJECTS
    valid_lower = {s.lower(): s for s in valid_subjects}
    validated = []

    for subj in request.subjects:
        subj_lower = subj.strip().lower()
        if subj_lower in valid_lower:
            validated.append(valid_lower[subj_lower])
        else:
            found = False
            for valid in valid_subjects:
                if subj_lower in valid.lower() or valid.lower() in subj_lower:
                    validated.append(valid)
                    found = True
                    break
            if not found:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid subject '{subj}' for {exam_type}"
                )

    # Update the appropriate subject list
    if exam_type == "JAMB":
        profile.jamb_subjects = validated
        profile.selected_subjects = validated
    elif exam_type in ("WAEC", "NECO"):
        profile.ssce_subjects = validated
        profile.ssce_exam_type = exam_type
        profile.selected_subjects = validated
    else:
        profile.selected_subjects = validated

    # Profile remains locked (admin override)
    profile.cbt_subjects_locked = True
    profile.locked_at = datetime.utcnow()
    profile.locked_by = uuid.UUID(str(current_user["sub"]))
    profile.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "success": True,
        "message": f"Updated {exam_type} subjects for student {student.full_name or student.email}",
        "admin": current_user.get("sub"),
        "student_id": str(student_id),
        "exam_type": exam_type,
        "subjects": validated,
        "reason": request.reason,
        "is_locked": profile.cbt_subjects_locked,
    }


@router.post("/admin/profile/unlock")
async def admin_unlock_cbt_profile(
    request: AdminUnlockRequest,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin endpoint to unlock a student's CBT profile.

    Use this if a student needs to change subjects after activation.
    After unlocking, the student can update subjects again.
    """
    try:
        student_id = uuid.UUID(request.student_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid student_id format"
        )

    # Verify student exists
    student_result = await db.execute(
        select(User).where(User.id == student_id)
    )
    if not student_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with ID {request.student_id} not found"
        )

    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == student_id)
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        return {
            "success": True,
            "message": "No profile found for this student",
            "student_id": request.student_id,
            "is_locked": False
        }

    if not profile.cbt_subjects_locked:
        return {
            "success": True,
            "message": "Profile is already unlocked",
            "student_id": request.student_id,
            "is_locked": False
        }

    # Unlock the profile
    profile.cbt_subjects_locked = False
    profile.locked_at = None
    profile.locked_by = None
    profile.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "success": True,
        "message": f"Profile unlocked by admin. Reason: {request.reason or 'Not specified'}",
        "student_id": request.student_id,
        "is_locked": False
    }


@router.post("/admin/profile/lock")
async def admin_lock_cbt_profile(
    student_id: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin endpoint to lock a student's CBT profile.

    Use this after a student has confirmed their subjects.
    """
    try:
        uid = uuid.UUID(student_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid student_id format"
        )

    # Verify student exists
    student_result = await db.execute(
        select(User).where(User.id == uid)
    )
    if not student_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with ID {student_id} not found"
        )

    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == uid)
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        return {
            "success": True,
            "message": "No profile found for this student",
            "student_id": student_id,
            "is_locked": False
        }

    if profile.cbt_subjects_locked:
        return {
            "success": True,
            "message": "Profile is already locked",
            "student_id": student_id,
            "is_locked": True
        }

    # Lock the profile
    profile.cbt_subjects_locked = True
    profile.locked_at = datetime.utcnow()
    profile.locked_by = uuid.UUID(str(current_user["sub"]))
    profile.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "success": True,
        "message": "Profile locked by admin",
        "student_id": student_id,
        "is_locked": True
    }


@router.get("/admin/profile/{student_id}")
async def admin_get_student_profile(
    student_id: str,
    current_user: dict = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin/Teacher endpoint to view a student's subjects and lock state.
    """
    try:
        uid = uuid.UUID(student_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid student_id format"
        )

    # Verify student exists
    student_result = await db.execute(
        select(User).where(User.id == uid)
    )
    student = student_result.scalar_one_or_none()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with ID {student_id} not found"
        )

    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == uid)
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        return {
            "student_id": student_id,
            "student_email": student.email,
            "student_name": student.full_name or "Student",
            "has_profile": False,
            "is_locked": False,
            "is_active": False,
            "subjects": {},
            "available_exams": []
        }

    # Build subjects dict
    subjects = {}
    if profile.jamb_subjects:
        subjects["JAMB"] = profile.jamb_subjects
    if profile.ssce_subjects and profile.ssce_exam_type:
        subjects[profile.ssce_exam_type.upper()] = profile.ssce_subjects
    if profile.selected_subjects and not subjects:
        subjects["GENERAL"] = profile.selected_subjects

    available_exams = []
    if profile.jamb_subjects:
        available_exams.append("JAMB")
    if profile.ssce_exam_type:
        available_exams.append(profile.ssce_exam_type.upper())
    if not available_exams and profile.selected_subjects:
        available_exams = ["GENERAL"]

    return {
        "student_id": str(profile.user_id),
        "student_email": student.email,
        "student_name": student.full_name or "Student",
        "has_profile": True,
        "is_locked": profile.cbt_subjects_locked,
        "is_active": bool(profile.jamb_subjects or profile.ssce_subjects or profile.selected_subjects),
        "subjects": subjects,
        "available_exams": available_exams,
        "education_level": profile.education_level,
        "exam_type": profile.exam_type.value if profile.exam_type else None,
    }


# ── List Exams (public) ───────────────────────────────────────────────────────

@router.get("/exams", response_model=List[ExamSummary])
async def list_exams(
    exam_type: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    paper_kind: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List all published exams. No auth required. Filterable by exam_type, subject, paper_kind."""
    q = select(CBTExam).where(CBTExam.is_published == True)  # noqa: E712
    if exam_type:
        q = q.where(CBTExam.exam_type == exam_type.upper())
    if subject:
        q = q.where(CBTExam.subject.ilike(f"%{subject}%"))
    result = await db.execute(q.order_by(CBTExam.exam_type, CBTExam.subject))
    exams = result.scalars().all()
    if paper_kind:
        wanted = normalize_paper_kind(paper_kind)
        exams = [
            e for e in exams
            if normalize_paper_kind(getattr(e, "paper_kind", None)) == wanted
        ]
    return [_exam_summary(e) for e in exams]


@router.get("/exams/for-me")
async def exams_for_student(
    paper_kind: Optional[str] = Query("cbt_practice"),
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Practice + school exams filtered by the student's exam boards and subjects.
    Returns jamb_exams and ssce_exams so the app can show JAMB | WAEC/NECO tabs.
    """
    try:
        return await _exams_for_student_impl(paper_kind, current_user, db)
    except HTTPException:
        raise
    except Exception:
        import logging
        logging.getLogger(__name__).exception("exams/for-me failed")
        return {
            "exam_type": None,
            "boards": [],
            "jamb_subjects": [],
            "ssce_subjects": [],
            "ssce_exam_type": None,
            "selected_subjects": [],
            "education_level": None,
            "practice_exams": [],
            "jamb_exams": [],
            "ssce_exams": [],
            "school_exams": [],
            "setup_required": True,
            "message": "Could not load exams right now. Complete Profile setup, then refresh.",
        }


async def _exams_for_student_impl(
    paper_kind: Optional[str],
    current_user: dict,
    db: AsyncSession,
):
    """
    Practice + school exams filtered by the student's exam boards and subjects.
    Returns jamb_exams and ssce_exams so the app can show JAMB | WAEC/NECO tabs.
    """
    from app.routers.students import _profile_boards, _is_jss_level

    profile_res = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user["sub"])
    )
    profile = profile_res.scalar_one_or_none()
    if not profile or not profile.exam_type:
        # Prefer an empty catalog over a hard error so the website still loads.
        return {
            "exam_type": None,
            "boards": [],
            "jamb_subjects": [],
            "ssce_subjects": [],
            "ssce_exam_type": None,
            "selected_subjects": [],
            "education_level": getattr(profile, "education_level", None) if profile else None,
            "practice_exams": [],
            "jamb_exams": [],
            "ssce_exams": [],
            "school_exams": [],
            "setup_required": True,
            "message": "Complete exam setup to personalize practice papers.",
        }

    boards = _profile_boards(profile)
    jamb_subjects = boards["jamb_subjects"]
    ssce_subjects = boards["ssce_subjects"]
    ssce_board = boards["ssce_exam_type"]
    level = (profile.education_level or "").upper().replace(" ", "")
    selected = list(profile.selected_subjects or [])

    if not jamb_subjects and not ssce_subjects and not selected:
        return {
            "exam_type": profile.exam_type.value if profile.exam_type else None,
            "boards": [],
            "jamb_subjects": [],
            "ssce_subjects": [],
            "ssce_exam_type": ssce_board,
            "selected_subjects": [],
            "education_level": profile.education_level,
            "practice_exams": [],
            "jamb_exams": [],
            "ssce_exams": [],
            "school_exams": [],
            "setup_required": True,
            "message": "Complete exam setup to personalize practice papers.",
        }

    is_junior = (ssce_board == "JUNIOR_WAEC") or (
        profile.exam_type and profile.exam_type.value == "JUNIOR_WAEC"
    ) or _is_jss_level(profile.education_level or "")
    is_common_entrance = ssce_board == "COMMON_ENTRANCE"
    exam_type_val = (
        profile.exam_type.value if profile.exam_type and hasattr(profile.exam_type, "value") else str(profile.exam_type or "")
    ).upper()
    wants_jamb = bool(jamb_subjects) or "JAMB" in exam_type_val or "UTME" in exam_type_val
    wants_ssce = bool(ssce_subjects) or any(
        x in exam_type_val for x in ("WAEC", "NECO", "JUNIOR", "COMMON", "SSCE")
    )
    # Prefer board-specific subjects; fall back to overall selected subjects so
    # published papers still appear when jamb_subjects/ssce_subjects were never set.
    jamb_pool = list(jamb_subjects or []) or (selected if wants_jamb else [])
    ssce_pool = list(ssce_subjects or []) or (selected if wants_ssce else [])
    now = datetime.utcnow()

    wanted_kind = normalize_paper_kind(paper_kind)
    result = await db.execute(
        select(CBTExam).where(CBTExam.is_published == True)  # noqa: E712
    )
    all_exams = [
        exam for exam in result.scalars().all()
        if normalize_paper_kind(getattr(exam, "paper_kind", None)) == wanted_kind
    ]

    def _is_jamb(et: str) -> bool:
        t = (et or "").upper().replace(" ", "_")
        return "JAMB" in t or "UTME" in t

    def _is_ssce(et: str) -> bool:
        t = (et or "").upper().replace(" ", "_")
        if is_common_entrance:
            return t in ("COMMON_ENTRANCE", "CE", "COMMONENTRANCE") or "COMMON" in t
        if is_junior:
            return t in ("JUNIOR_WAEC", "BECE", "JSSCE", "JUNIORWAEC") or "JUNIOR" in t
        if ssce_board == "NECO":
            return "NECO" in t
        if ssce_board == "WAEC":
            return t in ("WAEC", "WASSCE") and "JUNIOR" not in t
        # Both / unknown SSCE — show WAEC and NECO packs
        return (("WAEC" in t or "WASSCE" in t or "NECO" in t) and "JUNIOR" not in t)

    def _is_class_level(et: str) -> bool:
        t = (et or "").upper().replace(" ", "").replace("_", "")
        return t in {"JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"}

    def _matches_student_class(et: str) -> bool:
        if not level:
            return False
        t = (et or "").upper().replace(" ", "").replace("_", "")
        return t == level.replace(" ", "").replace("_", "")

    jamb_practice = []
    ssce_practice = []
    class_practice = []
    school = []
    for e in all_exams:
        if e.is_school_exam:
            subjects = list({*jamb_pool, *ssce_pool, *selected})
            if subjects and not subject_matches(e.subject, subjects):
                continue
            if _school_exam_is_open(e, now) or (e.scheduled_start and e.scheduled_start > now):
                school.append(_exam_summary(e))
            continue

        if _is_class_level(e.exam_type):
            if _matches_student_class(e.exam_type):
                class_practice.append(_exam_summary(e))
            continue

        if wants_jamb and _is_jamb(e.exam_type) and subject_matches(e.subject, jamb_pool):
            jamb_practice.append(_exam_summary(e))
        if wants_ssce and _is_ssce(e.exam_type) and subject_matches(e.subject, ssce_pool):
            ssce_practice.append(_exam_summary(e))

    # Past-question packs: if board pools were empty filters, still surface all
    # published papers of that kind so the Past Questions tab is not blank.
    if wanted_kind == "past_questions" and not jamb_practice and not ssce_practice and not class_practice:
        for e in all_exams:
            if e.is_school_exam:
                continue
            if _is_jamb(e.exam_type):
                jamb_practice.append(_exam_summary(e))
            elif _is_ssce(e.exam_type) or _is_class_level(e.exam_type):
                ssce_practice.append(_exam_summary(e))
            else:
                class_practice.append(_exam_summary(e))

    # Deduplicate practice_exams list while keeping board buckets
    seen = set()
    practice = []
    for item in [*jamb_practice, *ssce_practice, *class_practice]:
        if item.id in seen:
            continue
        seen.add(item.id)
        practice.append(item)

    active_boards = []
    prefer_ssce = ssce_board in {"WAEC", "NECO", "JUNIOR_WAEC", "COMMON_ENTRANCE"}
    if wants_jamb and not prefer_ssce and (jamb_practice or jamb_subjects):
        active_boards.append("JAMB")
    if wants_ssce or ssce_practice:
        if is_common_entrance:
            active_boards.append("COMMON_ENTRANCE")
        elif is_junior:
            active_boards.append("JUNIOR_WAEC")
        else:
            active_boards.append("WAEC_NECO")

    return {
        "exam_type": profile.exam_type.value if profile.exam_type else None,
        "boards": active_boards,
        "jamb_subjects": jamb_subjects or jamb_pool,
        "ssce_subjects": ssce_subjects or ssce_pool,
        "ssce_exam_type": ssce_board,
        "selected_subjects": selected,
        "education_level": profile.education_level,
        "practice_exams": practice,
        "jamb_exams": jamb_practice,
        "ssce_exams": ssce_practice,
        "school_exams": school,
    }


# ── Get Single Exam Info (public) ─────────────────────────────────────────────

@router.get("/exams/{exam_id}", response_model=ExamSummary)
async def get_exam(exam_id: str, db: AsyncSession = Depends(get_db)):
    """Get exam metadata. No auth required."""
    result = await db.execute(
        select(CBTExam).where(CBTExam.id == exam_id, CBTExam.is_published == True)  # noqa: E712
    )
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    return _exam_summary(exam)


# ── Download Exam for Offline Use (auth required) ─────────────────────────────

@router.get("/exams/{exam_id}/download")
async def download_exam(
    exam_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the full exam with questions (NO correct answers).
    Used by the web/mobile client to cache exam for offline CBT.
    """
    result = await db.execute(
        select(CBTExam).where(CBTExam.id == exam_id, CBTExam.is_published == True)  # noqa: E712
    )
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    # Internal (school) exams are downloadable for offline use. We never ship the
    # correct answers for them — grading happens server-side on submit — so
    # offline downloads stay tamper-safe.
    await _require_paid_practice_access(db, current_user, exam)

    q_result = await db.execute(
        select(CBTQuestion).where(CBTQuestion.exam_id == exam.id)
    )
    questions = q_result.scalars().all()

    question_list = []
    for q in questions:
        item = {
            "id": str(q.id),
            "question_text": q.question_text,
            "option_a": q.option_a,
            "option_b": q.option_b,
            "option_c": q.option_c,
            "option_d": q.option_d,
            "topic": q.topic,
            "image_url": q.image_url,
        }
        # Practice exams include answers in offline pack for local scoring
        if not exam.is_school_exam:
            item["correct_option"] = q.correct_option
            item["explanation"] = q.explanation
        question_list.append(item)

    return {
        "id": str(exam.id),
        "title": exam.title,
        "subject": exam.subject,
        "year": exam.year,
        "exam_type": exam.exam_type,
        "duration_minutes": exam.duration_minutes,
        "total_questions": exam.total_questions,
        "is_school_exam": exam.is_school_exam,
        "notes_url": exam.notes_url,
        "notes_title": exam.notes_title,
        "questions": question_list,
    }


# ── Start Session ─────────────────────────────────────────────────────────────

@router.post("/sessions/{exam_id}/start", response_model=SessionResponse)
async def start_session(
    exam_id: str,
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CBTExam).where(CBTExam.id == exam_id, CBTExam.is_published == True)  # noqa: E712
    )
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    await _require_paid_practice_access(db, current_user, exam)

    role = (current_user.get("role") or "").lower()
    exam_type = (exam.exam_type or "").upper()
    # Kid app: Primary 6 Common Entrance CBT only (content added from admin).
    if role == "kind" and exam_type not in ("COMMON_ENTRANCE", "CE"):
        raise HTTPException(
            status_code=403,
            detail="Kid learners can only take Common Entrance CBT exams",
        )
    if role == "kind" and exam.is_school_exam:
        raise HTTPException(status_code=403, detail="School exams are not available in Kids mode")

    now = datetime.utcnow()
    if exam.is_school_exam:
        if not _school_exam_is_open(exam, now):
            raise HTTPException(status_code=403, detail="This school exam is not open right now")
        # School exams: lock AI and navigation; camera only if teacher enabled it
        if not exam.ai_locked:
            exam.ai_locked = True
        if not exam.block_minimize:
            exam.block_minimize = True

    session = CBTSession(student_id=current_user["sub"], exam_id=exam.id)
    db.add(session)
    await db.flush()

    return SessionResponse(
        session_id=str(session.id),
        exam_id=str(exam.id),
        started_at=session.started_at,
        duration_minutes=exam.duration_minutes,
        total_questions=exam.total_questions,
        is_school_exam=exam.is_school_exam,
        ai_locked=exam.ai_locked,
        camera_required=exam.camera_required,
        block_minimize=exam.block_minimize,
    )


# ── Submit Session ────────────────────────────────────────────────────────────

@router.post("/sessions/submit", response_model=ResultResponse)
async def submit_session(
    payload: SubmitAnswersRequest,
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CBTSession).where(
            CBTSession.id == payload.session_id,
            CBTSession.student_id == current_user["sub"],
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.submitted_at:
        raise HTTPException(status_code=400, detail="Already submitted")

    q_result = await db.execute(
        select(CBTQuestion).where(CBTQuestion.exam_id == session.exam_id)
    )
    questions = q_result.scalars().all()

    correct = 0
    wrong = 0
    weak_topics: set = set()

    for q in questions:
        chosen = payload.answers.get(str(q.id))
        if chosen and chosen.upper() == q.correct_option.upper():
            correct += 1
        else:
            wrong += 1
            if q.topic:
                weak_topics.add(q.topic)

    total = correct + wrong
    percentage = round((correct / total) * 100, 2) if total > 0 else 0.0

    session.answers = payload.answers
    session.score = correct
    session.percentage = percentage
    session.total_correct = correct
    session.total_wrong = wrong
    session.weak_topics = list(weak_topics)
    session.submitted_at = datetime.utcnow()
    session.is_auto_submitted = payload.is_auto_submit
    await db.flush()

    return ResultResponse(
        score=correct,
        percentage=percentage,
        total_correct=correct,
        total_wrong=wrong,
        weak_topics=list(weak_topics),
    )


# ── Get Session Result ────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/result", response_model=ResultResponse)
async def get_session_result(
    session_id: str,
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CBTSession).where(
            CBTSession.id == session_id,
            CBTSession.student_id == current_user["sub"],
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.submitted_at:
        raise HTTPException(status_code=400, detail="Session not yet submitted")

    return ResultResponse(
        score=session.score or 0,
        percentage=session.percentage or 0.0,
        total_correct=session.total_correct or 0,
        total_wrong=session.total_wrong or 0,
        weak_topics=session.weak_topics or [],
    )


# ── Get Session Review (with correct answers + explanations) ──────────────────

@router.get("/sessions/{session_id}/review")
async def get_session_review(
    session_id: str,
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    """Returns all questions with correct answers, student answers, and explanations."""
    res = await db.execute(
        select(CBTSession).where(
            CBTSession.id == session_id,
            CBTSession.student_id == current_user["sub"],
        )
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.submitted_at:
        raise HTTPException(status_code=400, detail="Session not yet submitted")

    q_result = await db.execute(
        select(CBTQuestion).where(CBTQuestion.exam_id == session.exam_id)
    )
    questions = q_result.scalars().all()
    submitted_answers = session.answers or {}

    return {
        "session_id": session_id,
        "percentage": session.percentage,
        "total_correct": session.total_correct,
        "total_wrong": session.total_wrong,
        "questions": [
            {
                "id": str(q.id),
                "question_text": q.question_text,
                "option_a": q.option_a,
                "option_b": q.option_b,
                "option_c": q.option_c,
                "option_d": q.option_d,
                "correct_option": q.correct_option,
                "explanation": q.explanation,
                "topic": q.topic,
                "student_answer": submitted_answers.get(str(q.id)),
                "is_correct": (submitted_answers.get(str(q.id)) or "").upper() == q.correct_option.upper(),
            }
            for q in questions
        ],
    }


# ── My Sessions ───────────────────────────────────────────────────────────────

@router.get("/my-sessions")
async def my_sessions(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student's own submitted exam sessions."""
    result = await db.execute(
        select(CBTSession, CBTExam)
        .join(CBTExam, CBTExam.id == CBTSession.exam_id)
        .where(
            CBTSession.student_id == current_user["sub"],
            CBTSession.submitted_at.isnot(None),
        )
        .order_by(CBTSession.submitted_at.desc())
    )
    rows = result.all()
    return [
        {
            "session_id": str(s.id),
            "exam_id": str(e.id),
            "exam_title": e.title,
            "subject": e.subject,
            "exam_type": e.exam_type,
            "percentage": s.percentage,
            "total_correct": s.total_correct,
            "total_wrong": s.total_wrong,
            "submitted_at": s.submitted_at,
            "weak_topics": s.weak_topics or [],
        }
        for s, e in rows
    ]


# ── AI Lock Check ─────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/ai-status")
async def check_ai_lock(
    session_id: str,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CBTSession, CBTExam)
        .join(CBTExam, CBTExam.id == CBTSession.exam_id)
        .where(
            CBTSession.id == session_id,
            CBTSession.student_id == current_user["sub"],
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    session, exam = row
    return {
        "session_id": session_id,
        "ai_locked": exam.ai_locked,
        "message": "AI is disabled during this exam." if exam.ai_locked else "AI is available.",
    }


# ── Proctoring ────────────────────────────────────────────────────────────────

class ProctorEventRequest(BaseModel):
    session_id: str
    event_type: str
    snapshot_url: Optional[str] = None
    metadata: Optional[dict] = None


@router.post("/proctor/event")
async def log_proctor_event(
    payload: ProctorEventRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    VALID_EVENTS = {"minimize_attempt", "screenshot_attempt", "tab_switch", "camera_lost", "camera_snapshot"}
    if payload.event_type not in VALID_EVENTS:
        raise HTTPException(status_code=400, detail=f"Invalid event_type. Use: {VALID_EVENTS}")
    log = ExamProctorLog(
        session_id=payload.session_id,
        student_id=current_user["sub"],
        event_type=payload.event_type,
        snapshot_url=payload.snapshot_url,
        extra_data=payload.metadata or {},
    )
    db.add(log)
    await db.flush()
    return {"logged": True, "event": payload.event_type}


@router.get("/proctor/sessions/{session_id}/logs")
async def get_proctor_logs(
    session_id: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ExamProctorLog)
        .where(ExamProctorLog.session_id == session_id)
        .order_by(ExamProctorLog.created_at.asc())
    )
    logs = result.scalars().all()
    return [
        {"id": str(l.id), "student_id": str(l.student_id), "event_type": l.event_type,
         "snapshot_url": l.snapshot_url, "extra_data": l.extra_data, "at": l.created_at}
        for l in logs
    ]


@router.get("/proctor/exam/{exam_id}/active-students")
async def get_active_students(
    exam_id: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CBTSession).where(
            CBTSession.exam_id == exam_id,
            CBTSession.submitted_at == None,  # noqa: E711
        )
    )
    sessions = result.scalars().all()
    return [{"session_id": str(s.id), "student_id": str(s.student_id), "started_at": s.started_at} for s in sessions]


# ── Teacher: Schedule School Exam ─────────────────────────────────────────────

@router.post("/school-exams/import-preview")
async def teacher_preview_exam_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_teacher),
):
    """Parse PDF/DOCX/JSON questions for teacher exam publish (does not save)."""
    from app.services.cbt_pdf_parser import (
        LOW_CONFIDENCE_THRESHOLD,
        PDFParseError,
        parse_docx_questions,
        parse_pdf_questions,
    )
    from app.services.cbt_import import parse_cbt_file

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 15MB.")

    name = (file.filename or "").lower()
    is_pdf = name.endswith(".pdf") or content[:5] == b"%PDF-"
    is_docx = name.endswith(".docx")

    if is_pdf or is_docx:
        try:
            result = parse_docx_questions(content) if is_docx else parse_pdf_questions(content)
        except PDFParseError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        questions = result.get("questions") or []
        if not questions:
            raise HTTPException(status_code=400, detail="No questions found in that file.")
        low_conf = sum(
            1 for q in questions if float(q.get("confidence") or 0) < LOW_CONFIDENCE_THRESHOLD
        )
        return {
            "source": "docx" if is_docx else "pdf",
            "questions": questions,
            "total_questions": len(questions),
            "answer_key_found": result.get("answer_key_found"),
            "warnings": result.get("warnings") or [],
            "low_confidence_count": low_conf,
        }

    try:
        exams = parse_cbt_file(file.filename or "upload.json", content, {"title": "Preview", "subject": "Preview", "year": 2000})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read file: {exc}") from exc
    qs = []
    for ex in exams or []:
        for q in ex.get("questions") or []:
            qs.append(q)
    if not qs:
        raise HTTPException(status_code=400, detail="No questions found in that file.")
    return {
        "source": "json",
        "questions": qs,
        "total_questions": len(qs),
        "answer_key_found": True,
        "warnings": [],
        "low_confidence_count": 0,
    }


@router.post("/school-exams", status_code=201)
async def teacher_create_school_exam(
    payload: CreateSchoolExamRequest,
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Teacher schedules a proctored school exam with camera monitoring."""
    if not payload.questions:
        raise HTTPException(status_code=400, detail="At least one question required")
    if payload.scheduled_end <= payload.scheduled_start:
        raise HTTPException(status_code=400, detail="scheduled_end must be after scheduled_start")

    exam = CBTExam(
        title=payload.title,
        subject=payload.subject,
        exam_type="SCHOOL",
        duration_minutes=payload.duration_minutes,
        total_questions=len(payload.questions),
        created_by=current_user["sub"],
        is_published=True,
        is_school_exam=True,
        ai_locked=payload.ai_locked,
        camera_required=payload.camera_required,
        block_minimize=payload.block_minimize,
        scheduled_start=payload.scheduled_start,
        scheduled_end=payload.scheduled_end,
    )
    db.add(exam)
    await db.flush()

    for q in payload.questions:
        if q.correct_option.upper() not in ("A", "B", "C", "D"):
            raise HTTPException(status_code=400, detail="correct_option must be A/B/C/D")
        db.add(CBTQuestion(
            exam_id=exam.id,
            question_text=q.question_text,
            option_a=q.option_a, option_b=q.option_b,
            option_c=q.option_c, option_d=q.option_d,
            correct_option=q.correct_option.upper(),
            explanation=q.explanation,
            topic=q.topic,
        ))

    await db.flush()

    try:
        from app.services.notification_service import send_subject_notification

        await send_subject_notification(
            db=db,
            subject=payload.subject,
            title="New Scholaxia Test",
            body=f"{payload.title} ({payload.subject}) — open Exams to take it.",
            notification_type="cbt_reminder",
            data={
                "type": "cbt_exam",
                "exam_id": str(exam.id),
                "subject": payload.subject,
            },
        )
    except Exception:
        pass

    return _exam_summary(exam)


@router.get("/school-exams/mine")
async def teacher_list_school_exams(
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Exams created by this teacher."""
    result = await db.execute(
        select(CBTExam)
        .where(CBTExam.created_by == current_user["sub"], CBTExam.is_school_exam == True)  # noqa: E712
        .order_by(CBTExam.created_at.desc())
    )
    return [_exam_summary(e) for e in result.scalars().all()]


@router.get("/school-exams/{exam_id}/results")
async def teacher_school_exam_results(
    exam_id: str,
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Student names and scores for a teacher's exam."""
    exam_res = await db.execute(
        select(CBTExam).where(
            CBTExam.id == exam_id,
            CBTExam.created_by == current_user["sub"],
            CBTExam.is_school_exam == True,  # noqa: E712
        )
    )
    exam = exam_res.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    rows = await db.execute(
        select(CBTSession, User)
        .join(User, User.id == CBTSession.student_id)
        .where(
            CBTSession.exam_id == exam_id,
            CBTSession.submitted_at != None,  # noqa: E711
        )
        .order_by(CBTSession.submitted_at.desc())
    )
    out = []
    for session, user in rows.all():
        out.append({
            "session_id": str(session.id),
            "student_id": str(session.student_id),
            "student_name": user.full_name or user.email or "Student",
            "score": session.score or 0,
            "percentage": session.percentage or 0,
            "total_correct": session.total_correct or 0,
            "total_wrong": session.total_wrong or 0,
            "submitted_at": session.submitted_at.isoformat() if session.submitted_at else None,
        })
    return {
        "exam": _exam_summary(exam),
        "results": out,
        "submitted_count": len(out),
    }


# ── Internal Exams (downloadable, offline-capable, routed to subject teachers) ─

class InternalSubmitRequest(BaseModel):
    answers: dict  # {question_id: "A"|"B"|"C"|"D"}
    is_auto_submit: bool = False
    # Offline-security telemetry (site + desktop): when the exam was started
    # and submitted on the device, and whether this arrives from the offline
    # submission queue on reconnect. The server records and validates all of it.
    started_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    offline_sync: bool = False
    client: Optional[str] = None


async def _notify_subject_teachers(db: AsyncSession, exam: CBTExam, student_name: str) -> None:
    """Notify every teacher who teaches this exam's subject (plus its creator)."""
    try:
        from app.models.notification import Notification, NotificationType
        from app.models.user import TeacherProfile

        recipient_ids: set = set()
        if exam.created_by:
            recipient_ids.add(str(exam.created_by))

        tp_res = await db.execute(select(TeacherProfile))
        for tp in tp_res.scalars().all():
            if subject_matches(exam.subject, tp.subjects or []):
                recipient_ids.add(str(tp.user_id))

        for uid in recipient_ids:
            db.add(Notification(
                user_id=uid,
                type=NotificationType.cbt_reminder,
                title="New exam submission",
                body=f"{student_name} submitted «{exam.title}» ({exam.subject}). Open Grading to review.",
                data=json.dumps({"exam_id": str(exam.id), "subject": exam.subject}),
            ))
    except Exception:
        pass


@router.get("/internal-exams/for-me")
async def internal_exams_for_me(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Internal (school) exams the student can download and take offline."""
    profile_res = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user["sub"])
    )
    profile = profile_res.scalar_one_or_none()
    subjects = (profile.selected_subjects or []) if profile else []

    result = await db.execute(
        select(CBTExam).where(
            CBTExam.is_published == True,  # noqa: E712
            CBTExam.is_school_exam == True,  # noqa: E712
        ).order_by(CBTExam.created_at.desc())
    )
    exams = result.scalars().all()

    taken_res = await db.execute(
        select(CBTSession.exam_id).where(
            CBTSession.student_id == current_user["sub"],
            CBTSession.submitted_at != None,  # noqa: E711
        )
    )
    taken = {str(x) for x in taken_res.scalars().all()}

    out = []
    teacher_ids = {e.created_by for e in exams if e.created_by}
    teachers = {}
    if teacher_ids:
        t_res = await db.execute(select(User).where(User.id.in_(list(teacher_ids))))
        teachers = {str(u.id): u for u in t_res.scalars().all()}

    uid = str(current_user["sub"])
    for e in exams:
        assigned = e.assigned_student_ids or []
        if assigned:
            # Only listed students get this exam.
            if uid not in {str(x) for x in assigned}:
                continue
        elif subjects and not subject_matches(e.subject, subjects):
            # No explicit student list → match by profile subjects.
            continue

        teacher = teachers.get(str(e.created_by)) if e.created_by else None
        score_pct = None
        if str(e.id) in taken:
            sess_res = await db.execute(
                select(CBTSession).where(
                    CBTSession.exam_id == e.id,
                    CBTSession.student_id == current_user["sub"],
                    CBTSession.submitted_at != None,  # noqa: E711
                ).order_by(CBTSession.submitted_at.desc()).limit(1)
            )
            sess = sess_res.scalar_one_or_none()
            if sess is not None and sess.percentage is not None:
                score_pct = float(sess.percentage)
        out.append({
            "id": str(e.id),
            "title": e.title,
            "subject": e.subject,
            "teacher_id": str(e.created_by) if e.created_by else None,
            "teacher_name": (teacher.full_name or teacher.email) if teacher else "Teacher",
            "duration_minutes": e.duration_minutes,
            "total_questions": e.total_questions,
            "notes_url": e.notes_url,
            "notes_title": e.notes_title,
            "already_taken": str(e.id) in taken,
            "my_score_percent": score_pct,
        })
    return {"exams": out}


@router.post("/internal-exams/{exam_id}/submit", response_model=ResultResponse)
async def submit_internal_exam(
    exam_id: str,
    payload: InternalSubmitRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """One-shot submit for an offline-taken internal exam. Scored server-side."""
    exam_res = await db.execute(
        select(CBTExam).where(
            CBTExam.id == exam_id,
            CBTExam.is_published == True,  # noqa: E712
            CBTExam.is_school_exam == True,  # noqa: E712
        )
    )
    exam = exam_res.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    existing_res = await db.execute(
        select(CBTSession).where(
            CBTSession.exam_id == exam_id,
            CBTSession.student_id == current_user["sub"],
            CBTSession.submitted_at != None,  # noqa: E711
        )
    )
    existing = existing_res.scalars().first()
    if existing is not None:
        # Owner spec — Prevent submitting the same attempt multiple times +
        # Handle duplicate submissions safely: the first submission wins and
        # every retry (including a replayed offline-sync queue) gets the same
        # idempotent response instead of a 400 that would loop the queue.
        from app.models.external_exam import OfflineSyncAudit

        db.add(
            OfflineSyncAudit(
                exam_id=exam.id,
                school_id=exam.school_id,
                student_user_id=current_user["sub"],
                event="duplicate_ignored",
                channel="offline_sync" if payload.offline_sync else "online",
                offline_started_at=payload.started_at,
                offline_submitted_at=payload.submitted_at,
                detail={
                    "client": payload.client,
                    "session_id": str(existing.id),
                    "first_submitted_at": existing.submitted_at.isoformat() if existing.submitted_at else None,
                },
            )
        )
        await db.flush()
        return ResultResponse(
            score=0,
            percentage=0,
            total_correct=0,
            total_wrong=0,
            weak_topics=[],
            result_status="hidden",
            already_submitted=True,
            submitted_at=existing.submitted_at,
            message=(
                "This exam was already submitted. "
                + (
                    "Your result will be available when published by your school."
                    if getattr(exam, "is_school_exam", False)
                    else "Your official score stands — no new submission was created."
                )
            ),
        )

    q_res = await db.execute(select(CBTQuestion).where(CBTQuestion.exam_id == exam.id))
    questions = q_res.scalars().all()

    correct = 0
    wrong = 0
    weak_topics: set = set()
    for q in questions:
        chosen = payload.answers.get(str(q.id))
        if chosen and chosen.upper() == q.correct_option.upper():
            correct += 1
        else:
            wrong += 1
            if q.topic:
                weak_topics.add(q.topic)

    total = correct + wrong
    percentage = round((correct / total) * 100, 2) if total > 0 else 0.0

    # Record exam start / submission time: the server keeps its own receipt
    # time (authoritative) and stores the device-reported times in the audit
    # trail so the school can cross-check them later.
    def _sane_device_time(value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        try:
            if value.tzinfo is not None:
                value = value.astimezone(tz=None).replace(tzinfo=None)
        except Exception:
            return None
        if value.year < 2020 or value > datetime.utcnow() + timedelta(days=366):
            return None
        return value

    device_started = _sane_device_time(payload.started_at)
    device_submitted = _sane_device_time(payload.submitted_at)

    session = CBTSession(
        student_id=current_user["sub"],
        exam_id=exam.id,
        started_at=device_started or datetime.utcnow(),
        answers=payload.answers,
        score=correct,
        percentage=percentage,
        total_correct=correct,
        total_wrong=wrong,
        weak_topics=list(weak_topics),
        submitted_at=datetime.utcnow(),
        is_auto_submitted=payload.is_auto_submit,
    )
    db.add(session)
    await db.flush()

    # Owner spec — Keep an audit trail of synchronization: one row per
    # offline-taken school-exam submission the server receives.
    from app.models.external_exam import OfflineSyncAudit

    db.add(
        OfflineSyncAudit(
            exam_id=exam.id,
            school_id=exam.school_id,
            student_user_id=current_user["sub"],
            event="received",
            channel="offline_sync" if payload.offline_sync else "online",
            offline_started_at=device_started,
            offline_submitted_at=device_submitted,
            detail={
                "client": payload.client,
                "session_id": str(session.id),
                "server_received_at": session.submitted_at.isoformat() if session.submitted_at else None,
                "device_submitted_at": device_submitted.isoformat() if device_submitted else None,
                "started_at": session.started_at.isoformat() if session.started_at else None,
                "answers_count": len(payload.answers or {}),
            },
        )
    )
    await db.flush()

    student_res = await db.execute(select(User).where(User.id == current_user["sub"]))
    student = student_res.scalar_one_or_none()
    student_name = (student.full_name or student.email or "A student") if student else "A student"
    await _notify_subject_teachers(db, exam, student_name)

    # Owner spec §22/§25: school-exam scores stay hidden from the student
    # until the school publishes. Score is still stored server-side.
    if getattr(exam, "is_school_exam", False):
        return ResultResponse(
            score=0,
            percentage=0,
            total_correct=0,
            total_wrong=0,
            weak_topics=[],
            result_status="hidden",
            message="Exam submitted successfully. Your result will be available when published by your school.",
        )

    return ResultResponse(
        score=correct,
        percentage=percentage,
        total_correct=correct,
        total_wrong=wrong,
        weak_topics=list(weak_topics),
    )


@router.get("/internal-exams/submissions")
async def teacher_internal_submissions(
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """All internal-exam submissions routed to this teacher (their subjects or
    exams they created)."""
    from app.models.user import TeacherProfile

    tp_res = await db.execute(
        select(TeacherProfile).where(TeacherProfile.user_id == current_user["sub"])
    )
    tp = tp_res.scalar_one_or_none()
    subjects = (tp.subjects or []) if tp else []

    rows = await db.execute(
        select(CBTSession, User, CBTExam)
        .join(User, User.id == CBTSession.student_id)
        .join(CBTExam, CBTExam.id == CBTSession.exam_id)
        .where(
            CBTExam.is_school_exam == True,  # noqa: E712
            CBTSession.submitted_at != None,  # noqa: E711
        )
        .order_by(CBTSession.submitted_at.desc())
    )
    out = []
    for session, user, exam in rows.all():
        mine = str(exam.created_by) == current_user["sub"]
        if not mine and not subject_matches(exam.subject, subjects):
            continue
        out.append({
            "session_id": str(session.id),
            "student_id": str(session.student_id),
            "student_name": user.full_name or user.email or "Student",
            "exam_id": str(exam.id),
            "exam_title": exam.title,
            "subject": exam.subject,
            "score": session.score or 0,
            "percentage": session.percentage or 0,
            "total_correct": session.total_correct or 0,
            "total_wrong": session.total_wrong or 0,
            "total_questions": exam.total_questions,
            "submitted_at": session.submitted_at.isoformat() if session.submitted_at else None,
        })
    return {"submissions": out, "count": len(out)}


# ── External school exam aliases (same as internal-exams; clearer product name) ──

@router.get("/external-exams/for-me")
async def external_exams_for_me(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """External / offline school exams uploaded by admin (alias of internal-exams/for-me)."""
    return await internal_exams_for_me(current_user=current_user, db=db)


@router.post("/external-exams/{exam_id}/submit", response_model=ResultResponse)
async def submit_external_exam(
    exam_id: str,
    payload: InternalSubmitRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Submit an offline external school exam (alias of internal-exams submit)."""
    return await submit_internal_exam(
        exam_id=exam_id, payload=payload, current_user=current_user, db=db
    )


@router.get("/external-exams/submissions")
async def external_exam_submissions(
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Teacher grading inbox for external school exams."""
    return await teacher_internal_submissions(current_user=current_user, db=db)