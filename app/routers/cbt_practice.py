"""CBT Settings admin + new practice attempt API (exam-type packages)."""
from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.core.datetime_utils import naive_utc_now
from app.core.deps import require_admin, require_student_or_cbt_guest, require_student_or_kind
from app.models.cbt import CBTExam
from app.models.cbt_settings import CbtPracticeAttempt
from app.models.user import StudentProfile
from app.services.cbt_access import has_board_access, normalize_board
from app.services import cbt_engine
from app.services.cbt_engine import get_cbt_settings

router = APIRouter(tags=["CBT settings & practice"])


class CbtSettingsUpdate(BaseModel):
    cbt_enabled: Optional[bool] = None
    jamb_questions_per_subject: Optional[int] = Field(None, ge=1, le=200)
    jamb_english_questions: Optional[int] = Field(None, ge=1, le=200)
    jamb_duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    jamb_subjects_required: Optional[int] = Field(None, ge=1, le=6)
    waec_questions_per_subject: Optional[int] = Field(None, ge=1, le=200)
    waec_duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    neco_questions_per_subject: Optional[int] = Field(None, ge=1, le=200)
    neco_duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    jw_questions_per_subject: Optional[int] = Field(None, ge=1, le=200)
    jw_duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    ce_questions_per_subject: Optional[int] = Field(None, ge=1, le=200)
    ce_duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    ce_subjects: Optional[list[str]] = None
    # Score scale (what scores are reported "over")
    jamb_score_total: Optional[int] = Field(None, ge=10, le=2000)
    waec_score_per_subject: Optional[int] = Field(None, ge=10, le=1000)
    neco_score_per_subject: Optional[int] = Field(None, ge=10, le=1000)
    jw_score_per_subject: Optional[int] = Field(None, ge=10, le=1000)
    ce_score_per_subject: Optional[int] = Field(None, ge=10, le=1000)
    score_messages: Optional[dict[str, str]] = None
    randomize_questions: Optional[bool] = None
    randomize_options: Optional[bool] = None
    allow_resume: Optional[bool] = None
    auto_submit_on_timeout: Optional[bool] = None


class StartPracticeRequest(BaseModel):
    exam_type: str
    subjects: list[str] = Field(default_factory=list)


class SaveAnswersRequest(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)
    section_index: Optional[int] = None


class SubmitPracticeRequest(BaseModel):
    answers: Optional[dict[str, str]] = None


