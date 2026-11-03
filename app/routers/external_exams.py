import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.datetime_utils import naive_utc_now
from app.core.deps import require_school_staff, require_student, get_current_user
from app.models.user import StudentProfile, User, UserRole
from app.models.external_exam import (
    ExternalExam,
    ExternalExamAnswer,
    ExternalExamAttempt,
    ExternalExamQuestion,
    OfflineSyncAudit,
)
from app.models.school_campus import SchoolCampus
from app.models.school_office import SchoolExamCandidate
from app.routers.school_office import _campus
from app.services.cbt_pdf_parser import PDFParseError, parse_docx_questions, parse_pdf_questions

staff_router = APIRouter(prefix="/admin/school-office/external-exams", tags=["External exams"])
public_router = APIRouter(prefix="/external-exams", tags=["External exam hall"])

STATUSES = (
    "draft",
    "extracted",
    "under_review",
    "scheduled",
    "active",
    "closed",
    "result_finalized",
)


def _code(prefix: str) -> str:
    return f"{prefix}-{datetime.utcnow().strftime('%Y')}-{secrets.token_hex(4).upper()}"


def _exam_public(exam: ExternalExam, school_name: str | None = None) -> dict:
    return {
        "id": str(exam.id),
        "school_id": str(exam.school_id),
        "school_name": school_name,
        "title": exam.title,
        "subject": exam.subject,
        "class_name": exam.class_name,
        "allowed_classes": list(exam.allowed_classes or [exam.class_name]),
        "instructions": exam.instructions,
        "duration_minutes": exam.duration_minutes,
        "total_marks": exam.total_marks,
        "pass_mark": exam.pass_mark,
        "total_questions": exam.total_questions,
        "status": exam.status,
        "is_published": exam.is_published,
        "scheduled_start": exam.scheduled_start.isoformat() if exam.scheduled_start else None,
        "scheduled_end": exam.scheduled_end.isoformat() if exam.scheduled_end else None,
        "source_filename": exam.source_filename,
    }


def _grade(pct: float, pass_mark: float) -> tuple[str, bool]:
    if pct >= 70:
        letter = "A"
    elif pct >= 60:
        letter = "B"
    elif pct >= 50:
        letter = "C"
    elif pct >= 40:
        letter = "D"
    else:
        letter = "F"
    return letter, pct + 1e-9 >= float(pass_mark)


class CreateExamIn(BaseModel):
    school_id: Optional[str] = None
    title: str
    subject: str
    class_name: str
    extra_classes: list[str] = []
    instructions: Optional[str] = None
    duration_minutes: int = 120
    total_marks: int = 100
    pass_mark: int = 50
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None


class QuestionFix(BaseModel):
    id: str
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_option: str
    marks: Optional[float] = None
    is_approved: bool = True


class ReviewIn(BaseModel):
    questions: list[QuestionFix]


class UpdateExamIn(BaseModel):
    title: Optional[str] = None
    subject: Optional[str] = None
    class_name: Optional[str] = None
    extra_classes: Optional[list[str]] = None
    instructions: Optional[str] = None
    duration_minutes: Optional[int] = None
    total_marks: Optional[int] = None
    pass_mark: Optional[int] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None


async def _staff_exam(db: AsyncSession, exam_id: str, current_user: dict) -> ExternalExam:
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    campus = await _campus(db, current_user, str(exam.school_id))
    if exam.school_id != campus.id and current_user.get("role") == "school_admin":
        raise HTTPException(status_code=403, detail="Not your exam")
    return exam


class IdentifyIn(BaseModel):
    rec_number: Optional[str] = None
    candidate_id: Optional[str] = None
    access_code: str
    exam_id: Optional[str] = None


class StartIn(BaseModel):
    rec_number: Optional[str] = None
    candidate_id: Optional[str] = None
    access_code: str
    exam_id: str
    attempt_code: Optional[str] = None


class SubmitIn(BaseModel):
    rec_number: Optional[str] = None
    candidate_id: Optional[str] = None
    access_code: str
    exam_id: str
    attempt_code: str
    started_at: Optional[datetime] = None
    answers: dict[str, str] = Field(default_factory=dict)


