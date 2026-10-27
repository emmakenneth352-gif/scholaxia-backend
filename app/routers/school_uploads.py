"""SCHOLAXIA — subject catalogue + guided question-bank uploads (Phase 1).

  /school-cbt/subjects/meta               levels + classes for the UI stepper
  /school-cbt/subjects                    list catalogue (global + own school)
  /school-cbt/subjects            POST    add custom subject (private, deduped)
  /school-cbt/subjects/{id}      PATCH   rename / activate (owner scope)
  /school-cbt/subjects/{id}/share POST    main admin shares a subject globally
  /school-cbt/subjects/offerings  PUT     enable/disable per level+class
  /school-cbt/bank-uploads/preview POST   parse file, validate, no DB writes
  /school-cbt/bank-uploads/confirm POST   atomic save into the bank

Access: main admin (any school via school_id), school_admin (own school),
approved teachers assigned to a school (own school only). One school can
never see or touch another school's private subjects or banks.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import _norm_role, get_current_user
from app.models.school_cbt import SchoolExQuestion, SchoolExQuestionBank
from app.models.school_subjects import (
    LEVEL_CLASSES,
    SUBJECT_LEVELS,
    SchoolSubject,
    SchoolSubjectOffering,
    normalize_class_name,
    normalize_subject_name,
)

router = APIRouter(prefix="/school-cbt", tags=["School Uploads"])


# ── scope helpers ──────────────────────────────────────────────────────────
async def _teacher_school_id(db: AsyncSession, user_sub: str) -> Optional[UUID]:
    from app.models.user import TeacherProfile

    try:
        uid = UUID(str(user_sub))
    except ValueError:
        return None
    prof = (
        await db.execute(select(TeacherProfile).where(TeacherProfile.user_id == uid))
    ).scalars().first()
    if not prof or not getattr(prof, "is_approved", False):
        return None
    return getattr(prof, "school_id", None)


async def _upload_scope(
    current_user: dict,
    db: AsyncSession,
    school_id: Optional[str] = None,
    *,
    need_school: bool = True,
) -> Optional[UUID]:
    """Return the school this caller may act on, or raise 403/400."""
    role = _norm_role(current_user.get("role"))
    if role == "admin":
        if school_id:
            try:
                return UUID(str(school_id))
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid school id")
        if need_school:
            raise HTTPException(status_code=400, detail="Select a school first")
        return None
    if role == "school_admin":
        sid = current_user.get("school_id")
        if not sid:
            raise HTTPException(status_code=403, detail="Admin is not assigned to a school yet")
        return UUID(str(sid))
    if role == "teacher":
        sid = await _teacher_school_id(db, current_user.get("sub"))
        if not sid:
            raise HTTPException(
                status_code=403,
                detail="Only teachers assigned to a school can upload questions",
            )
        return sid
    raise HTTPException(status_code=403, detail="Not allowed")


def _subject_row(s: SchoolSubject, classes_by_level: dict) -> dict:
    levels = sorted(classes_by_level.keys())
    return {
        "id": str(s.id),
        "name": s.name,
        "is_custom": bool(s.is_custom),
        "is_active": bool(s.is_active),
        "scope": "school" if s.school_id else "global",
        "levels": levels,
        "classes_by_level": classes_by_level,
    }


# ── catalogue ──────────────────────────────────────────────────────────────
@router.get("/subjects/meta")
async def subjects_meta():
    """Static stepper data: levels with their exact class lists."""
    return {
        "levels": [
            {"id": lvl, "label": {"primary": "Primary School", "jss": "Junior Secondary School", "sss": "Senior Secondary School"}[lvl], "classes": LEVEL_CLASSES[lvl]}
            for lvl in SUBJECT_LEVELS
        ]
    }


@router.get("/subjects")
async def list_subjects(
    level: Optional[str] = Query(None),
    class_name: Optional[str] = Query(None),
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sid = await _upload_scope(current_user, db, school_id, need_school=False)
    if level and level not in SUBJECT_LEVELS:
        raise HTTPException(status_code=400, detail="Unknown school level")

    subs = (
        await db.execute(
            select(SchoolSubject).where(
                (SchoolSubject.school_id.is_(None)) if sid is None else ((SchoolSubject.school_id.is_(None)) | (SchoolSubject.school_id == sid)),
            )
        )
    ).scalars().all()
    offs = (
        await db.execute(
            select(SchoolSubjectOffering).where(
                (SchoolSubjectOffering.school_id.is_(None)) if sid is None else ((SchoolSubjectOffering.school_id.is_(None)) | (SchoolSubjectOffering.school_id == sid)),
            )
        )
    ).scalars().all()

    # school overrides win over global defaults
    merged: dict[tuple, SchoolSubjectOffering] = {}
    for o in offs:
        key = (o.subject_id, o.level, normalize_class_name(o.class_name))
        prev = merged.get(key)
        if prev is None or (prev.school_id is None and o.school_id is not None):
            merged[key] = o

    out = []
    want_cls = normalize_class_name(class_name) if class_name else None
    for s in sorted(subs, key=lambda x: x.name.lower()):
        by_level: dict[str, list[str]] = {}
        for (sub_id, lvl, cls_norm), o in merged.items():
            if sub_id != s.id or not o.is_enabled:
                continue
            if level and lvl != level:
                continue
            if want_cls and cls_norm != want_cls:
                continue
            by_level.setdefault(lvl, []).append(o.class_name)
        if level and level not in by_level:
            continue
        if class_name and not by_level:
            continue
        for v in by_level.values():
            v.sort(key=lambda c: (LEVEL_CLASSES.get(level or "", []) or [c]).index(c) if c in (LEVEL_CLASSES.get(level or "", [])) else c)
        out.append(_subject_row(s, by_level))
    return {"subjects": out}


class SubjectCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    level: str
    class_names: list[str] = Field(min_length=1)


@router.post("/subjects", status_code=201)
async def create_custom_subject(
    payload: SubjectCreateIn,
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sid = await _upload_scope(current_user, db, school_id)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Subject name is required")
    if payload.level not in SUBJECT_LEVELS:
        raise HTTPException(status_code=400, detail="Unknown school level")
    allowed = {normalize_class_name(c) for c in LEVEL_CLASSES[payload.level]}
    classes = []
    for c in payload.class_names:
        n = normalize_class_name(c)
        if n not in allowed:
            raise HTTPException(status_code=400, detail=f"Class {c!r} is not in this school level")
        if c not in classes:
            classes.append(c)
    if not classes:
        raise HTTPException(status_code=400, detail="Pick at least one class")

    norm = normalize_subject_name(name)
    existing = (
        await db.execute(
            select(SchoolSubject).where(
                SchoolSubject.normalized == norm,
                ((SchoolSubject.school_id.is_(None)) | (SchoolSubject.school_id == sid)),
            )
        )
    ).scalars().all()
    # reuse global first, then own-school private (never another school's)
    subj = next((s for s in existing if s.school_id is None), None) or next(
        (s for s in existing if s.school_id == sid), None
    )
    reused = subj is not None
    if subj is None:
        subj = SchoolSubject(name=name, normalized=norm, school_id=sid, is_custom=True)
        db.add(subj)
        await db.flush()

    # ensure offerings enabled for the requested classes (school override)
    for c in classes:
        row = (
            await db.execute(
                select(SchoolSubjectOffering).where(
                    SchoolSubjectOffering.subject_id == subj.id,
                    SchoolSubjectOffering.school_id == sid,
                    SchoolSubjectOffering.level == payload.level,
                    SchoolSubjectOffering.class_name == c,
                )
            )
        ).scalars().first()
        if row is None:
            db.add(
                SchoolSubjectOffering(
                    subject_id=subj.id,
                    school_id=sid,
                    level=payload.level,
                    class_name=c,
                    is_enabled=True,
                )
            )
        elif not row.is_enabled:
            row.is_enabled = True
    await db.flush()

    by_level: dict[str, list[str]] = {}
    rows = (
        await db.execute(
            select(SchoolSubjectOffering).where(
                SchoolSubjectOffering.subject_id == subj.id,
                ((SchoolSubjectOffering.school_id.is_(None)) | (SchoolSubjectOffering.school_id == sid)),
                SchoolSubjectOffering.is_enabled.is_(True),
            )
        )
    ).scalars().all()
    for o in rows:
        by_level.setdefault(o.level, [])
        if o.class_name not in by_level[o.level]:
            by_level[o.level].append(o.class_name)
    return {"reused": reused, "subject": _subject_row(subj, by_level)}


class SubjectPatchIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    is_active: Optional[bool] = None


@router.patch("/subjects/{subject_id}")
async def patch_subject(
    subject_id: str,
    payload: SubjectPatchIn,
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = _norm_role(current_user.get("role"))
    sid = await _upload_scope(current_user, db, school_id, need_school=False)
    try:
        sub_id = UUID(str(subject_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Subject not found")
    subj = (await db.execute(select(SchoolSubject).where(SchoolSubject.id == sub_id))).scalar_one_or_none()
    if not subj:
        raise HTTPException(status_code=404, detail="Subject not found")
    if subj.school_id is None and role != "admin":
        raise HTTPException(status_code=403, detail="Only the main admin can change global subjects")
    if subj.school_id is not None and subj.school_id != sid and role != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")
    if payload.name is not None:
        nm = payload.name.strip()
        if len(nm) < 2:
            raise HTTPException(status_code=400, detail="Subject name is too short")
        # rename must not collide within scope
        clash = (
            await db.execute(
                select(SchoolSubject).where(
                    SchoolSubject.id != subj.id,
                    SchoolSubject.normalized == normalize_subject_name(nm),
                    (SchoolSubject.school_id.is_(None))
                    if subj.school_id is None
                    else (SchoolSubject.school_id == subj.school_id),
                )
            )
        ).scalars().first()
        if clash:
            raise HTTPException(status_code=400, detail="A subject with that name already exists")
        subj.name = nm
        subj.normalized = normalize_subject_name(nm)
    if payload.is_active is not None:
        subj.is_active = bool(payload.is_active)
    await db.flush()
    return {"ok": True, "subject": _subject_row(subj, {})}


@router.post("/subjects/{subject_id}/share")
async def share_subject_globally(
    subject_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if _norm_role(current_user.get("role")) != "admin":
        raise HTTPException(status_code=403, detail="Main admin only")
    try:
        sub_id = UUID(str(subject_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Subject not found")
    subj = (await db.execute(select(SchoolSubject).where(SchoolSubject.id == sub_id))).scalar_one_or_none()
    if not subj:
        raise HTTPException(status_code=404, detail="Subject not found")
    if subj.school_id is None:
        return {"ok": True, "shared": False, "reason": "already global"}
    glob = (
        await db.execute(
            select(SchoolSubject).where(
                SchoolSubject.school_id.is_(None), SchoolSubject.normalized == subj.normalized
            )
        )
    ).scalars().first()
    if glob is None:
        glob = SchoolSubject(name=subj.name, normalized=subj.normalized, school_id=None)
        db.add(glob)
        await db.flush()
        # copy the school's offerings as global defaults
        for o in (
            await db.execute(
                select(SchoolSubjectOffering).where(
                    SchoolSubjectOffering.subject_id == subj.id,
                    SchoolSubjectOffering.school_id == subj.school_id,
                    SchoolSubjectOffering.is_enabled.is_(True),
                )
            )
        ).scalars().all():
            db.add(
                SchoolSubjectOffering(
                    subject_id=glob.id, school_id=None, level=o.level, class_name=o.class_name, is_enabled=True
                )
            )
        await db.flush()
    return {"ok": True, "shared": True, "subject_id": str(glob.id)}


class OfferingsPutIn(BaseModel):
    subject_id: str
    school_id: Optional[str] = None
    items: list[dict] = Field(min_length=1)  # [{level, class_name, is_enabled}]


@router.put("/subjects/offerings")
async def put_offerings(
    payload: OfferingsPutIn,
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = _norm_role(current_user.get("role"))
    target_school = payload.school_id or school_id
    if role == "admin" and not target_school:
        scope_sid = None  # configuring global defaults
    else:
        scope_sid = await _upload_scope(current_user, db, target_school)
    try:
        sub_id = UUID(str(payload.subject_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Subject not found")
    subj = (await db.execute(select(SchoolSubject).where(SchoolSubject.id == sub_id))).scalar_one_or_none()
    if not subj:
        raise HTTPException(status_code=404, detail="Subject not found")
    if subj.school_id is not None and scope_sid != subj.school_id and role != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")
    if subj.school_id is None and scope_sid is not None and role != "admin":
        # school staff may only override (disable/enable), handled via override rows
        pass
    for it in payload.items:
        lvl, cls = it.get("level"), normalize_class_name(it.get("class_name") or "")
        if lvl not in SUBJECT_LEVELS or not cls:
            raise HTTPException(status_code=400, detail="Each item needs a valid level and class_name")
        row = (
            await db.execute(
                select(SchoolSubjectOffering).where(
                    SchoolSubjectOffering.subject_id == sub_id,
                    (SchoolSubjectOffering.school_id.is_(None))
                    if scope_sid is None
                    else (SchoolSubjectOffering.school_id == scope_sid),
                    SchoolSubjectOffering.level == lvl,
                    SchoolSubjectOffering.class_name == it.get("class_name"),
                )
            )
        ).scalars().first()
        enabled = bool(it.get("is_enabled", True))
        if row is None:
            if scope_sid is None and role != "admin":
                raise HTTPException(status_code=403, detail="Main admin only can add global classes")
            db.add(
                SchoolSubjectOffering(
                    subject_id=sub_id, school_id=scope_sid, level=lvl,
                    class_name=it.get("class_name"), is_enabled=enabled,
                )
            )
        else:
            row.is_enabled = enabled
    await db.flush()
    return {"ok": True}


# ── upload preview + confirm ───────────────────────────────────────────────
async def _load_subject_for_school(db: AsyncSession, subject_id: str, sid: UUID) -> SchoolSubject:
    try:
        sub_id = UUID(str(subject_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Subject not found")
    subj = (await db.execute(select(SchoolSubject).where(SchoolSubject.id == sub_id))).scalar_one_or_none()
    if not subj or not subj.is_active:
        raise HTTPException(status_code=404, detail="Subject not found")
    if subj.school_id is not None and subj.school_id != sid:
        raise HTTPException(status_code=403, detail="Subject belongs to another school")
    return subj


def _offering_enabled(db_rows: list, subj_id, level: str, class_name: str, sid: UUID) -> bool:
    want = normalize_class_name(class_name)
    best = None
    for o in db_rows:
        if o.subject_id != subj_id or o.level != level:
            continue
        if normalize_class_name(o.class_name) != want:
            continue
        if best is None or (best.school_id is None and o.school_id is not None):
            best = o
    return bool(best and best.is_enabled)


@router.post("/bank-uploads/preview")
async def preview_bank_upload(
    file: UploadFile = File(...),
    level: str = Form(...),
    class_name: str = Form(...),
    subject_id: str = Form(...),
    school_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sid = await _upload_scope(current_user, db, school_id)
    if level not in SUBJECT_LEVELS:
        raise HTTPException(status_code=400, detail="Pick a valid school level")
    if normalize_class_name(class_name) not in {normalize_class_name(c) for c in LEVEL_CLASSES[level]}:
        raise HTTPException(status_code=400, detail="Class does not belong to this school level")
    subj = await _load_subject_for_school(db, subject_id, sid)
    offs = (
        await db.execute(
            select(SchoolSubjectOffering).where(
                SchoolSubjectOffering.subject_id == subj.id,
                ((SchoolSubjectOffering.school_id.is_(None)) | (SchoolSubjectOffering.school_id == sid)),
            )
        )
    ).scalars().all()
    if not _offering_enabled(offs, subj.id, level, class_name, sid):
        raise HTTPException(status_code=400, detail=f"{subj.name} is not offered in {class_name}")

    from app.services.school_upload_parse import FORMAT_GUIDANCE, parse_upload_file
    from app.services.cbt_bank_import import normalize_question_text

    content = await file.read()
    try:
        parsed = parse_upload_file(file.filename or "upload", content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # duplicates already in this school's bank for the same subject+class
    bank = (
        await db.execute(
            select(SchoolExQuestionBank).where(
                SchoolExQuestionBank.school_id == sid,
                func.lower(SchoolExQuestionBank.subject) == subj.name.lower(),
                func.upper(func.replace(SchoolExQuestionBank.class_name, " ", "")) == normalize_class_name(class_name).upper(),
            )
        )
    ).scalars().first()
    bank_norms: set[str] = set()
    if bank is not None:
        existing = (
            await db.execute(select(SchoolExQuestion.question_text).where(SchoolExQuestion.bank_id == bank.id))
        ).scalars().all()
        bank_norms = {n for n in (normalize_question_text(t) for t in existing) if n}

    seen: set[str] = set()
    questions = []
    valid = needs_review = dup_file = dup_bank = 0
    for raw in parsed["questions"]:
        q = dict(raw)
        norm = normalize_question_text(q.get("question_text"))
        q["in_file_duplicate"] = bool(norm and norm in seen)
        if norm:
            seen.add(norm)
        q["in_bank_duplicate"] = bool(norm and norm in bank_norms)
        q["needs_review"] = bool(q.get("issues")) or q["in_file_duplicate"] or q["in_bank_duplicate"]
        q["is_valid"] = not q.get("issues")
        if q["in_file_duplicate"]:
            dup_file += 1
        if q["in_bank_duplicate"]:
            dup_bank += 1
        if not q.get("issues"):
            valid += 1
        else:
            needs_review += 1
        questions.append(q)
    return {
        "subject": {"id": str(subj.id), "name": subj.name},
        "level": level,
        "class_name": class_name,
        "bank_id": str(bank.id) if bank else None,
        "bank_name": bank.name if bank else f"{subj.name} {class_name} Bank",
        "source": parsed["source"],
        "warnings": parsed.get("warnings") or [],
        "format_guidance": FORMAT_GUIDANCE.get(parsed["source"], ""),
        "total_questions": len(questions),
        "valid_count": valid,
        "needs_review_count": needs_review,
        "duplicate_in_file": dup_file,
        "duplicate_in_bank": dup_bank,
        "questions": questions,
    }


class BankUploadConfirmIn(BaseModel):
    subject_id: str
    level: str
    class_name: str
    questions: list[dict] = Field(min_length=1, max_length=500)
    import_mode: str = "skip_duplicates"
    topic_default: Optional[str] = None
    marks_default: int = 1
    school_id: Optional[str] = None


@router.post("/bank-uploads/confirm", status_code=201)
async def confirm_bank_upload(
    payload: BankUploadConfirmIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.cbt_bank_import import normalize_question_text
    from app.services.school_upload_parse import MAX_QUESTIONS, normalize_upload_row

    sid = await _upload_scope(current_user, db, payload.school_id)
    if payload.level not in SUBJECT_LEVELS:
        raise HTTPException(status_code=400, detail="Pick a valid school level")
    if normalize_class_name(payload.class_name) not in {normalize_class_name(c) for c in LEVEL_CLASSES[payload.level]}:
        raise HTTPException(status_code=400, detail="Class does not belong to this school level")
    subj = await _load_subject_for_school(db, payload.subject_id, sid)
    mode = (payload.import_mode or "skip_duplicates").lower()
    if mode not in ("skip_duplicates", "all"):
        raise HTTPException(status_code=400, detail="import_mode must be skip_duplicates or all")

    # re-validate every row server-side — never trust the preview payload
    clean: list[dict] = []
    skipped_invalid: list[dict] = []
    for i, raw in enumerate(payload.questions, start=1):
        q = normalize_upload_row(raw if isinstance(raw, dict) else {}, i)
        if q.get("question_text") and not q.get("issues"):
            clean.append(q)
        else:
            skipped_invalid.append({"number": i, "issues": q.get("issues") or ["missing question text"]})
    if not clean:
        raise HTTPException(status_code=400, detail="No valid questions to save. Fix the flagged rows and try again.")

    try:
        cls_norm = normalize_class_name(payload.class_name)
        bank = (
            await db.execute(
                select(SchoolExQuestionBank).where(
                    SchoolExQuestionBank.school_id == sid,
                    func.lower(SchoolExQuestionBank.subject) == subj.name.lower(),
                    func.upper(func.replace(SchoolExQuestionBank.class_name, " ", "")) == cls_norm.upper(),
                )
            )
        ).scalars().first()
        if bank is None:
            try:
                creator = UUID(str(current_user.get("sub")))
            except (ValueError, TypeError):
                creator = None
            bank = SchoolExQuestionBank(
                school_id=sid,
                name=f"{subj.name} {payload.class_name} Bank",
                subject=subj.name,
                class_name=payload.class_name.strip().upper(),
                school_level=payload.level,
                created_by=creator,
            )
            db.add(bank)
            await db.flush()
        elif not bank.school_level:
            bank.school_level = payload.level

        existing_norms: set[str] = set()
        for (text,) in (await db.execute(select(SchoolExQuestion.question_text).where(SchoolExQuestion.bank_id == bank.id))).all():
            n = normalize_question_text(text)
            if n:
                existing_norms.add(n)

        inserted = skipped_dup = 0
        seen_file: set[str] = set()
        topic_default = (payload.topic_default or "").strip() or None
        marks_default = max(1, min(int(payload.marks_default or 1), 100))
        for q in clean:
            norm = normalize_question_text(q.get("question_text"))
            if norm and (norm in seen_file or (mode == "skip_duplicates" and norm in existing_norms)):
                skipped_dup += 1
                continue
            if norm:
                seen_file.add(norm)
                existing_norms.add(norm)
            db.add(
                SchoolExQuestion(
                    school_id=sid,
                    bank_id=bank.id,
                    question_text=q["question_text"].strip()[:4000],
                    option_a=(q.get("option_a") or "").strip()[:1000],
                    option_b=(q.get("option_b") or "").strip()[:1000],
                    option_c=(q.get("option_c") or "").strip()[:1000],
                    option_d=(q.get("option_d") or "").strip()[:1000],
                    correct_option=(q.get("correct_option") or "A").strip().upper()[:12] or "A",
                    question_type=q.get("question_type") or "mcq",
                    topic=(q.get("topic") or "").strip() or topic_default,
                    marks=int(q.get("marks") or marks_default),
                    explanation=(q.get("explanation") or "").strip() or None,
                )
            )
            inserted += 1
        await db.flush()
        total = (await db.execute(select(func.count(SchoolExQuestion.id)).where(SchoolExQuestion.bank_id == bank.id))).scalar_one()
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Upload failed and nothing was saved: {exc}")
    return {
        "ok": True,
        "bank_id": str(bank.id),
        "bank_name": bank.name,
        "inserted": inserted,
        "skipped_duplicate": skipped_dup,
        "skipped_invalid": skipped_invalid,
        "bank_total": int(total or 0),
    }