@router.get("/admin/cbt-settings")
async def admin_get_cbt_settings(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    settings = await cbt_engine.get_cbt_settings(db)
    # Bank counts for admin visibility
    bank = await _bank_counts(db)
    return {"settings": settings, "question_bank": bank}


@router.put("/admin/cbt-settings")
async def admin_put_cbt_settings(
    payload: CbtSettingsUpdate,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump(exclude_unset=True)
    settings = await cbt_engine.update_cbt_settings(db, data)
    return {"settings": settings, "message": "CBT settings saved."}


async def _bank_counts(db: AsyncSession) -> list[dict[str, Any]]:
    exams = (
        await db.execute(
            select(CBTExam).where(
                CBTExam.is_published.is_(True),
                CBTExam.is_school_exam.is_(False),
                CBTExam.paper_kind == "cbt_practice",
            )
        )
    ).scalars().all()
    from app.models.cbt import CBTQuestion

    counts: dict[tuple[str, str], int] = {}
    for ex in exams:
        board = normalize_board(ex.exam_type)
        if board not in {"JAMB", "WAEC", "NECO", "COMMON_ENTRANCE", "JUNIOR_WAEC"}:
            continue
        n = (
            await db.execute(
                select(CBTQuestion.id).where(CBTQuestion.exam_id == ex.id)
            )
        ).scalars().all()
        key = (board, (ex.subject or "").strip())
        counts[key] = counts.get(key, 0) + len(n)
    return [
        {"exam_type": k[0], "subject": k[1], "total_questions": v}
        for k, v in sorted(counts.items())
    ]


@router.get("/cbt/practice/home")
async def practice_home(
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    """Exam-type first home: JAMB | WAEC | NECO with access + profile subjects."""
    sid = current_user["sub"]
    try:
        settings = await cbt_engine.get_cbt_settings(db)
    except Exception:
        settings = {
            "cbt_enabled": True,
            "jamb_subjects_required": 4,
            "jamb_duration_minutes": 60,
            "jamb_questions_per_subject": 40,
            "jamb_english_questions": 40,
            "waec_duration_minutes": 60,
            "neco_duration_minutes": 60,
        }

    jamb_subjects: list = []
    ssce_subjects: list = []
    ssce_exam = "WAEC"
    waec_subjects: list = []
    neco_subjects: list = []
    junior_subjects: list = []
    try:
        profile = (
            await db.execute(select(StudentProfile).where(StudentProfile.user_id == sid))
        ).scalar_one_or_none()
        if profile:
            jamb_subjects = list(getattr(profile, "jamb_subjects", None) or [])
            ssce_subjects = list(
                getattr(profile, "ssce_subjects", None)
                or getattr(profile, "selected_subjects", None)
                or []
            )
            ssce_exam = getattr(profile, "ssce_exam_type", None) or "WAEC"
            waec_subjects = list(getattr(profile, "waec_subjects", None) or [])
            neco_subjects = list(getattr(profile, "neco_subjects", None) or [])
            junior_subjects = list(getattr(profile, "junior_subjects", None) or [])
            # Legacy rows: fall back to ssce_subjects only when the board matches
            if not waec_subjects and (ssce_exam or "").upper() == "WAEC":
                waec_subjects = list(ssce_subjects)
            if not neco_subjects and (ssce_exam or "").upper() == "NECO":
                neco_subjects = list(ssce_subjects)
            if not junior_subjects and (ssce_exam or "").upper() == "JUNIOR_WAEC":
                junior_subjects = list(ssce_subjects)
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass

    ssce_started = False
    junior_started = False
    try:
        from app.models.cbt_settings import CbtPracticeAttempt

        row = (
            await db.execute(
                select(CbtPracticeAttempt.id)
                .where(
                    CbtPracticeAttempt.student_id == sid,
                    CbtPracticeAttempt.exam_type.in_(["WAEC", "NECO"]),
                )
                .limit(1)
            )
        ).first()
        ssce_started = row is not None
        jrow = (
            await db.execute(
                select(CbtPracticeAttempt.id)
                .where(
                    CbtPracticeAttempt.student_id == sid,
                    CbtPracticeAttempt.exam_type == "JUNIOR_WAEC",
                )
                .limit(1)
            )
        ).first()
        junior_started = jrow is not None
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        ssce_started = False
        junior_started = False

    async def board_block(board: str) -> dict:
        has = False
        if current_user.get("guest_cbt"):
            has = normalize_board(board) in current_user.get("guest_boards", [])
        else:
            try:
                has = await has_board_access(db, sid, board)
            except Exception:
                has = False
        return {
            "exam_type": board,
            "has_access": has,
            "package_id": board.lower(),
        }

    return {
        "settings": {
            "cbt_enabled": bool(settings.get("cbt_enabled", True)),
            "jamb_subjects_required": int(settings.get("jamb_subjects_required") or 4),
            "jamb_duration_minutes": int(settings.get("jamb_duration_minutes") or 60),
            "jamb_questions_per_subject": int(settings.get("jamb_questions_per_subject") or 40),
            "jamb_english_questions": int(settings.get("jamb_english_questions") or 40),
            "waec_duration_minutes": int(settings.get("waec_duration_minutes") or 60),
            "neco_duration_minutes": int(settings.get("neco_duration_minutes") or 60),
            "jw_duration_minutes": int(settings.get("jw_duration_minutes") or 60),
            "jw_questions_per_subject": int(settings.get("jw_questions_per_subject") or 60),
            "ce_duration_minutes": int(settings.get("ce_duration_minutes") or 60),
            "ce_questions_per_subject": int(settings.get("ce_questions_per_subject") or 40),
            "ce_subjects": list(settings.get("ce_subjects") or []),
        },
        "exam_types": [
            await board_block("JAMB"),
            await board_block("WAEC"),
            await board_block("NECO"),
            await board_block("JUNIOR_WAEC"),
        ],
        "profile": {
            "jamb_subjects": jamb_subjects,
            "ssce_subjects": ssce_subjects,
            "ssce_exam_type": ssce_exam,
            "ssce_started": ssce_started,
            "waec_subjects": waec_subjects,
            "neco_subjects": neco_subjects,
            "junior_subjects": junior_subjects,
            "junior_started": junior_started,
        },
    }


@router.get("/cbt/practice/settings")
async def practice_settings_public(
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    """Student-facing CBT settings used for preview (duration, question counts)."""
    settings = await cbt_engine.get_cbt_settings(db)
    return {
        "settings": {
            "cbt_enabled": bool(settings.get("cbt_enabled", True)),
            "jamb_subjects_required": int(settings.get("jamb_subjects_required") or 4),
            "jamb_duration_minutes": int(settings.get("jamb_duration_minutes") or 60),
            "jamb_questions_per_subject": int(settings.get("jamb_questions_per_subject") or 40),
            "jamb_english_questions": int(settings.get("jamb_english_questions") or 40),
            "waec_duration_minutes": int(settings.get("waec_duration_minutes") or 60),
            "waec_questions_per_subject": int(settings.get("waec_questions_per_subject") or 50),
            "neco_duration_minutes": int(settings.get("neco_duration_minutes") or 60),
            "neco_questions_per_subject": int(settings.get("neco_questions_per_subject") or 50),
            "jw_duration_minutes": int(settings.get("jw_duration_minutes") or 60),
            "jw_questions_per_subject": int(settings.get("jw_questions_per_subject") or 60),
            "ce_duration_minutes": int(settings.get("ce_duration_minutes") or 60),
            "ce_questions_per_subject": int(settings.get("ce_questions_per_subject") or 40),
            "ce_subjects": list(settings.get("ce_subjects") or []),
        }
    }


@router.post("/cbt/practice/register-subjects")
async def register_practice_subjects(
    payload: StartPracticeRequest,
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    """Register (and lock) subjects for a board WITHOUT starting an exam.
    WAEC/NECO: pick up to 9 subjects → CONTINUE. Later changes need admin approval
    via /cbt/subject-change-requests."""
    try:
        result = await cbt_engine.register_board_subjects(
            db,
            student_id=current_user["sub"],
            exam_type=payload.exam_type,
            subjects=payload.subjects,
        )
    except PermissionError as exc:
        if "SUBJECTS_LOCKED" in str(exc):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "subjects_locked",
                    "message": "Your subjects are locked. Send your admin a subject-change request.",
                },
            )
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.post("/cbt/practice/start")
async def start_practice(
    payload: StartPracticeRequest,
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    import logging

    log = logging.getLogger("cbt_practice")
    try:
        attempt = await cbt_engine.start_practice_attempt(
            db,
            student_id=current_user["sub"],
            exam_type=payload.exam_type,
            subjects=payload.subjects,
            guest_access_boards=current_user.get("guest_boards") if current_user.get("guest_cbt") else None,
        )
        await db.flush()
    except PermissionError:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "cbt_package_required",
                "board": normalize_board(payload.exam_type),
                "message": "CBT package required. Redeem a coupon or pay to unlock this exam type.",
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("practice start failed")
        try:
            await db.rollback()
        except Exception:
            pass
        raw = str(exc) or exc.__class__.__name__
        if "timeout" in raw.lower() or "canceling statement" in raw.lower():
            raise HTTPException(
                status_code=504,
                detail="Building the paper timed out. Tap Start again.",
            ) from exc
        raise HTTPException(
            status_code=500,
            detail=f"Could not build CBT paper: {raw[:220]}",
        ) from exc
    # Light payload: open exam UI immediately; questions load per subject
    return cbt_engine.attempt_client_dict(attempt, include_questions=False)


@router.get("/cbt/practice/attempts/{attempt_id}")
async def get_practice_attempt(
    attempt_id: str,
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    attempt = await _load_own_attempt(db, attempt_id, current_user["sub"])
    return cbt_engine.attempt_client_dict(attempt, include_questions=False)


@router.get("/cbt/practice/attempts/{attempt_id}/sections/{section_index}")
async def get_practice_section(
    attempt_id: str,
    section_index: int,
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    attempt = await _load_own_attempt(db, attempt_id, current_user["sub"])
    try:
        await cbt_engine.ensure_section_built(db, attempt, int(section_index))
        return cbt_engine.client_section_at(attempt.sections or [], int(section_index))
    except IndexError as exc:
        raise HTTPException(status_code=404, detail="Section not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raw = str(exc) or exc.__class__.__name__
        if "timeout" in raw.lower() or "canceling statement" in raw.lower():
            raise HTTPException(
                status_code=504,
                detail="Loading this subject timed out. Tap the subject again.",
            ) from exc
        raise HTTPException(
            status_code=500,
            detail=f"Could not load subject paper: {raw[:220]}",
        ) from exc


@router.post("/cbt/practice/attempts/{attempt_id}/offline-pack")
async def get_practice_offline_pack(
    attempt_id: str,
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    """Return this student's complete practice paper and key for encrypted offline scoring."""
    attempt = await _load_own_attempt(db, attempt_id, current_user["sub"])
    if attempt.status != "in_progress":
        raise HTTPException(status_code=400, detail="This practice attempt is no longer active")
    await cbt_engine.ensure_all_sections_built(db, attempt)
    return {
        "attempt_id": str(attempt.id),
        "exam_type": attempt.exam_type,
        "sections": [
            {
                "subject": sec.get("subject") or "Subject",
                "total": int(sec.get("total") or len(sec.get("questions") or [])),
                "questions": [
                    {
                        "id": q.get("id"),
                        "question_text": q.get("question_text") or "",
                        "options": q.get("options") or [],
                        "correct_key": (q.get("correct_key") or "").upper(),
                        "topic": q.get("topic"),
                        "image_url": q.get("image_url"),
                        "explanation": q.get("explanation") or "",
                    }
                    for q in sec.get("questions") or []
                ],
            }
            for sec in attempt.sections or []
        ],
    }


@router.post("/cbt/practice/attempts/{attempt_id}/answers")
async def save_practice_answers(
    attempt_id: str,
    payload: SaveAnswersRequest,
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    attempt = await _load_own_attempt(db, attempt_id, current_user["sub"])
    if attempt.status != "in_progress":
        raise HTTPException(status_code=400, detail="This attempt is already submitted")
    answers = dict(attempt.answers or {})
    answers.update({str(k): str(v).upper()[:1] for k, v in (payload.answers or {}).items()})
    attempt.answers = answers
    flag_modified(attempt, "answers")
    if payload.section_index is not None:
        attempt.section_index = max(0, int(payload.section_index))
    await db.flush()
    return {"ok": True, "answers": attempt.answers, "section_index": attempt.section_index}


@router.post("/cbt/practice/attempts/{attempt_id}/submit")
async def submit_practice(
    attempt_id: str,
    payload: SubmitPracticeRequest,
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    attempt = await _load_own_attempt(db, attempt_id, current_user["sub"])
    if attempt.status == "completed":
        answers = dict(attempt.answers or {})
        full_review = cbt_engine.build_practice_full_review(attempt.sections or [], answers)
        review = [q for q in full_review if not q.get("is_correct")]
        return {
            "attempt_id": str(attempt.id),
            "score": attempt.score,
            "max_score": attempt.max_score,
            "percent": round((attempt.score / attempt.max_score) * 100, 1)
            if attempt.max_score
            else 0,
            "result_summary": attempt.result_summary,
            "review": review,
            "full_review": full_review,
            "wrong_count": len(review),
        }

    answers = dict(attempt.answers or {})
    if payload.answers:
        answers.update({str(k): str(v).upper()[:1] for k, v in payload.answers.items()})
    attempt.answers = answers

    # Finish any subjects the student never opened so scoring uses full paper
    try:
        await cbt_engine.ensure_all_sections_built(db, attempt)
    except Exception:
        pass

    score = 0
    max_score = 0
    by_subject: dict[str, dict] = {}
    for sec in attempt.sections or []:
        sub = sec.get("subject") or "Subject"
        sub_score = 0
        sub_max = 0
        for q in sec.get("questions") or []:
            sub_max += 1
            max_score += 1
            qid = str(q.get("id"))
            if answers.get(qid) and answers.get(qid) == (q.get("correct_key") or "").upper():
                sub_score += 1
                score += 1
        by_subject[sub] = {"score": sub_score, "max": sub_max, "completed": True}
        sec["completed"] = True

    attempt.sections = attempt.sections
    flag_modified(attempt, "sections")
    attempt.answers = answers
    flag_modified(attempt, "answers")
    attempt.score = float(score)
    attempt.max_score = float(max_score)
    attempt.result_summary = {"by_subject": by_subject}
    attempt.status = "completed"
    attempt.submitted_at = naive_utc_now()
    await db.flush()

    # ── Percentage-scale result (e.g. JAMB over 400, WAEC over 100/subject) ──
    settings = await get_cbt_settings(db)
    scale = cbt_engine.board_score_scale(attempt.exam_type, settings)
    percent = round((score / max_score) * 100, 1) if max_score else 0
    if scale["combined"]:
        # One aggregated score over the configured total (JAMB: over 400).
        scaled_score = round(score / max_score * scale["total"], 1) if max_score else 0
        score_display = f"{scaled_score:g} / {scale['total']}"
        per_subject_scores = {
            sub: round(v["score"] / v["max"] * (scale["total"] / max(1, len(by_subject))), 1)
            if v["max"]
            else 0
            for sub, v in by_subject.items()
        }
    else:
        # Per-subject score over the configured maximum (e.g. 100).
        over = scale["total"]
        per_subject_scores = {
            sub: round(v["score"] / v["max"] * over, 1) if v["max"] else 0
            for sub, v in by_subject.items()
        }
        overall = round(sum(per_subject_scores.values()) / len(per_subject_scores), 1) if per_subject_scores else 0
        scaled_score = overall
        score_display = f"{overall:g} / {over} (average across subjects)"
    label, message = cbt_engine.rating_message(percent, settings.get("score_messages"))

    full_review = cbt_engine.build_practice_full_review(attempt.sections or [], answers)
    review = [q for q in full_review if not q.get("is_correct")]
    return {
        "attempt_id": str(attempt.id),
        "score": attempt.score,
        "max_score": attempt.max_score,
        "percent": percent,
        "rating": label,
        "rating_message": message,
        "score_scale": scale,
        "scaled_score": scaled_score,
        "score_display": score_display,
        "per_subject_scores": per_subject_scores,
        "result_summary": attempt.result_summary,
        "review": review,
        "full_review": full_review,
        "wrong_count": len(review),
    }


@router.get("/cbt/practice/attempts/{attempt_id}/review")
async def get_practice_review(
    attempt_id: str,
    current_user: dict = Depends(require_student_or_cbt_guest),
    db: AsyncSession = Depends(get_db),
):
    """Full answer key + explanations for a completed practice attempt."""
    attempt = await _load_own_attempt(db, attempt_id, current_user["sub"])
    if attempt.status != "completed":
        raise HTTPException(status_code=400, detail="Complete the exam before reviewing answers")
    answers = dict(attempt.answers or {})
    full_review = cbt_engine.build_practice_full_review(attempt.sections or [], answers)
    review = [q for q in full_review if not q.get("is_correct")]
    settings = await get_cbt_settings(db)
    scale = cbt_engine.board_score_scale(attempt.exam_type, settings)
    percent = round((attempt.score / attempt.max_score) * 100, 1) if attempt.max_score else 0
    label, message = cbt_engine.rating_message(percent, settings.get("score_messages"))
    return {
        "attempt_id": str(attempt.id),
        "exam_type": attempt.exam_type,
        "subjects": attempt.subjects or [],
        "score": attempt.score,
        "max_score": attempt.max_score,
        "percent": percent,
        "rating": label,
        "rating_message": message,
        "score_scale": scale,
        "full_review": full_review,
        "review": review,
        "wrong_count": len(review),
    }


async def _load_own_attempt(db: AsyncSession, attempt_id: str, student_id: str) -> CbtPracticeAttempt:
    try:
        aid = uuid.UUID(str(attempt_id))
        sid = uuid.UUID(str(student_id))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid attempt id") from exc
    attempt = (
        await db.execute(select(CbtPracticeAttempt).where(CbtPracticeAttempt.id == aid))
    ).scalar_one_or_none()
    if not attempt or attempt.student_id != sid:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return attempt