async def _find_candidate(db: AsyncSession, rec: str | None, cand: str | None, access: str) -> SchoolExamCandidate:
    rec = (rec or "").strip().upper()
    cand = (cand or "").strip().upper()
    access = (access or "").strip().upper()
    if not access:
        raise HTTPException(status_code=400, detail="Access code is required")
    q = select(SchoolExamCandidate).where(SchoolExamCandidate.access_code == access)
    if rec:
        q = q.where(SchoolExamCandidate.rec_number == rec)
    elif cand:
        q = q.where(SchoolExamCandidate.candidate_id == cand)
    else:
        raise HTTPException(status_code=400, detail="Enter rec number or candidate ID")
    row = (await db.execute(q)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not found. Check the slip.")
    return row


def _window_ok(exam: ExternalExam) -> bool:
    now = naive_utc_now()
    if exam.scheduled_start and now < exam.scheduled_start:
        return False
    if exam.scheduled_end and now > exam.scheduled_end:
        return False
    return True


@staff_router.get("")
async def list_exams(
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, school_id)
    rows = (
        await db.execute(
            select(ExternalExam)
            .where(ExternalExam.school_id == campus.id)
            .order_by(ExternalExam.created_at.desc())
        )
    ).scalars().all()
    return {"exams": [_exam_public(e, campus.name) for e in rows]}


@staff_router.post("", status_code=201)
async def create_exam(
    payload: CreateExamIn,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, payload.school_id)
    marks = payload.total_marks if payload.total_marks in (50, 100) else 100
    classes = [payload.class_name.strip().upper()] + [
        c.strip().upper() for c in (payload.extra_classes or []) if str(c).strip()
    ]
    if "ALL" in classes:
        classes = ["ALL"]
    exam = ExternalExam(
        school_id=campus.id,
        title=payload.title.strip(),
        subject=payload.subject.strip(),
        class_name=classes[0],
        allowed_classes=list(dict.fromkeys(classes)),
        instructions=(payload.instructions or "").strip() or None,
        duration_minutes=max(15, min(int(payload.duration_minutes or 120), 300)),
        total_marks=marks,
        pass_mark=max(0, min(int(payload.pass_mark or 50), marks)),
        status="draft",
        scheduled_start=payload.scheduled_start,
        scheduled_end=payload.scheduled_end,
        created_by=current_user["sub"],
    )
    db.add(exam)
    await db.flush()
    return _exam_public(exam, campus.name)


@staff_router.patch("/{exam_id}")
async def update_exam(
    exam_id: str,
    payload: UpdateExamIn,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    exam = await _staff_exam(db, exam_id, current_user)
    if payload.title is not None:
        exam.title = payload.title.strip() or exam.title
    if payload.subject is not None:
        exam.subject = payload.subject.strip() or exam.subject
    if payload.instructions is not None:
        exam.instructions = payload.instructions.strip() or None
    if payload.duration_minutes is not None:
        exam.duration_minutes = max(15, min(int(payload.duration_minutes), 300))
    if payload.total_marks is not None and payload.total_marks in (50, 100):
        exam.total_marks = payload.total_marks
    if payload.pass_mark is not None:
        exam.pass_mark = max(0, min(int(payload.pass_mark), exam.total_marks or 100))
    if payload.scheduled_start is not None:
        exam.scheduled_start = payload.scheduled_start
    if payload.scheduled_end is not None:
        exam.scheduled_end = payload.scheduled_end
    if payload.class_name is not None or payload.extra_classes is not None:
        primary = (payload.class_name or exam.class_name or "JSS1").strip().upper()
        extra = payload.extra_classes if payload.extra_classes is not None else []
        classes = [primary] + [c.strip().upper() for c in extra if str(c).strip()]
        if "ALL" in classes:
            classes = ["ALL"]
        exam.class_name = classes[0]
        exam.allowed_classes = list(dict.fromkeys(classes))
    if exam.is_published:
        exam.status = "active" if _window_ok(exam) else "scheduled"
    await db.flush()
    return _exam_public(exam)


@staff_router.post("/{exam_id}/upload")
async def upload_paper(
    exam_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    campus = await _campus(db, current_user, str(exam.school_id))
    if exam.school_id != campus.id and current_user.get("role") == "school_admin":
        raise HTTPException(status_code=403, detail="Not your exam")
    if exam.is_published:
        raise HTTPException(status_code=400, detail="Unpublish the exam before replacing the paper")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    name = (file.filename or "").lower()
    try:
        if name.endswith(".pdf") or content[:5] == b"%PDF-":
            parsed = parse_pdf_questions(content)
        elif name.endswith(".docx"):
            parsed = parse_docx_questions(content)
        elif name.endswith(".doc"):
            raise HTTPException(
                status_code=400,
                detail="Old .doc files must be saved as .docx in Word, then uploaded.",
            )
        else:
            raise HTTPException(status_code=400, detail="Upload a PDF or DOCX file.")
    except PDFParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    old = (await db.execute(select(ExternalExamQuestion).where(ExternalExamQuestion.exam_id == exam.id))).scalars().all()
    for row in old:
        await db.delete(row)
    await db.flush()

    questions = parsed.get("questions") or []
    n = len(questions) or 1
    per = round(float(exam.total_marks) / n, 2)
    saved = []
    for q in questions:
        row = ExternalExamQuestion(
            exam_id=exam.id,
            number=int(q.get("number") or 0),
            question_text=q.get("question_text") or "",
            option_a=q.get("option_a") or "",
            option_b=q.get("option_b") or "",
            option_c=q.get("option_c") or "",
            option_d=q.get("option_d") or "",
            correct_option=(q.get("correct_option") or "").upper()[:1] or None,
            marks=per,
            confidence=float(q.get("confidence") or 0),
            issues=q.get("issues") or [],
            is_approved=False,
        )
        db.add(row)
        saved.append(row)
    exam.total_questions = len(saved)
    exam.source_filename = file.filename
    exam.status = "extracted"
    exam.is_published = False
    await db.flush()
    return {
        "exam": _exam_public(exam, campus.name),
        "warnings": parsed.get("warnings") or [],
        "questions": [_q_admin(q) for q in saved],
    }


def _q_admin(q: ExternalExamQuestion) -> dict:
    return {
        "id": str(q.id),
        "number": q.number,
        "question_text": q.question_text,
        "option_a": q.option_a,
        "option_b": q.option_b,
        "option_c": q.option_c,
        "option_d": q.option_d,
        "correct_option": q.correct_option,
        "marks": q.marks,
        "confidence": q.confidence,
        "issues": q.issues or [],
        "is_approved": q.is_approved,
    }


@staff_router.get("/{exam_id}/questions")
async def list_questions(
    exam_id: str,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    await _campus(db, current_user, str(exam.school_id))
    rows = (
        await db.execute(
            select(ExternalExamQuestion)
            .where(ExternalExamQuestion.exam_id == exam.id)
            .order_by(ExternalExamQuestion.number)
        )
    ).scalars().all()
    return {"questions": [_q_admin(q) for q in rows], "exam": _exam_public(exam)}


@staff_router.put("/{exam_id}/review")
async def save_review(
    exam_id: str,
    payload: ReviewIn,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    await _campus(db, current_user, str(exam.school_id))
    by_id = {
        str(q.id): q
        for q in (
            await db.execute(select(ExternalExamQuestion).where(ExternalExamQuestion.exam_id == exam.id))
        ).scalars().all()
    }
    for item in payload.questions:
        row = by_id.get(item.id)
        if not row:
            continue
        opt = (item.correct_option or "").upper()[:1]
        if opt not in ("A", "B", "C", "D"):
            raise HTTPException(status_code=400, detail=f"Question {row.number} needs a correct option Aâ€“D")
        row.question_text = item.question_text.strip()
        row.option_a = item.option_a.strip()
        row.option_b = item.option_b.strip()
        row.option_c = item.option_c.strip()
        row.option_d = item.option_d.strip()
        row.correct_option = opt
        if item.marks is not None:
            row.marks = float(item.marks)
        row.is_approved = bool(item.is_approved)
    exam.status = "under_review"
    await db.flush()
    return {"ok": True, "status": exam.status}


@staff_router.post("/{exam_id}/publish")
async def publish_exam(
    exam_id: str,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    await _campus(db, current_user, str(exam.school_id))
    rows = (
        await db.execute(select(ExternalExamQuestion).where(ExternalExamQuestion.exam_id == exam.id))
    ).scalars().all()
    if not rows:
        raise HTTPException(status_code=400, detail="Upload and review questions first")
    bad = [q.number for q in rows if not q.is_approved or (q.correct_option or "") not in ("A", "B", "C", "D")]
    if bad:
        raise HTTPException(
            status_code=400,
            detail="Approve every question and set the correct answer before publish. Unready: "
            + ", ".join(str(n) for n in bad[:12]),
        )
    exam.is_published = True
    exam.status = "active" if _window_ok(exam) else "scheduled"
    exam.total_questions = len(rows)
    await db.flush()
    return {"ok": True, "exam": _exam_public(exam)}


@staff_router.post("/{exam_id}/unpublish")
async def unpublish_exam(
    exam_id: str,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    await _campus(db, current_user, str(exam.school_id))
    exam.is_published = False
    exam.status = "under_review"
    await db.flush()
    return {"ok": True}


@staff_router.post("/{exam_id}/results/publish")
async def publish_exam_results(
    exam_id: str,
    payload: Optional[dict] = None,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Owner spec §26: the school admin reviews submissions, then publishes.
    Publishing flips every marked attempt of this exam to result_status=
    'published', which unlocks scores for students. Optional body:
    {"publish": false} unpublishes (hides again)."""
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    campus = await _campus(db, current_user, str(exam.school_id))
    publish = True
    if isinstance(payload, dict):
        publish = bool(payload.get("publish", True))
    new_status = "published" if publish else "hidden"
    rows = (
        await db.execute(
            select(ExternalExamAttempt).where(
                ExternalExamAttempt.exam_id == exam.id,
                ExternalExamAttempt.school_id == campus.id,
                ExternalExamAttempt.marked_at.isnot(None),
            )
        )
    ).scalars().all()
    for attempt in rows:
        attempt.result_status = new_status
    await db.commit()
    return {
        "ok": True,
        "exam_id": str(exam.id),
        "result_status": new_status,
        "attempts_updated": len(rows),
    }


@staff_router.get("/{exam_id}/sync-audit")
async def exam_sync_audit(
    exam_id: str,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Owner spec — Keep an audit trail of synchronization.

    Every offline sync event for this exam: when the device says the exam was
    started/submitted, when the server received it, and any duplicates that
    were rejected (idempotent, never double-marked).
    """
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    campus = await _campus(db, current_user, str(exam.school_id))
    rows = (
        await db.execute(
            select(OfflineSyncAudit)
            .where(
                OfflineSyncAudit.exam_id == exam.id,
                OfflineSyncAudit.school_id == campus.id,
            )
            .order_by(OfflineSyncAudit.created_at.desc())
            .limit(500)
        )
    ).scalars().all()
    name_for = {}
    ids = {str(r.student_user_id) for r in rows if r.student_user_id}
    if ids:
        users = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
        name_for = {str(u.id): (u.full_name or u.email) for u in users}
    return {
        "exam_id": str(exam.id),
        "events": [
            {
                "id": str(r.id),
                "event": r.event,
                "channel": r.channel,
                "attempt_code": r.attempt_code,
                "student_name": name_for.get(str(r.student_user_id)),
                "started_at": r.offline_started_at.isoformat() if r.offline_started_at else None,
                "submitted_at": r.offline_submitted_at.isoformat() if r.offline_submitted_at else None,
                "synced_at": r.synced_at.isoformat() if r.synced_at else None,
                "detail": r.detail or {},
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@staff_router.get("/{exam_id}/results")
async def exam_results(
    exam_id: str,
    class_name: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    campus = await _campus(db, current_user, str(exam.school_id))
    rows = (
        await db.execute(
            select(ExternalExamAttempt)
            .where(
                ExternalExamAttempt.exam_id == exam.id,
                ExternalExamAttempt.school_id == campus.id,
                ExternalExamAttempt.marked_at.isnot(None),
            )
            .order_by(ExternalExamAttempt.marked_at.desc())
        )
    ).scalars().all()
    out = []
    needle = (q or "").strip().lower()
    cls = (class_name or "").strip().upper()
    for attempt in rows:
        user = None
        profile = None
        cand = None
        if attempt.student_user_id:
            user = (await db.execute(select(User).where(User.id == attempt.student_user_id))).scalar_one_or_none()
            if user:
                profile = (
                    await db.execute(select(StudentProfile).where(StudentProfile.user_id == user.id))
                ).scalar_one_or_none()
        if attempt.candidate_id:
            cand = (
                await db.execute(select(SchoolExamCandidate).where(SchoolExamCandidate.id == attempt.candidate_id))
            ).scalar_one_or_none()
        name = (user.full_name if user else None) or (cand.full_name if cand else "")
        sid = (getattr(profile, "school_student_id", None) if profile else None) or (cand.candidate_id if cand else "")
        klass = (profile.education_level if profile else None) or (cand.class_name if cand else "")
        if cls and (klass or "").upper() != cls:
            continue
        blob = " ".join([name or "", sid or "", klass or ""]).lower()
        if needle and needle not in blob:
            continue
        out.append(
            {
                "attempt_code": attempt.attempt_code,
                "result_code": attempt.result_code,
                "student_name": name,
                "candidate_id": sid,
                "class_name": klass,
                "email": user.email if user else (cand.email if cand else None),
                "score": attempt.score,
                "total_marks": exam.total_marks,
                "percentage": attempt.percentage,
                "grade": attempt.grade,
                "status": "Passed" if attempt.passed else "Failed",
                "result_status": attempt.result_status or "hidden",
                "submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
            }
        )
    return {"exam": _exam_public(exam, campus.name), "results": out}


def _class_allowed(exam: ExternalExam, class_name: str | None) -> bool:
    klass = (class_name or "").strip().upper()
    allowed = [str(c).upper() for c in (exam.allowed_classes or [exam.class_name] or [])]
    if "ALL" in allowed:
        return True
    return bool(klass) and (klass in allowed or klass == (exam.class_name or "").upper())


async def _logged_student(db: AsyncSession, current_user: dict) -> tuple[User, StudentProfile | None, SchoolCampus]:
    user = (await db.execute(select(User).where(User.id == current_user["sub"]))).scalar_one_or_none()
    if not user or user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Student account required")
    if not user.school_id:
        raise HTTPException(status_code=400, detail="Your school has not linked this account yet")
    campus = (await db.execute(select(SchoolCampus).where(SchoolCampus.id == user.school_id))).scalar_one_or_none()
    if not campus:
        raise HTTPException(status_code=404, detail="School not found")
    profile = (
        await db.execute(select(StudentProfile).where(StudentProfile.user_id == user.id))
    ).scalar_one_or_none()
    return user, profile, campus


def _student_card(user: User, profile: StudentProfile | None, campus: SchoolCampus) -> dict:
    return {
        "full_name": user.full_name,
        "email": user.email,
        "school_id": str(campus.id),
        "school_name": campus.name,
        "class_name": (profile.education_level if profile else None),
        "school_student_id": getattr(profile, "school_student_id", None) if profile else None,
    }


@public_router.get("/mine")
async def my_exams(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    user, profile, campus = await _logged_student(db, current_user)
    klass = (profile.education_level if profile else "") or ""
    exams = (
        await db.execute(
            select(ExternalExam)
            .where(
                ExternalExam.school_id == campus.id,
                ExternalExam.is_published == True,  # noqa: E712
                ExternalExam.status.in_(("scheduled", "active")),
            )
            .order_by(ExternalExam.created_at.desc())
        )
    ).scalars().all()
    visible = [e for e in exams if _class_allowed(e, klass)]
    return {"student": _student_card(user, profile, campus), "exams": [_exam_public(e, campus.name) for e in visible]}


class AuthExamIn(BaseModel):
    exam_id: str
    attempt_code: Optional[str] = None
    started_at: Optional[datetime] = None
    answers: dict[str, str] = Field(default_factory=dict)
    # Offline-security telemetry sent by the clients (site + desktop):
    # when the attempt was actually started and submitted on the device.
    # The server records both and cross-checks them against its own clock.
    submitted_at: Optional[datetime] = None
    offline_sync: bool = False
    client: Optional[str] = None


@public_router.post("/package")
async def student_package(
    payload: AuthExamIn,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    user, profile, campus = await _logged_student(db, current_user)
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == payload.exam_id))).scalar_one_or_none()
    if not exam or not exam.is_published or str(exam.school_id) != str(campus.id):
        raise HTTPException(status_code=404, detail="Exam is not open")
    if not _class_allowed(exam, profile.education_level if profile else None):
        raise HTTPException(status_code=403, detail="This exam is not for your class")
    rows = (
        await db.execute(
            select(ExternalExamQuestion)
            .where(ExternalExamQuestion.exam_id == exam.id, ExternalExamQuestion.is_approved == True)  # noqa: E712
            .order_by(ExternalExamQuestion.number)
        )
    ).scalars().all()
    # Per-student question order. Marking is keyed by question id/number, so
    # shuffling delivery cannot change any score.
    rows = list(rows)
    secrets.SystemRandom().shuffle(rows)
    return {
        "package_ready": True,
        "exam": {
            "id": str(exam.id),
            "title": exam.title,
            "subject": exam.subject,
            "class_name": exam.class_name,
            "instructions": exam.instructions,
            "duration_minutes": exam.duration_minutes,
            "total_marks": exam.total_marks,
            "pass_mark": exam.pass_mark,
            "total_questions": len(rows),
        },
        "candidate": _student_card(user, profile, campus),
        "questions": [
            {
                "id": str(q.id),
                "number": q.number,
                "question_text": q.question_text,
                "option_a": q.option_a,
                "option_b": q.option_b,
                "option_c": q.option_c,
                "option_d": q.option_d,
            }
            for q in rows
        ],
    }


@public_router.post("/start")
async def student_start(
    payload: AuthExamIn,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    user, profile, campus = await _logged_student(db, current_user)
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == payload.exam_id))).scalar_one_or_none()
    if not exam or not exam.is_published or str(exam.school_id) != str(campus.id):
        raise HTTPException(status_code=404, detail="Exam is not open")
    if not _class_allowed(exam, profile.education_level if profile else None):
        raise HTTPException(status_code=403, detail="This exam is not for your class")
    done = (
        await db.execute(
            select(ExternalExamAttempt).where(
                ExternalExamAttempt.exam_id == exam.id,
                ExternalExamAttempt.student_user_id == user.id,
                ExternalExamAttempt.submitted_at.isnot(None),
            )
        )
    ).scalar_one_or_none()
    if done:
        raise HTTPException(status_code=400, detail="You already submitted this exam.")
    open_row = (
        await db.execute(
            select(ExternalExamAttempt).where(
                ExternalExamAttempt.exam_id == exam.id,
                ExternalExamAttempt.student_user_id == user.id,
                ExternalExamAttempt.submitted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if open_row:
        return {
            "attempt_code": open_row.attempt_code,
            "started_at": open_row.started_at.isoformat() if open_row.started_at else None,
            "expires_at": open_row.expires_at.isoformat() if open_row.expires_at else None,
            "duration_minutes": exam.duration_minutes,
        }
    now = naive_utc_now()
    code = (payload.attempt_code or "").strip().upper() or _code("ATT")
    clash = (await db.execute(select(ExternalExamAttempt).where(ExternalExamAttempt.attempt_code == code))).scalar_one_or_none()
    if clash:
        code = _code("ATT")
    attempt = ExternalExamAttempt(
        attempt_code=code,
        exam_id=exam.id,
        school_id=exam.school_id,
        student_user_id=user.id,
        started_at=now,
        expires_at=now + timedelta(minutes=exam.duration_minutes or 120),
        sync_status="open",
    )
    db.add(attempt)
    await db.flush()
    return {
        "attempt_code": attempt.attempt_code,
        "started_at": attempt.started_at.isoformat(),
        "expires_at": attempt.expires_at.isoformat(),
        "duration_minutes": exam.duration_minutes,
        "student": _student_card(user, profile, campus),
        "exam_title": exam.title,
    }


def _clamp_dt(value: Optional[datetime]) -> Optional[datetime]:
    """Reject device clocks that are nonsense (year < 2020 or > 1 year ahead)."""
    if value is None:
        return None
    try:
        if value.tzinfo is not None:
            value = value.astimezone(tz=None).replace(tzinfo=None)
    except Exception:
        return None
    if value.year < 2020 or value > naive_utc_now() + timedelta(days=366):
        return None
    return value


async def _log_sync(
    db: AsyncSession,
    *,
    event: str,
    exam: Optional[ExternalExam],
    student_user_id: Optional[str],
    attempt_code: Optional[str] = None,
    channel: str = "online",
    started_at: Optional[datetime] = None,
    submitted_at: Optional[datetime] = None,
    detail: Optional[dict] = None,
) -> None:
    """Owner spec OFFLINE SECURITY: keep an audit trail of synchronization."""
    db.add(
        OfflineSyncAudit(
            attempt_code=(attempt_code or "").strip().upper() or None,
            exam_id=exam.id if exam else None,
            school_id=exam.school_id if exam else None,
            student_user_id=student_user_id,
            event=event,
            channel=channel,
            offline_started_at=started_at,
            offline_submitted_at=submitted_at,
            detail=detail,
        )
    )
    await db.flush()


@public_router.post("/submit")
async def student_submit(
    payload: AuthExamIn,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    user, profile, campus = await _logged_student(db, current_user)
    exam = (await db.execute(select(ExternalExam).where(ExternalExam.id == payload.exam_id))).scalar_one_or_none()
    if not exam or str(exam.school_id) != str(campus.id):
        raise HTTPException(status_code=404, detail="Exam not found")
    code = (payload.attempt_code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="attempt_code is required")
    attempt = (
        await db.execute(select(ExternalExamAttempt).where(ExternalExamAttempt.attempt_code == code))
    ).scalar_one_or_none()
    if attempt and attempt.student_user_id and attempt.student_user_id != user.id:
        raise HTTPException(status_code=403, detail="This attempt belongs to another student")
    published = (attempt.result_status or "hidden") == "published" if attempt else False
    started_dt = _clamp_dt(payload.started_at)
    submitted_dt = _clamp_dt(payload.submitted_at)
    if attempt and attempt.marked_at:
        # Owner spec — Prevent submitting the same attempt multiple times:
        # the first submission wins; every retry gets the SAME idempotent
        # response (no double-marking, no score change). This is also what
        # makes duplicate offline syncs safe — a replayed queue hits here.
        await _log_sync(
            db,
            event="duplicate_ignored",
            exam=exam,
            student_user_id=user.id,
            attempt_code=attempt.attempt_code,
            channel="offline_sync" if payload.offline_sync else "online",
            started_at=started_dt or attempt.started_at,
            submitted_at=submitted_dt,
            detail={
                "client": payload.client,
                "first_submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
            },
        )
        base = {
            "already_submitted": True,
            "attempt_code": attempt.attempt_code,
            "result_code": attempt.result_code,
            "student_name": user.full_name,
            "candidate_id": getattr(profile, "school_student_id", None) if profile else None,
            "class_name": profile.education_level if profile else None,
            "result_status": attempt.result_status or "hidden",
            # Owner spec §22/§25: the score stays hidden until the school
            # publishes results — the student only sees a confirmation.
            "score": attempt.score if published else None,
            "total_marks": exam.total_marks,
            "percentage": attempt.percentage if published else None,
            "grade": attempt.grade if published else None,
            "status": ("Passed" if attempt.passed else "Failed") if published else "Result withheld — awaiting school publication",
            "message": (
                "Exam already submitted. Your result will be available when your school publishes it."
                if not published
                else None
            ),
        }
        return base
    now = naive_utc_now()
    if not attempt:
        attempt = ExternalExamAttempt(
            attempt_code=code,
            exam_id=exam.id,
            school_id=exam.school_id,
            student_user_id=user.id,
            # Record exam start time: prefer the device-reported start (the
            # attempt may have been taken fully offline), clamped to a sane
            # window so a doctored clock cannot fake a 2019 start.
            started_at=started_dt or now,
            expires_at=(started_dt or now) + timedelta(minutes=exam.duration_minutes or 120),
            sync_status="pending",
            result_status="hidden",
        )
        db.add(attempt)
        await db.flush()
    elif attempt.started_at is None and started_dt is not None:
        attempt.started_at = started_dt
    attempt.submitted_at = now
    attempt.student_user_id = user.id
    attempt = await _mark_attempt(db, exam, attempt, payload.answers or {})
    await _log_sync(
        db,
        event="received",
        exam=exam,
        student_user_id=user.id,
        attempt_code=attempt.attempt_code,
        channel="offline_sync" if payload.offline_sync else "online",
        started_at=attempt.started_at,
        # Record submission time — both the device-reported one (telemetry)
        # and the authoritative server receipt time (attempt.submitted_at).
        submitted_at=submitted_dt,
        detail={
            "client": payload.client,
            "server_received_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
            "device_submitted_at": submitted_dt.isoformat() if submitted_dt else None,
            "started_at": attempt.started_at.isoformat() if attempt.started_at else None,
            "answers_count": len(payload.answers or {}),
        },
    )
    # Owner spec — Prevent reuse of an access code after submission: consume
    # the candidate slip code that matches this student on first submit so a
    # shared/leaked slip cannot start another exam.
    try:
        slip_res = await db.execute(
            select(SchoolExamCandidate).where(
                SchoolExamCandidate.user_id == user.id,
                SchoolExamCandidate.is_used == False,  # noqa: E712
            )
        )
        for slip in slip_res.scalars().all():
            slip.is_used = True
            slip.used_at = now
            slip.used_for_exam_id = exam.id
    except Exception:
        pass  # consumption must never block a valid submission
    newly_published = (attempt.result_status or "hidden") == "published"
    return {
        "already_submitted": False,
        "attempt_code": attempt.attempt_code,
        "result_code": attempt.result_code,
        "student_name": user.full_name,
        "candidate_id": getattr(profile, "school_student_id", None) if profile else None,
        "class_name": profile.education_level if profile else None,
        "result_status": attempt.result_status or "hidden",
        # Owner spec §22: no score on submission — the student sees only the
        # confirmation; the school marks/publishes and then results unlock.
        "score": attempt.score if newly_published else None,
        "total_marks": exam.total_marks,
        "percentage": attempt.percentage if newly_published else None,
        "grade": attempt.grade if newly_published else None,
        "status": (
            ("Passed" if attempt.passed else "Failed")
            if newly_published
            else "Result withheld — awaiting school publication"
        ),
        "message": (
            "Exam submitted successfully. Your result will be available when your school publishes it."
            if not newly_published
            else None
        ),
    }


async def _mark_attempt(
    db: AsyncSession,
    exam: ExternalExam,
    attempt: ExternalExamAttempt,
    answers: dict[str, str],
) -> ExternalExamAttempt:
    questions = (
        await db.execute(
            select(ExternalExamQuestion).where(
                ExternalExamQuestion.exam_id == exam.id,
                ExternalExamQuestion.is_approved == True,  # noqa: E712
            )
        )
    ).scalars().all()
    old_ans = (
        await db.execute(select(ExternalExamAnswer).where(ExternalExamAnswer.attempt_id == attempt.id))
    ).scalars().all()
    for row in old_ans:
        await db.delete(row)
    await db.flush()

    score = 0.0
    for q in questions:
        selected = (answers.get(str(q.id)) or answers.get(str(q.number)) or "").strip().upper()[:1]
        if selected not in ("A", "B", "C", "D"):
            selected = None
        correct = (q.correct_option or "").upper()[:1]
        is_ok = bool(selected and correct and selected == correct)
        awarded = float(q.marks or 0) if is_ok else 0.0
        score += awarded
        db.add(
            ExternalExamAnswer(
                attempt_id=attempt.id,
                question_id=q.id,
                selected_option=selected,
                is_correct=is_ok,
                marks_awarded=awarded,
            )
        )
    total = float(exam.total_marks or 0) or 1.0
    pct = round((score / total) * 100, 2)
    grade, passed = _grade(pct, exam.pass_mark)
    attempt.score = round(score, 2)
    attempt.percentage = pct
    attempt.grade = grade
    attempt.passed = passed
    attempt.marked_at = naive_utc_now()
    attempt.sync_status = "marked"
    attempt.answers_payload = answers
    if not attempt.result_code:
        attempt.result_code = _code("RESULT")
    await db.flush()
    return attempt

