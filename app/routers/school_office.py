import secrets
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_school_staff
from app.core.security import hash_password
from app.models.cbt import CBTExam, CBTQuestion, CBTSession, ExamProctorLog
from app.models.school_campus import SchoolCampus
from app.models.school_office import SchoolExamCandidate
from app.models.user import StudentProfile, TeacherProfile, User, UserRole
from app.models.live_class import LiveClass
from app.core.datetime_utils import naive_utc_now

router = APIRouter(prefix="/admin/school-office", tags=["School office"])

# ── School portal (branded admin dashboard on <slug>.scholaxia.com) ───────
# New public router so school links can bootstrap + authenticate without
# touching the admin-only router above.
portal_router = APIRouter(prefix="/school-portal", tags=["School portal"])


_schema_ensured = False


async def _ensure_schema_once() -> None:
    """Run the campus-column migration at most ONCE per process.

    initialize_database() already does this at boot; this is only a safety
    net. Running 8 ALTER TABLE statements on every request caused parallel
    requests to serialize on table locks and every portal tab to hang on
    "Loading…".
    """
    global _schema_ensured
    if _schema_ensured:
        return
    from app.core.startup_db import ensure_school_campus_schema
    try:
        await ensure_school_campus_schema()
    finally:
        _schema_ensured = True


@portal_router.get("/{slug}/public")
async def portal_public_info(slug: str, db: AsyncSession = Depends(get_db)):
    """Branding for the school's login screen. Only minimal public fields."""
    await _ensure_schema_once()
    row = (
        await db.execute(
            select(SchoolCampus).where(
                SchoolCampus.slug == slug.lower().strip(),
                SchoolCampus.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="School not found")
    status = (getattr(row, "approval_status", None) or "approved").lower()
    return {
        "school_id": str(row.id),
        "slug": row.slug,
        "name": row.name,
        "city": row.city,
        "state": row.state,
        "logo_url": getattr(row, "logo_url", None),
        "school_type": getattr(row, "school_type", None),
        "category": getattr(row, "category", None),
        "approval_status": status,
        "login_open": status == "approved",
    }


class PortalLoginIn(BaseModel):
    identifier: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=1, max_length=128)


@portal_router.post("/{slug}/login")
async def portal_login(slug: str, payload: PortalLoginIn, db: AsyncSession = Depends(get_db)):
    """School-staff login on the school's own link.

    Accepts the school admin's email or the phone they registered with; the
    password is the one set during registration. Returns the same token shape
    as /auth/login so the SPA can call every existing API.
    """
    from app.core.security import verify_password, create_access_token

    info = await portal_public_info(slug, db)
    if not info.get("login_open"):
        raise HTTPException(status_code=403, detail="This school is not active yet")

    ident = payload.identifier.strip().lower()
    row = (
        await db.execute(
            select(User).where(
                User.school_id == UUID(info["school_id"]),
                User.role == UserRole.school_admin,
                func.lower(User.email) == ident,
            )
        )
    ).scalar_one_or_none()
    if row is None and ident.replace(" ", "").isdigit():
        row = (
            await db.execute(
                select(User).where(
                    User.school_id == UUID(info["school_id"]),
                    User.role == UserRole.school_admin,
                    func.replace(User.phone, " ", "") == ident,
                )
            )
        ).scalar_one_or_none()
    if row is None or not row.hashed_password or not verify_password(payload.password, row.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email/phone or password for this school")
    if not row.is_active:
        raise HTTPException(status_code=403, detail="This account has been disabled")

    # sv must match the user's current token_version or every authenticated
    # call 401s ("logged in on another device") — the logout loop.
    token = create_access_token(str(row.id), row.role, session_version=int(getattr(row, "token_version", 0) or 0))
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": "school_admin",
        "user": {
            "id": str(row.id),
            "full_name": row.full_name,
            "email": row.email,
            "school_id": str(row.school_id),
            "school_name": info["name"],
            "school_slug": info["slug"],
        },
        "school": info,
    }


@portal_router.get("/{slug}/dashboard")
async def portal_dashboard(slug: str, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    """Headline numbers for the portal home page."""
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])

    students = (
        await db.execute(
            select(func.count(User.id)).where(User.school_id == campus.id, User.role == UserRole.student)
        )
    ).scalar() or 0
    teachers = (
        await db.execute(
            select(func.count(User.id)).where(User.school_id == campus.id, User.role == UserRole.teacher)
        )
    ).scalar() or 0
    exams = (
        await db.execute(
            select(func.count(CBTExam.id)).where(CBTExam.school_id == campus.id, CBTExam.is_school_exam == True)  # noqa: E712
        )
    ).scalar() or 0
    subs = (
        await db.execute(
            select(func.count(CBTSession.id)).join(CBTExam, CBTExam.id == CBTSession.exam_id).where(
                CBTExam.school_id == campus.id,
                CBTSession.submitted_at.isnot(None),
            )
        )
    ).scalar() or 0
    return {
        "school": {
            "name": campus.name,
            "slug": campus.slug,
            "logo_url": getattr(campus, "logo_url", None),
            "school_type": getattr(campus, "school_type", None),
            "category": getattr(campus, "category", None),
            "city": campus.city,
            "state": campus.state,
        },
        "stats": {
            "students": int(students),
            "teachers": int(teachers),
            "exams": int(exams),
            "exam_submissions": int(subs),
        },
    }


class SubjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=20)
    subject_type: str = Field(default="core", max_length=20)  # core | general | elective
    class_levels: list[str] = []  # e.g. ["JSS1", "JSS2"]
    is_active: bool = True


class ClassIn(BaseModel):
    name: str = Field(min_length=2, max_length=40)  # e.g. JSS1 A
    section: str = Field(default="A", max_length=10)
    level: str = Field(default="", max_length=20)  # JSS1 / SS2 …


# Per-school subject + class registries (JSON columns on the campus row keep
# this table-free and instantly available to every school).
def _subjects_of(campus: SchoolCampus) -> list[dict]:
    return list(getattr(campus, "portal_subjects", None) or [])


def _classes_of(campus: SchoolCampus) -> list[dict]:
    return list(getattr(campus, "portal_classes", None) or [])


@portal_router.get("/{slug}/subjects")
async def portal_subjects(slug: str, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = _subjects_of(campus)
    return {
        "subjects": rows,
        "stats": {
            "total": len(rows),
            "active": len([r for r in rows if r.get("is_active", True)]),
            "inactive": len([r for r in rows if not r.get("is_active", True)]),
            "core": len([r for r in rows if r.get("subject_type") == "core"]),
        },
    }


@portal_router.post("/{slug}/subjects", status_code=201)
async def portal_add_subject(slug: str, payload: SubjectIn, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = _subjects_of(campus)
    code = payload.code.strip().upper()
    for r in rows:
        if str(r.get("code", "")).upper() == code:
            raise HTTPException(status_code=409, detail=f"Subject code {code} already exists")
    rows.append(
        {
            "id": secrets.token_hex(6),
            "name": payload.name.strip(),
            "code": code,
            "subject_type": payload.subject_type,
            "class_levels": payload.class_levels or [],
            "is_active": payload.is_active,
            "created_at": naive_utc_now().isoformat(),
        }
    )
    campus.portal_subjects = rows
    flag_modified(campus, "portal_subjects")
    await db.commit()
    return {"ok": True, "subjects": rows}


@portal_router.delete("/{slug}/subjects/{subject_id}")
async def portal_delete_subject(slug: str, subject_id: str, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = [r for r in _subjects_of(campus) if r.get("id") != subject_id]
    campus.portal_subjects = rows
    flag_modified(campus, "portal_subjects")
    await db.commit()
    return {"ok": True, "subjects": rows}


@portal_router.get("/{slug}/classes")
async def portal_classes(slug: str, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = _classes_of(campus)
    # Live head-count per class from real student accounts.
    counts = dict(
        (await db.execute(
            select(StudentProfile.education_level, func.count(User.id))
            .join(User, User.id == StudentProfile.user_id)
            .where(User.school_id == campus.id, User.role == UserRole.student)
            .group_by(StudentProfile.education_level)
        )).all()
    )
    out = []
    for r in rows:
        level = (r.get("level") or "").upper()
        out.append({**r, "student_count": int(counts.get(level, 0))})
    return {"classes": out, "total": len(out)}


@portal_router.post("/{slug}/classes", status_code=201)
async def portal_add_class(slug: str, payload: ClassIn, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = _classes_of(campus)
    name = payload.name.strip()
    for r in rows:
        if str(r.get("name", "")).lower() == name.lower():
            raise HTTPException(status_code=409, detail=f"Class '{name}' already exists")
    rows.append({"id": secrets.token_hex(6), "name": name, "section": payload.section or "A", "level": (payload.level or name[:3]).upper()})
    campus.portal_classes = rows
    flag_modified(campus, "portal_classes")
    await db.commit()
    return {"ok": True, "classes": rows}


@portal_router.delete("/{slug}/classes/{class_id}")
async def portal_delete_class(slug: str, class_id: str, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = [r for r in _classes_of(campus) if r.get("id") != class_id]
    campus.portal_classes = rows
    flag_modified(campus, "portal_classes")
    await db.commit()
    return {"ok": True, "classes": rows}


@portal_router.get("/{slug}/attendance")
async def portal_attendance(slug: str, date: Optional[str] = Query(None), current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    """Attendance register for a date. Real student roster; marks stored per
    date in the campus JSON so the register persists across reloads."""
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    day = (date or naive_utc_now().date().isoformat())[:10]
    students = (
        await db.execute(
            select(User, StudentProfile)
            .outerjoin(StudentProfile, StudentProfile.user_id == User.id)
            .where(User.school_id == campus.id, User.role == UserRole.student)
            .order_by(User.full_name)
        )
    ).all()
    marks = dict((getattr(campus, "portal_attendance", None) or {}).get(day, {}))
    out = []
    for user, profile in students:
        sid = getattr(profile, "school_student_id", None) or str(user.id)
        out.append(
            {
                "id": str(user.id),
                "student_id": sid,
                "full_name": user.full_name,
                "class_name": (profile.education_level if profile else "") or "—",
                "status": marks.get(sid) or "unmarked",  # present | absent | late | unmarked
            }
        )
    present = len([r for r in out if r["status"] == "present"])
    absent = len([r for r in out if r["status"] == "absent"])
    late = len([r for r in out if r["status"] == "late"])
    return {
        "date": day,
        "students": out,
        "summary": {"total": len(out), "present": present, "absent": absent, "late": late},
    }


class AttendanceMarkIn(BaseModel):
    date: str = Field(min_length=10, max_length=10)
    marks: dict[str, str]  # student_id -> present|absent|late


@portal_router.post("/{slug}/attendance")
async def portal_mark_attendance(slug: str, payload: AttendanceMarkIn, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    store = dict(getattr(campus, "portal_attendance", None) or {})
    day = payload.date[:10]
    clean = {k: ("present" if v == "present" else "absent" if v == "absent" else "late" if v == "late" else "unmarked") for k, v in payload.marks.items()}
    store[day] = clean
    campus.portal_attendance = store
    flag_modified(campus, "portal_attendance")
    await db.commit()
    return {"ok": True, "date": day, "marked": len(clean)}


@portal_router.get("/{slug}/fees")
async def portal_fees(slug: str, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    """Fee records for the school. Stored per-school in JSON; created via POST."""
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = list(getattr(campus, "portal_fees", None) or [])
    total_due = sum(float(r.get("amount", 0)) for r in rows)
    paid = [r for r in rows if r.get("status") == "paid"]
    total_paid = sum(float(r.get("amount", 0)) for r in paid)
    return {
        "fees": rows,
        "stats": {
            "records": len(rows),
            "total_due": total_due,
            "total_paid": total_paid,
            "outstanding": total_due - total_paid,
            "collection_rate": round(100 * total_paid / total_due, 1) if total_due else 0,
        },
    }


class FeeIn(BaseModel):
    student_name: str = Field(min_length=2, max_length=255)
    student_id: str | None = None
    class_name: str | None = None
    fee_type: str = Field(default="School Fees", max_length=60)
    amount: float = Field(ge=0)
    method: str = Field(default="cash", max_length=30)  # cash | transfer | pos | online
    status: str = Field(default="paid", max_length=20)  # paid | pending | overdue


@portal_router.post("/{slug}/fees", status_code=201)
async def portal_add_fee(slug: str, payload: FeeIn, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = list(getattr(campus, "portal_fees", None) or [])
    rows.insert(
        0,
        {
            "id": secrets.token_hex(6),
            "date": naive_utc_now().date().isoformat(),
            "student_name": payload.student_name.strip(),
            "student_id": (payload.student_id or "").strip() or None,
            "class_name": (payload.class_name or "").strip() or None,
            "fee_type": payload.fee_type,
            "amount": float(payload.amount),
            "method": payload.method,
            "status": payload.status if payload.status in ("paid", "pending", "overdue") else "pending",
        },
    )
    campus.portal_fees = rows[:1000]
    flag_modified(campus, "portal_fees")
    await db.commit()
    return {"ok": True, "fees": rows[:1000]}


@portal_router.get("/{slug}/settings")
async def portal_settings(slug: str, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    return {
        "school": {
            "name": campus.name,
            "slug": campus.slug,
            "logo_url": getattr(campus, "logo_url", None),
            "school_type": getattr(campus, "school_type", None),
            "category": getattr(campus, "category", None),
            "city": campus.city,
            "state": campus.state,
            "address": getattr(campus, "address", None),
            "contact_email": getattr(campus, "contact_email", None),
            "contact_phone": getattr(campus, "contact_phone", None),
        },
        "custom_domain": getattr(campus, "custom_domain", None),
    }


class PortalSettingsIn(BaseModel):
    address: str | None = Field(default=None, max_length=500)
    contact_email: str | None = Field(default=None, max_length=255)
    contact_phone: str | None = Field(default=None, max_length=40)


@portal_router.patch("/{slug}/settings")
async def portal_update_settings(slug: str, payload: PortalSettingsIn, current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    if payload.address is not None:
        campus.address = payload.address.strip() or None
    if payload.contact_email is not None:
        campus.contact_email = payload.contact_email.strip().lower() or None
    if payload.contact_phone is not None:
        campus.contact_phone = payload.contact_phone.strip() or None
    await db.commit()
    return {"ok": True}


async def _campus(db: AsyncSession, current_user: dict, school_id: str | None = None) -> SchoolCampus:
    sid = current_user.get("school_id") if current_user.get("role") == "school_admin" else school_id
    if not sid:
        raise HTTPException(status_code=400, detail="Main admin must add a school first, then pick it here")
    await _ensure_schema_once()
    try:
        row = (await db.execute(select(SchoolCampus).where(SchoolCampus.id == sid))).scalar_one_or_none()
        if not row or not row.is_active:
            raise HTTPException(status_code=404, detail="School not found")
        return row
    except HTTPException:
        raise
    except Exception:
        await db.rollback()
        raw = (
            await db.execute(
                text(
                    """
                    SELECT id, name, code, city, state, COALESCE(is_active, true) AS is_active
                    FROM school_campuses
                    WHERE id = :id
                    """
                ),
                {"id": sid},
            )
        ).mappings().first()
        if not raw or not raw["is_active"]:
            raise HTTPException(status_code=404, detail="School not found")
        campus = SchoolCampus(
            id=raw["id"],
            name=raw["name"],
            code=raw["code"],
            city=raw["city"],
            state=raw["state"],
            is_active=bool(raw["is_active"]),
        )
        return campus


def _gen_rec() -> str:
    return "REC-" + datetime.utcnow().strftime("%Y") + "-" + secrets.token_hex(3).upper()


def _gen_candidate_id() -> str:
    return "SCH-" + datetime.utcnow().strftime("%Y") + "-" + secrets.token_hex(3).upper()


def _gen_access() -> str:
    return secrets.token_hex(4).upper()


def _candidate_dict(row: SchoolExamCandidate) -> dict:
    return {
        "id": str(row.id),
        "school_name": row.school_name,
        "class_name": row.class_name,
        "full_name": row.full_name,
        "email": row.email,
        "phone": row.phone,
        "rec_number": row.rec_number,
        "candidate_id": getattr(row, "candidate_id", None),
        "access_code": row.access_code,
        "subjects": list(row.subjects or []),
        "school_id": str(row.school_id) if getattr(row, "school_id", None) else None,
        "user_id": str(row.user_id) if row.user_id else None,
        "is_restricted": bool(row.is_restricted),
        "retake_exam_ids": list(row.retake_exam_ids or []),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


class RegisterCandidateRequest(BaseModel):
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    class_name: str = Field(..., min_length=2, max_length=40)
    full_name: str = Field(..., min_length=2, max_length=255)
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    subjects: list[str] = []


class SchoolTeacherRequest(BaseModel):
    school_id: Optional[str] = None
    full_name: str
    email: EmailStr
    password: str = Field(..., min_length=8)
    subjects: list[str] = []
    academic_classes: list[str] = []


class RetakeRequest(BaseModel):
    exam_id: str
    student_email: Optional[str] = None
    candidate_id: Optional[str] = None


@router.get("/me")
async def school_office_me(
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    if current_user.get("role") == "admin":
        schools = (await db.execute(select(SchoolCampus).order_by(SchoolCampus.name))).scalars().all()
        return {
            "role": "admin",
            "school_id": None,
            "school_name": None,
            "schools": [{"id": str(s.id), "name": s.name, "code": s.code} for s in schools if s.is_active],
        }
    campus = await _campus(db, current_user)
    return {
        "role": "school_admin",
        "school_id": str(campus.id),
        "school_name": campus.name,
        "schools": [{"id": str(campus.id), "name": campus.name, "code": campus.code}],
    }


@router.post("/candidates", status_code=201)
async def register_candidate(
    payload: RegisterCandidateRequest,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Pass 7 — register an exam student whose printed credentials WORK.

    Previously this minted a standalone REC-…/8-hex pair stored only in
    school_exam_candidates, which the exam portal login (school_exam_access
    _codes) never recognised — "the access code is not working". Now the same
    registration creates the exam-scoped student account + a pending access
    code row (exam attached when the subject is scheduled), and the candidate
    record shows those exact credentials. Reg numbers use the new unique
    school-prefixed pattern and are stable across every exam.
    """
    from app.models.school_cbt import SchoolExam, SchoolExamAssignment
    from app.routers.school_cbt import _ensure_access_codes, _mint_pending_credential

    campus = await _campus(db, current_user, payload.school_id)
    cls = payload.class_name.strip().upper()
    full_name = payload.full_name.strip()

    # Exam-scoped student account (never logs into the main app — credentials
    # are REG NUMBER + ACCESS CODE, §14).
    while True:
        placeholder_email = f"exam.{secrets.token_hex(6).lower()}@students.scholaxia.local"
        if (
            await db.execute(select(User.id).where(User.email == placeholder_email))
        ).scalar_one_or_none() is None:
            break
    user = User(
        email=placeholder_email,
        hashed_password=hash_password(secrets.token_urlsafe(12)),
        full_name=full_name[:120],
        role=UserRole.student,
        is_verified=True,
        is_active=True,
        school_id=campus.id,
    )
    db.add(user)
    await db.flush()
    db.add(StudentProfile(user_id=user.id, education_level=cls))
    await db.flush()

    # Issue the reg number + access code NOW (slip is final), reusing the
    # pending row at schedule time so these printed credentials keep working.
    cred = await _mint_pending_credential(db, campus.id, user.id)

    # Already-scheduled exams for this class (subject-filtered) get the
    # student assigned immediately.
    q = select(SchoolExam).where(
        SchoolExam.school_id == campus.id,
        func.upper(SchoolExam.class_name) == cls,
    )
    subjects = [s.strip() for s in payload.subjects if str(s).strip()]
    if subjects and "ALL" not in {s.upper() for s in subjects}:
        q = q.where(func.lower(SchoolExam.subject).in_([s.lower() for s in subjects]))
    exams = (await db.execute(q)).scalars().all()
    for e in exams:
        db.add(
            SchoolExamAssignment(
                school_id=campus.id, exam_id=e.id, student_id=user.id,
                class_name=cls, subject=e.subject,
            )
        )
        await _ensure_access_codes(db, e)

    row = SchoolExamCandidate(
        school_id=campus.id,
        school_name=campus.name,
        class_name=cls,
        full_name=full_name,
        email=str(payload.email).lower() if payload.email else None,
        phone=payload.phone,
        rec_number=cred.reg_number,
        candidate_id=cred.reg_number,
        access_code=cred.access_code,
        subjects=subjects,
        user_id=user.id,
        created_by=current_user["sub"],
    )
    db.add(row)
    await db.flush()
    return _candidate_dict(row)


@router.get("/candidates")
async def list_candidates(
    q: Optional[str] = Query(None),
    class_name: Optional[str] = Query(None),
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    query = select(SchoolExamCandidate).order_by(SchoolExamCandidate.created_at.desc())
    sid = current_user.get("school_id") if current_user.get("role") == "school_admin" else school_id
    if sid:
        query = query.where(SchoolExamCandidate.school_id == sid)
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(SchoolExamCandidate.email).like(like),
                func.lower(SchoolExamCandidate.full_name).like(like),
                func.lower(SchoolExamCandidate.rec_number).like(like),
                func.lower(SchoolExamCandidate.access_code).like(like),
            )
        )
    if class_name:
        query = query.where(SchoolExamCandidate.class_name == class_name.strip().upper())
    rows = (await db.execute(query.limit(400))).scalars().all()
    return {"candidates": [_candidate_dict(r) for r in rows], "count": len(rows)}


@router.get("/candidates/{candidate_id}/slip")
async def candidate_slip(
    candidate_id: str,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(select(SchoolExamCandidate).where(SchoolExamCandidate.id == candidate_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Student not found")
    data = _candidate_dict(row)
    data["print_title"] = f"{row.school_name} — Exam registration slip"
    return data


class SchoolStudentIn(BaseModel):
    school_id: Optional[str] = None
    full_name: str
    email: Optional[EmailStr] = None  # optional — school students log in with their Student ID
    class_name: str
    student_id: Optional[str] = None
    password: Optional[str] = None


def _student_row(user: User, profile: StudentProfile | None, campus: SchoolCampus) -> dict:
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "class_name": profile.education_level if profile else None,
        "student_id": getattr(profile, "school_student_id", None) if profile else None,
        "is_active": user.is_active,
        "school_name": campus.name,
    }


async def _create_school_student(db: AsyncSession, campus: SchoolCampus, payload: SchoolStudentIn) -> tuple[User, str]:
    sid = (payload.student_id or "").strip().upper() or (
        (campus.code or "STU").upper()[:8] + "-" + secrets.token_hex(2).upper()
    )
    email = str(payload.email or "").lower().strip()
    if not email:
        # No email provided — synthesize a unique placeholder (students log
        # in with their Student ID, never this address).
        base_slug = (campus.slug or "school").replace("-", "")
        email = f"{sid.lower()}@{base_slug}.scholaxia.local"
        while (
            await db.execute(select(User.id).where(User.email == email))
        ).scalar_one_or_none() is not None:
            email = f"{sid.lower()}-{secrets.token_hex(2)}@{base_slug}.scholaxia.local"
    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Email already in use: {email}")
    password = (payload.password or "").strip() or secrets.token_urlsafe(8)
    user = User(
        email=email,
        hashed_password=hash_password(password),
        full_name=payload.full_name.strip(),
        role=UserRole.student,
        is_verified=True,
        is_active=True,
        school_id=campus.id,
    )
    db.add(user)
    await db.flush()
    db.add(
        StudentProfile(
            user_id=user.id,
            education_level=payload.class_name.strip().upper(),
            school_student_id=sid,
            has_active_subscription=bool(getattr(campus, "subscription_active", False)),
        )
    )
    await db.flush()
    return user, password


@router.get("/students")
async def list_school_students(
    q: Optional[str] = Query(None),
    class_name: Optional[str] = Query(None),
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, school_id)
    rows = (
        await db.execute(
            select(User, StudentProfile)
            .outerjoin(StudentProfile, StudentProfile.user_id == User.id)
            .where(User.role == UserRole.student, User.school_id == campus.id)
            .order_by(User.full_name)
        )
    ).all()
    needle = (q or "").strip().lower()
    cls = (class_name or "").strip().upper()
    out = []
    for user, profile in rows:
        if cls and (profile.education_level if profile else "") != cls:
            continue
        blob = " ".join([user.full_name, user.email, getattr(profile, "school_student_id", None) or ""]).lower()
        if needle and needle not in blob:
            continue
        out.append(_student_row(user, profile, campus))
    return {
        "students": out,
        "subscription_active": bool(getattr(campus, "subscription_active", False)),
        "subscription_plan": getattr(campus, "subscription_plan", None),
    }


@router.post("/students", status_code=201)
async def add_school_student(
    payload: SchoolStudentIn,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, payload.school_id)
    user, password = await _create_school_student(db, campus, payload)
    profile = (await db.execute(select(StudentProfile).where(StudentProfile.user_id == user.id))).scalar_one_or_none()
    data = _student_row(user, profile, campus)
    data["password"] = password
    return data


@router.post("/students/import")
async def import_school_students(
    file: UploadFile = File(...),
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    import csv
    import io

    campus = await _campus(db, current_user, school_id)
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    created = []
    errors = []
    for i, row in enumerate(reader, start=2):
        name = (row.get("name") or row.get("full_name") or "").strip()
        email = (row.get("email") or "").strip()
        klass = (row.get("class") or row.get("class_name") or "").strip()
        sid = (row.get("student_id") or row.get("id") or "").strip()
        password = (row.get("password") or "").strip() or None
        if not name or not klass:
            errors.append(f"Row {i}: name and class are required (email optional — students log in with their Student ID)")
            continue
        try:
            user, pw = await _create_school_student(
                db,
                campus,
                SchoolStudentIn(full_name=name, email=email, class_name=klass, student_id=sid or None, password=password),
            )
            profile = (await db.execute(select(StudentProfile).where(StudentProfile.user_id == user.id))).scalar_one()
            item = _student_row(user, profile, campus)
            item["password"] = pw
            created.append(item)
        except HTTPException as exc:
            errors.append(f"Row {i}: {exc.detail}")
    await db.flush()
    return {"created": created, "created_count": len(created), "errors": errors}


class StudentPatchIn(BaseModel):
    class_name: Optional[str] = None
    student_id: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


@router.patch("/students/{user_id}")
async def update_school_student(
    user_id: str,
    payload: StudentPatchIn,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, None if current_user.get("role") == "school_admin" else None)
    user = (await db.execute(select(User).where(User.id == user_id, User.school_id == campus.id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")
    profile = (await db.execute(select(StudentProfile).where(StudentProfile.user_id == user.id))).scalar_one_or_none()
    if payload.class_name and profile:
        profile.education_level = payload.class_name.strip().upper()
    if payload.student_id and profile:
        profile.school_student_id = payload.student_id.strip().upper()
    if payload.is_active is not None:
        user.is_active = payload.is_active
    new_password = None
    if payload.password:
        new_password = payload.password.strip()
        user.hashed_password = hash_password(new_password)
        user.token_version = int(user.token_version or 0) + 1
    await db.flush()
    data = _student_row(user, profile, campus)
    if new_password:
        data["password"] = new_password
    return data


@router.post("/teachers", status_code=201)
async def add_school_teacher(
    payload: SchoolTeacherRequest,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, payload.school_id)
    existing = (await db.execute(select(User).where(User.email == payload.email.lower()))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already in use")
    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=UserRole.teacher,
        is_verified=True,
        is_active=True,
        school_id=campus.id,
    )
    db.add(user)
    await db.flush()
    db.add(
        TeacherProfile(
            user_id=user.id,
            subjects=payload.subjects,
            academic_classes=[c.strip().upper() for c in payload.academic_classes if str(c).strip()],
            is_approved=True,
            school_id=campus.id,
        )
    )
    await db.flush()
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "subjects": payload.subjects,
        "academic_classes": payload.academic_classes,
        "is_approved": True,
    }


@router.get("/teachers")
async def list_school_teachers(
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, school_id)
    rows = (
        await db.execute(
            select(User, TeacherProfile)
            .outerjoin(TeacherProfile, TeacherProfile.user_id == User.id)
            .where(User.role == UserRole.teacher, User.school_id == campus.id)
            .order_by(User.full_name)
        )
    ).all()
    return {
        "teachers": [
            {
                "id": str(u.id),
                "full_name": u.full_name,
                "email": u.email,
                "subjects": (p.subjects if p else []) or [],
                "academic_classes": (p.academic_classes if p else []) or [],
            }
            for u, p in rows
        ]
    }


@router.get("/results")
async def print_results(
    class_name: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, school_id)
    query = (
        select(CBTSession, CBTExam, User)
        .join(CBTExam, CBTExam.id == CBTSession.exam_id)
        .join(User, User.id == CBTSession.student_id)
        .where(
            CBTSession.submitted_at.isnot(None),
            CBTExam.is_school_exam == True,  # noqa: E712
            CBTExam.school_id == campus.id,
        )
        .order_by(CBTSession.submitted_at.desc())
    )
    if subject:
        query = query.where(func.lower(CBTExam.subject) == subject.strip().lower())
    rows = (await db.execute(query.limit(500))).all()
    out = []
    for session, exam, user in rows:
        if class_name:
            cand = (
                await db.execute(
                    select(SchoolExamCandidate).where(
                        func.lower(SchoolExamCandidate.email) == (user.email or "").lower(),
                        SchoolExamCandidate.class_name == class_name.strip().upper(),
                    )
                )
            ).scalar_one_or_none()
            if not cand:
                continue
        out.append(
            {
                "student_name": user.full_name,
                "email": user.email,
                "exam_title": exam.title,
                "subject": exam.subject,
                "score": session.score,
                "percentage": session.percentage,
                "total_correct": session.total_correct,
                "total_wrong": session.total_wrong,
                "submitted_at": session.submitted_at.isoformat() if session.submitted_at else None,
            }
        )
    return {"results": out, "count": len(out)}


@router.post("/retake")
async def grant_retake(
    payload: RetakeRequest,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    student_id = None
    candidate = None
    if payload.candidate_id:
        candidate = (
            await db.execute(
                select(SchoolExamCandidate).where(SchoolExamCandidate.id == payload.candidate_id)
            )
        ).scalar_one_or_none()
        if candidate and candidate.user_id:
            student_id = candidate.user_id
        elif candidate and candidate.email:
            user = (
                await db.execute(select(User).where(func.lower(User.email) == candidate.email.lower()))
            ).scalar_one_or_none()
            student_id = user.id if user else None
    if payload.student_email:
        user = (
            await db.execute(select(User).where(func.lower(User.email) == payload.student_email.lower()))
        ).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="No student account for that email")
        student_id = user.id
    if not student_id:
        raise HTTPException(status_code=400, detail="Could not match a student account to retake")
    session_ids = (
        await db.execute(
            select(CBTSession.id).where(
                CBTSession.exam_id == payload.exam_id,
                CBTSession.student_id == student_id,
            )
        )
    ).scalars().all()
    if session_ids:
        await db.execute(delete(ExamProctorLog).where(ExamProctorLog.session_id.in_(session_ids)))
    await db.execute(
        delete(CBTSession).where(
            CBTSession.exam_id == payload.exam_id,
            CBTSession.student_id == student_id,
        )
    )
    if candidate:
        ids = list(candidate.retake_exam_ids or [])
        if payload.exam_id not in ids:
            ids.append(payload.exam_id)
        candidate.retake_exam_ids = ids
    await db.flush()
    return {"ok": True, "message": "Student can retake this exam."}


@router.get("/exam-counts")
async def exam_counts(
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    query = select(CBTExam).where(CBTExam.is_school_exam == True).order_by(CBTExam.created_at.desc())  # noqa: E712
    sid = current_user.get("school_id") if current_user.get("role") == "school_admin" else school_id
    if sid:
        query = query.where(CBTExam.school_id == sid)
    exams = (await db.execute(query)).scalars().all()
    out = []
    for exam in exams:
        taken = (
            await db.execute(
                select(func.count(CBTSession.id)).where(
                    CBTSession.exam_id == exam.id,
                    CBTSession.submitted_at.isnot(None),
                )
            )
        ).scalar() or 0
        out.append(
            {
                "id": str(exam.id),
                "title": exam.title,
                "subject": exam.subject,
                "is_published": exam.is_published,
                "taken_count": int(taken),
                "scheduled_start": exam.scheduled_start.isoformat() if exam.scheduled_start else None,
                "scheduled_end": exam.scheduled_end.isoformat() if exam.scheduled_end else None,
                "total_questions": exam.total_questions,
                "document_url": exam.notes_url,
                "document_name": exam.notes_title,
            }
        )
    return {"exams": out}


class SchoolExamQuestionIn(BaseModel):
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_option: str = "A"


class SchoolExamCreate(BaseModel):
    school_id: Optional[str] = None
    title: str
    subject: str
    duration_minutes: int = 45
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    questions: list[SchoolExamQuestionIn] = []
    is_published: bool = True


class SchoolExamSchedule(BaseModel):
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    is_published: Optional[bool] = None


@router.post("/exams", status_code=201)
async def create_school_exam(
    payload: SchoolExamCreate,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, payload.school_id)
    if not payload.questions:
        raise HTTPException(status_code=400, detail="Add at least one question")
    exam = CBTExam(
        title=payload.title.strip(),
        subject=payload.subject.strip(),
        exam_type="SCHOOL",
        duration_minutes=max(5, min(int(payload.duration_minutes or 45), 300)),
        total_questions=len(payload.questions),
        created_by=current_user["sub"],
        is_published=payload.is_published,
        is_school_exam=True,
        school_id=campus.id,
        scheduled_start=payload.scheduled_start,
        scheduled_end=payload.scheduled_end,
        ai_locked=True,
        camera_required=False,
        block_minimize=True,
    )
    db.add(exam)
    await db.flush()
    for q in payload.questions:
        opt = (q.correct_option or "A").upper()
        if opt not in ("A", "B", "C", "D"):
            raise HTTPException(status_code=400, detail="correct_option must be A/B/C/D")
        db.add(
            CBTQuestion(
                exam_id=exam.id,
                question_text=q.question_text,
                option_a=q.option_a,
                option_b=q.option_b,
                option_c=q.option_c,
                option_d=q.option_d,
                correct_option=opt,
            )
        )
    await db.flush()
    return {"id": str(exam.id), "title": exam.title, "subject": exam.subject, "total_questions": exam.total_questions}


@router.patch("/exams/{exam_id}")
async def schedule_school_exam(
    exam_id: str,
    payload: SchoolExamSchedule,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    exam = (await db.execute(select(CBTExam).where(CBTExam.id == exam_id))).scalar_one_or_none()
    if not exam or not exam.is_school_exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if current_user.get("role") == "school_admin" and str(exam.school_id) != str(current_user.get("school_id")):
        raise HTTPException(status_code=403, detail="This exam is not in your school")
    if payload.scheduled_start is not None:
        exam.scheduled_start = payload.scheduled_start
    if payload.scheduled_end is not None:
        exam.scheduled_end = payload.scheduled_end
    if payload.is_published is not None:
        exam.is_published = payload.is_published
    await db.flush()
    return {"ok": True, "id": str(exam.id)}


@router.post("/live-classes", status_code=201)
async def host_school_live_class(
    payload: dict,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    campus = await _campus(db, current_user, payload.get("school_id"))
    vis = str(payload.get("visibility") or "class_level").strip().lower()
    if vis not in ("class_level", "private", "public"):
        vis = "class_level"
    live_class = LiveClass(
        teacher_id=current_user["sub"],
        subject=str(payload.get("subject") or "").strip(),
        title=str(payload.get("title") or "").strip(),
        start_time=naive_utc_now(),
        room_id="room-" + secrets.token_hex(6),
        join_code="SX-" + secrets.token_hex(4).upper(),
        is_live=bool(payload.get("start_now")),
        visibility=vis,
        academic_class=(str(payload.get("academic_class") or "").strip().upper() or None),
        school_id=campus.id,
    )
    if not live_class.title or not live_class.subject:
        raise HTTPException(status_code=400, detail="Title and subject are required")
    db.add(live_class)
    await db.flush()
    return {
        "id": str(live_class.id),
        "title": live_class.title,
        "subject": live_class.subject,
        "is_live": live_class.is_live,
        "school_name": campus.name,
    }


# ── Exam authoring: import questions from a file, attach any document ──

@portal_router.post("/{slug}/exams/import", status_code=201)
async def portal_import_exam(
    slug: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    subject: str = Form(""),
    duration_minutes: int = Form(45),
    scheduled_start: Optional[str] = Form(None),
    scheduled_end: Optional[str] = Form(None),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Create a school exam by uploading a .json / .csv / .pdf question file.

    The parser accepts the same formats as the main admin CBT importer, so a
    school can prepare questions in any of those and upload them here.
    """
    from app.services.cbt_import import parse_cbt_file

    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    # Forgiving defaults: CSV/PDF files may not carry a title/subject inside,
    # so fall back to the filename stem and "General" instead of rejecting.
    stem = (file.filename or "exam").rsplit(".", 1)[0].replace("_", " ").replace("-", " ").strip() or "Imported exam"
    defaults = {
        "title": (title or "").strip() or stem[:120],
        "subject": (subject or "").strip() or "General",
        "duration_minutes": max(5, min(int(duration_minutes or 45), 300)),
        "exam_type": "SCHOOL",
        "is_published": True,
    }
    try:
        parsed = parse_cbt_file(file.filename or "", content, defaults)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not parsed:
        raise HTTPException(status_code=400, detail="No exams found in the file")

    created = []
    for item in parsed[:20]:  # sanity cap per upload
        qs = [q for q in (item.get("questions") or []) if q.get("question_text")]
        if not qs:
            continue
        try:
            start = datetime.fromisoformat(scheduled_start.replace("Z", "+00:00")) if scheduled_start else None
            end = datetime.fromisoformat(scheduled_end.replace("Z", "+00:00")) if scheduled_end else None
        except ValueError:
            start = end = None
        exam = CBTExam(
            title=(item.get("title") or "Untitled exam").strip(),
            subject=(item.get("subject") or "General").strip(),
            exam_type="SCHOOL",
            duration_minutes=max(5, min(int(item.get("duration_minutes") or defaults["duration_minutes"]), 300)),
            total_questions=len(qs),
            created_by=current_user["sub"],
            is_published=bool(item.get("is_published", True)),
            is_school_exam=True,
            school_id=campus.id,
            scheduled_start=start,
            scheduled_end=end,
            ai_locked=True,
            camera_required=False,
            block_minimize=True,
        )
        db.add(exam)
        await db.flush()
        for q in qs:
            opt = (q.get("correct_option") or "A").upper()[:1]
            if opt not in ("A", "B", "C", "D"):
                opt = "A"
            db.add(
                CBTQuestion(
                    exam_id=exam.id,
                    question_text=str(q.get("question_text"))[:2000],
                    option_a=str(q.get("option_a") or "")[:500],
                    option_b=str(q.get("option_b") or "")[:500],
                    option_c=str(q.get("option_c") or "")[:500],
                    option_d=str(q.get("option_d") or "")[:500],
                    correct_option=opt,
                    explanation=(str(q.get("explanation"))[:1000] if q.get("explanation") else None),
                )
            )
        created.append({"id": str(exam.id), "title": exam.title, "questions": len(qs)})
    if not created:
        raise HTTPException(status_code=400, detail="File parsed but contained no usable questions")
    await db.commit()
    return {"ok": True, "created": created, "count": len(created)}


@portal_router.post("/{slug}/exams/{exam_id}/document")
async def portal_attach_exam_document(
    slug: str,
    exam_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Attach ANY document type to an exam (PDF, DOCX, images, audio, video…).

    Students taking the exam on the site can open/download it. Stored in
    Cloudinary; the URL lives on the exam row.
    """
    from app.services.media_service import upload_file

    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    exam = (await db.execute(select(CBTExam).where(CBTExam.id == exam_id, CBTExam.school_id == campus.id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found in your school")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > 40 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 40MB)")
    try:
        result = upload_file(content, "school_exam_docs", filename=file.filename or "document")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")
    exam.notes_url = result.get("secure_url") or result.get("url")
    exam.notes_title = (file.filename or "document")[:255]
    await db.commit()
    return {"ok": True, "document_url": exam.notes_url, "document_name": exam.notes_title}


@portal_router.post("/{slug}/exams/{exam_id}/questions", status_code=201)
async def portal_add_exam_questions(
    slug: str,
    exam_id: str,
    payload: list[SchoolExamQuestionIn],
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Append typed questions to an existing school exam."""
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    exam = (await db.execute(select(CBTExam).where(CBTExam.id == exam_id, CBTExam.school_id == campus.id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found in your school")
    if not payload:
        raise HTTPException(status_code=400, detail="Add at least one question")
    for q in payload:
        opt = (q.correct_option or "A").upper()[:1]
        if opt not in ("A", "B", "C", "D"):
            opt = "A"
        db.add(
            CBTQuestion(
                exam_id=exam.id,
                question_text=q.question_text[:2000],
                option_a=q.option_a[:500],
                option_b=q.option_b[:500],
                option_c=q.option_c[:500],
                option_d=q.option_d[:500],
                correct_option=opt,
            )
        )
    exam.total_questions = (
        int((await db.execute(select(func.count(CBTQuestion.id)).where(CBTQuestion.exam_id == exam.id))).scalar() or 0)
    )
    await db.commit()
    return {"ok": True, "total_questions": exam.total_questions}


@portal_router.delete("/{slug}/exams/{exam_id}")
async def portal_delete_exam(
    slug: str,
    exam_id: str,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    exam = (await db.execute(select(CBTExam).where(CBTExam.id == exam_id, CBTExam.school_id == campus.id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found in your school")
    await db.execute(delete(CBTQuestion).where(CBTQuestion.exam_id == exam.id))
    await db.execute(delete(CBTSession).where(CBTSession.exam_id == exam.id))
    await db.execute(delete(CBTExam).where(CBTExam.id == exam.id))
    await db.commit()
    return {"ok": True}


@portal_router.delete("/{slug}/fees/{fee_id}")
async def portal_delete_fee(
    slug: str,
    fee_id: str,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    rows = [r for r in (getattr(campus, "portal_fees", None) or []) if r.get("id") != fee_id]
    campus.portal_fees = rows
    flag_modified(campus, "portal_fees")
    await db.commit()
    return {"ok": True, "fees": rows}


@portal_router.patch("/{slug}/fees/{fee_id}")
async def portal_update_fee(
    slug: str,
    fee_id: str,
    status: str = Query(..., description="paid | pending | overdue"),
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    if status not in ("paid", "pending", "overdue"):
        raise HTTPException(status_code=400, detail="status must be paid, pending or overdue")
    rows = list(getattr(campus, "portal_fees", None) or [])
    for r in rows:
        if r.get("id") == fee_id:
            r["status"] = status
            break
    campus.portal_fees = rows
    flag_modified(campus, "portal_fees")
    await db.commit()
    return {"ok": True, "fees": rows}


# ── Result upload (owner addition) ───────────────────────────────────────
# Same self-contained JSON pattern as portal_fees: each school's uploaded
# result sheets live on the campus row, keyed by class + subject + term.
# Reference flow: pick class → pick subject → upload/edit scores → save.

class ResultRowIn(BaseModel):
    student_name: str = Field(min_length=2, max_length=255)
    reg_number: str | None = Field(default=None, max_length=60)
    ca: float = Field(default=0, ge=0)          # continuous assessment
    exam: float = Field(default=0, ge=0)        # exam score
    mid_term: float = Field(default=0, ge=0)    # optional mid-term score
    remark: str | None = Field(default=None, max_length=120)
    # Optional per-category scores keyed by the school's result-template
    # categories (e.g. {"ca1": 9, "ca2": 8, "mid_term": 19, "end_term": 53}).
    scores: dict[str, float] | None = None


class ResultUploadIn(BaseModel):
    class_name: str = Field(min_length=1, max_length=60)
    subject: str = Field(min_length=1, max_length=120)
    term: str = Field(default="", max_length=40)
    session: str = Field(default="", max_length=40)
    max_score: float = Field(default=100, gt=0)
    rows: list[ResultRowIn] = []


def _grade_for(pct: float) -> str:
    try:
        from app.models.school_cbt import grade_from_percentage

        return grade_from_percentage(float(pct))
    except Exception:
        if pct >= 75:
            return "A1"
        if pct >= 70:
            return "B2"
        if pct >= 65:
            return "B3"
        if pct >= 60:
            return "C4"
        if pct >= 55:
            return "C5"
        if pct >= 50:
            return "C6"
        if pct >= 45:
            return "D7"
        if pct >= 40:
            return "E8"
        return "F9"


def _result_sheet_dict(sheet: dict) -> dict:
    """Public shape of one uploaded sheet."""
    return {
        "id": sheet.get("id"),
        "class_name": sheet.get("class_name"),
        "subject": sheet.get("subject"),
        "term": sheet.get("term") or "",
        "session": sheet.get("session") or "",
        "max_score": sheet.get("max_score") or 100,
        "uploaded_at": sheet.get("uploaded_at"),
        "count": len(sheet.get("rows") or []),
        "rows": sheet.get("rows") or [],
    }


@portal_router.get("/{slug}/results/upload")
async def portal_result_uploads(
    slug: str,
    class_name: Optional[str] = None,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Uploaded result sheets, optionally filtered to one class."""
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    sheets = list(getattr(campus, "portal_results", None) or [])
    if class_name:
        want = class_name.strip().upper()
        sheets = [s for s in sheets if str(s.get("class_name") or "").upper() == want]
    classes = sorted({str(s.get("class_name") or "").upper() for s in sheets if s.get("class_name")})
    return {"sheets": [_result_sheet_dict(s) for s in sheets], "classes": classes}


@portal_router.post("/{slug}/results/upload", status_code=201)
async def portal_upload_results(
    slug: str,
    payload: ResultUploadIn,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    """Upload (or replace) one class+subject+term result sheet. Rows carry
    CA + exam scores; totals, percentages and WAEC grades are computed
    server-side. Re-uploading the same class+subject+term+session replaces
    the previous sheet (results stay in the class's custody)."""
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    if not payload.rows:
        raise HTTPException(status_code=400, detail="Add at least one student score")

    max_total = float(payload.max_score or 100)
    rows = []
    for r in payload.rows[:300]:
        if r.scores:
            scores = {str(k).strip(): round(float(v or 0), 2) for k, v in r.scores.items()}
            total = round(sum(scores.values()), 2)
        else:
            scores = None
            total = round(float(r.ca or 0) + float(r.exam or 0) + float(r.mid_term or 0), 2)
        pct = round(100 * total / max_total, 1) if max_total else 0
        row = {
            "student_name": r.student_name.strip(),
            "reg_number": (r.reg_number or "").strip() or None,
            "ca": round(float(r.ca or 0), 2),
            "exam": round(float(r.exam or 0), 2),
            "total": total,
            "percentage": pct,
            "grade": _grade_for(pct),
        }
        if scores is not None:
            row["scores"] = scores
        elif r.mid_term:
            row["mid_term"] = round(float(r.mid_term), 2)
        if (r.remark or "").strip():
            row["remark"] = r.remark.strip()[:120]
        rows.append(row)

    sheets = list(getattr(campus, "portal_results", None) or [])
    key = (
        payload.class_name.strip().upper(),
        payload.subject.strip().lower(),
        (payload.term or "").strip().lower(),
        (payload.session or "").strip().lower(),
    )
    sheets = [s for s in sheets if (
        str(s.get("class_name") or "").upper(),
        str(s.get("subject") or "").lower(),
        str(s.get("term") or "").lower(),
        str(s.get("session") or "").lower(),
    ) != key]
    sheets.insert(
        0,
        {
            "id": secrets.token_hex(6),
            "class_name": payload.class_name.strip(),
            "subject": payload.subject.strip(),
            "term": (payload.term or "").strip(),
            "session": (payload.session or "").strip(),
            "max_score": max_total,
            "uploaded_at": naive_utc_now().date().isoformat(),
            "rows": rows,
        },
    )
    campus.portal_results = sheets[:200]
    flag_modified(campus, "portal_results")
    await db.commit()
    return {"ok": True, "sheet": _result_sheet_dict(sheets[0]), "sheets": [_result_sheet_dict(s) for s in sheets[:200]]}


@portal_router.delete("/{slug}/results/upload/{sheet_id}")
async def portal_delete_result_sheet(
    slug: str,
    sheet_id: str,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
):
    info = await portal_public_info(slug, db)
    campus = await _campus(db, current_user, info["school_id"])
    sheets = [s for s in (getattr(campus, "portal_results", None) or []) if s.get("id") != sheet_id]
    campus.portal_results = sheets
    flag_modified(campus, "portal_results")
    await db.commit()
    return {"ok": True}
