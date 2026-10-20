"""CBT practice engine: global settings + random selection from question bank."""
from __future__ import annotations

import random
import re
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import engine
from app.core.datetime_utils import naive_utc_now
from app.models.cbt import CBTExam, CBTQuestion
from app.models.cbt_settings import CbtGlobalSettings, CbtPracticeAttempt
from app.services.cbt_access import has_board_access, normalize_board

import logging

logger = logging.getLogger(__name__)

DEFAULT_SETTINGS = {
    "cbt_enabled": True,
    "jamb_questions_per_subject": 40,
    "jamb_english_questions": 60,
    "jamb_duration_minutes": 180,
    "jamb_subjects_required": 4,
    "waec_questions_per_subject": 50,
    "waec_duration_minutes": 60,
    "neco_questions_per_subject": 50,
    "neco_duration_minutes": 60,
    "jw_questions_per_subject": 60,
    "jw_duration_minutes": 60,
    "ce_questions_per_subject": 40,
    "ce_duration_minutes": 60,
    "ce_subjects": [
        "Mathematics / Quantitative Reasoning",
        "English Language / Verbal Reasoning",
        "General Knowledge",
    ],
    # Score scale — what each score is reported "over" (JAMB = combined 400;
    # WAEC/NECO/JW/CE report each subject over 100).
    "jamb_score_total": 400,
    "waec_score_per_subject": 100,
    "neco_score_per_subject": 100,
    "jw_score_per_subject": 100,
    "ce_score_per_subject": 100,
    "score_messages": None,
    "randomize_questions": True,
    "randomize_options": True,
    # Resume OFF by default: leaving and coming back hands out a freshly
    # randomised paper (what students expect from practice). Admins can turn
    # resume on in CBT Settings to keep the mid-exam paper + progress.
    "allow_resume": False,
    "auto_submit_on_timeout": True,
}

ENGLISH_ALIASES = {
    "english",
    "english language",
    "use of english",
    "english language (use of english)",
}

# AI chat junk that ended up inside imported bank options (e.g. a whole Sia
# reply pasted as option C). Real exam options never look like this.
_JUNK_OPTION_RE = re.compile(
    r"(you have now completed|do you want me to continue|questions? part \d|"
    r"i can continue|continue \S+ questions|part \(\d+[-–]\d+\))",
    re.IGNORECASE,
)
_MAX_OPTION_LEN = 240


def _question_has_junk(q: CBTQuestion) -> bool:
    if _JUNK_OPTION_RE.search((q.question_text or "")):
        return True
    for text in (q.option_a, q.option_b, q.option_c, q.option_d):
        t = (text or "").strip()
        if not t:
            continue
        if len(t) > _MAX_OPTION_LEN or _JUNK_OPTION_RE.search(t):
            return True
    return False


async def ensure_cbt_settings_schema() -> None:
    stmts = (
        """
        CREATE TABLE IF NOT EXISTS cbt_global_settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            cbt_enabled BOOLEAN DEFAULT TRUE,
            jamb_questions_per_subject INTEGER DEFAULT 40,
            jamb_english_questions INTEGER DEFAULT 60,
            jamb_duration_minutes INTEGER DEFAULT 180,
            jamb_subjects_required INTEGER DEFAULT 4,
            waec_questions_per_subject INTEGER DEFAULT 50,
            waec_duration_minutes INTEGER DEFAULT 60,
            neco_questions_per_subject INTEGER DEFAULT 50,
            neco_duration_minutes INTEGER DEFAULT 60,
            jw_questions_per_subject INTEGER DEFAULT 60,
            jw_duration_minutes INTEGER DEFAULT 60,
            ce_questions_per_subject INTEGER DEFAULT 40,
            ce_duration_minutes INTEGER DEFAULT 60,
            ce_subjects JSON DEFAULT NULL,
            jamb_score_total INTEGER DEFAULT 400,
            waec_score_per_subject INTEGER DEFAULT 100,
            neco_score_per_subject INTEGER DEFAULT 100,
            jw_score_per_subject INTEGER DEFAULT 100,
            ce_score_per_subject INTEGER DEFAULT 100,
            score_messages JSON DEFAULT NULL,
            randomize_questions BOOLEAN DEFAULT TRUE,
            randomize_options BOOLEAN DEFAULT TRUE,
            allow_resume BOOLEAN DEFAULT FALSE,
            auto_submit_on_timeout BOOLEAN DEFAULT TRUE,
            updated_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS jw_questions_per_subject INTEGER DEFAULT 60",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS jw_duration_minutes INTEGER DEFAULT 60",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS ce_questions_per_subject INTEGER DEFAULT 40",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS ce_duration_minutes INTEGER DEFAULT 60",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS ce_subjects JSON DEFAULT NULL",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS jamb_score_total INTEGER DEFAULT 400",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS waec_score_per_subject INTEGER DEFAULT 100",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS neco_score_per_subject INTEGER DEFAULT 100",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS jw_score_per_subject INTEGER DEFAULT 100",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS ce_score_per_subject INTEGER DEFAULT 100",
        "ALTER TABLE cbt_global_settings ADD COLUMN IF NOT EXISTS score_messages JSON DEFAULT NULL",
        "ALTER TABLE cbt_global_settings ALTER COLUMN allow_resume SET DEFAULT FALSE",
        # One-time flip for existing deployments: fresh questions on return
        # (the owner asked for this behaviour; admins can re-enable resume).
        "UPDATE cbt_global_settings SET allow_resume = FALSE WHERE allow_resume IS TRUE",
        """
        CREATE TABLE IF NOT EXISTS cbt_practice_attempts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id UUID NOT NULL,
            exam_type VARCHAR(30) NOT NULL,
            subjects JSON NOT NULL DEFAULT '[]',
            sections JSON NOT NULL DEFAULT '[]',
            answers JSON NULL,
            status VARCHAR(30) DEFAULT 'in_progress',
            section_index INTEGER DEFAULT 0,
            duration_minutes INTEGER NOT NULL,
            started_at TIMESTAMP DEFAULT NOW(),
            ends_at TIMESTAMP NULL,
            submitted_at TIMESTAMP NULL,
            score DOUBLE PRECISION NULL,
            max_score DOUBLE PRECISION NULL,
            result_summary JSON NULL,
            notes TEXT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_cbt_practice_attempts_student_id ON cbt_practice_attempts (student_id)",
        "CREATE INDEX IF NOT EXISTS ix_cbt_practice_attempts_exam_type ON cbt_practice_attempts (exam_type)",
        "CREATE INDEX IF NOT EXISTS ix_cbt_practice_attempts_status ON cbt_practice_attempts (status)",
    )
    try:
        async with engine.begin() as conn:
            for stmt in stmts:
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    logger.warning("cbt settings schema stmt skipped: %s", exc)
            # Seed singleton settings row
            try:
                await conn.execute(
                    text(
                        """
                        INSERT INTO cbt_global_settings (id) VALUES (1)
                        ON CONFLICT (id) DO NOTHING
                        """
                    )
                )
            except Exception as exc:
                logger.warning("cbt settings seed skipped: %s", exc)
    except Exception as exc:
        logger.warning("ensure_cbt_settings_schema failed: %s", exc)


def _default_ce_subjects() -> list[str]:
    return list(DEFAULT_SETTINGS["ce_subjects"])


def _normalize_ce_subjects(raw) -> list[str]:
    if raw is None:
        return _default_ce_subjects()
    if isinstance(raw, str):
        # Allow newline- or comma-separated admin input
        parts = [p.strip() for p in raw.replace("\n", ",").split(",")]
        out = [p for p in parts if p]
        return out or _default_ce_subjects()
    if isinstance(raw, (list, tuple)):
        out = [str(s).strip() for s in raw if str(s).strip()]
        return out or _default_ce_subjects()
    return _default_ce_subjects()


def settings_to_dict(row: CbtGlobalSettings | None) -> dict[str, Any]:
    if not row:
        return dict(DEFAULT_SETTINGS)
    return {
        "cbt_enabled": bool(row.cbt_enabled),
        "jamb_questions_per_subject": int(row.jamb_questions_per_subject or 40),
        "jamb_english_questions": int(row.jamb_english_questions or 60),
        "jamb_duration_minutes": int(row.jamb_duration_minutes or 180),
        "jamb_subjects_required": int(row.jamb_subjects_required or 4),
        "waec_questions_per_subject": int(row.waec_questions_per_subject or 50),
        "waec_duration_minutes": int(row.waec_duration_minutes or 60),
        "neco_questions_per_subject": int(row.neco_questions_per_subject or 50),
        "neco_duration_minutes": int(row.neco_duration_minutes or 60),
        "jw_questions_per_subject": int(getattr(row, "jw_questions_per_subject", None) or 60),
        "jw_duration_minutes": int(getattr(row, "jw_duration_minutes", None) or 60),
        "ce_questions_per_subject": int(getattr(row, "ce_questions_per_subject", None) or 40),
        "ce_duration_minutes": int(getattr(row, "ce_duration_minutes", None) or 60),
        "ce_subjects": _normalize_ce_subjects(getattr(row, "ce_subjects", None)),
        "jamb_score_total": int(getattr(row, "jamb_score_total", None) or 400),
        "waec_score_per_subject": int(getattr(row, "waec_score_per_subject", None) or 100),
        "neco_score_per_subject": int(getattr(row, "neco_score_per_subject", None) or 100),
        "jw_score_per_subject": int(getattr(row, "jw_score_per_subject", None) or 100),
        "ce_score_per_subject": int(getattr(row, "ce_score_per_subject", None) or 100),
        "score_messages": getattr(row, "score_messages", None) or None,
        "randomize_questions": bool(row.randomize_questions if row.randomize_questions is not None else True),
        "randomize_options": bool(row.randomize_options if row.randomize_options is not None else True),
        "allow_resume": bool(row.allow_resume if row.allow_resume is not None else False),
        "auto_submit_on_timeout": bool(
            row.auto_submit_on_timeout if row.auto_submit_on_timeout is not None else True
        ),
    }


async def get_cbt_settings(db: AsyncSession) -> dict[str, Any]:
    # Schema is ensured at app startup — do not DDL here (it freezes CBT Start).
    row = (await db.execute(select(CbtGlobalSettings).where(CbtGlobalSettings.id == 1))).scalar_one_or_none()
    if not row:
        row = CbtGlobalSettings(id=1, **DEFAULT_SETTINGS)
        db.add(row)
        await db.flush()
    return settings_to_dict(row)


async def update_cbt_settings(db: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    # NOTE: no DDL here — ensure_cbt_settings_schema() runs at startup. DDL on a
    # second connection inside a request deadlocks against this session's open
    # transaction on Postgres, which made admin settings saves hang/fail silently.
    row = (await db.execute(select(CbtGlobalSettings).where(CbtGlobalSettings.id == 1))).scalar_one_or_none()
    if not row:
        row = CbtGlobalSettings(id=1)
        db.add(row)
    for key in DEFAULT_SETTINGS:
        if key not in payload or payload[key] is None:
            continue
        value = payload[key]
        if key == "ce_subjects":
            value = _normalize_ce_subjects(value)
        setattr(row, key, value)
    row.updated_at = naive_utc_now()
    await db.flush()
    return settings_to_dict(row)


def _norm_subject(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _subject_keys(subject: str) -> set[str]:
    """Loose matching so Maths ↔ Mathematics, CRS aliases, etc."""
    n = _norm_subject(subject)
    keys = {n} if n else set()
    if not n:
        return keys
    if n in {"math", "maths", "mathematics", "further mathematics", "addmath"} or "math" in n or "quantitative" in n:
        keys |= {"math", "maths", "mathematics", "quantitative reasoning"}
    if n in ENGLISH_ALIASES or "english" in n or "verbal" in n:
        keys |= set(ENGLISH_ALIASES) | {n, "verbal reasoning"}
    if "basic science" in n or n in {"basic science", "general science"}:
        keys |= {"basic science", "general science", "intermediate science"}
    if "general knowledge" in n or n == "gk":
        keys |= {"general knowledge", "gk"}
    if n in {"crs", "crk", "christian religious studies", "christian religious knowledge"} or (
        "christian" in n and "relig" in n
    ):
        keys |= {"crs", "crk", "christian religious studies", "christian religious knowledge"}
    if n in {"irs", "irk", "islamic religious studies", "islamic studies"} or (
        "islam" in n and "relig" in n
    ):
        keys |= {"irs", "irk", "islamic religious studies", "islamic studies"}
    if n in {"government", "govt"}:
        keys |= {"government", "govt"}
    if n in {"biology", "agric", "agricultural science"} and "agric" in n:
        keys |= {"agricultural science", "agric", "agriculture"}
    # Civic Education ↔ JAMB's 2025 syllabus label "Citizenship and Heritage
    # Studies (Civic)" — the bank stores the new syllabus name, while student
    # profiles still say "Civic Education".
    if "civic" in n or "citizenship" in n or "heritage" in n:
        keys |= {
            "civic education",
            "civic",
            "citizenship and heritage studies (civic)",
            "citizenship and heritage studies",
            "citizenship education",
            "social studies",  # close junior-level equivalent
        }
    return keys


def subjects_match(a: str | None, b: str | None) -> bool:
    return bool(_subject_keys(a or "") & _subject_keys(b or ""))


def is_english_subject(subject: str) -> bool:
    return _norm_subject(subject) in ENGLISH_ALIASES or "english" in _norm_subject(subject)


def _shuffle_options(
    q: CBTQuestion,
    *,
    randomize: bool,
) -> tuple[list[dict[str, str]], str]:
    raw = [
        ("A", q.option_a or ""),
        ("B", q.option_b or ""),
        ("C", q.option_c or ""),
        ("D", q.option_d or ""),
    ]
    correct_text = dict(raw).get((q.correct_option or "A").upper(), q.option_a or "")
    if randomize:
        random.shuffle(raw)
    letters = ["A", "B", "C", "D"]
    options = []
    correct_key = "A"
    for i, (_old, text) in enumerate(raw[:4]):
        key = letters[i]
        options.append({"key": key, "text": text})
        if text == correct_text:
            correct_key = key
    return options, correct_key


async def _published_practice_exams(db: AsyncSession, exam_type: str) -> list[CBTExam]:
    from app.models.cbt import normalize_paper_kind

    board = normalize_board(exam_type)
    exams = (
        await db.execute(
            select(CBTExam).where(
                CBTExam.is_published.is_(True),
                CBTExam.is_school_exam.is_(False),
            )
        )
    ).scalars().all()
    out = []
    for ex in exams:
        if normalize_board(ex.exam_type) != board:
            continue
        # Practice bank = anything that is not past_questions
        if normalize_paper_kind(getattr(ex, "paper_kind", None)) == "past_questions":
            continue
        out.append(ex)
    return out


async def _bank_questions_cross_board(
    db: AsyncSession,
    exam_type: str,
    subject: str,
    own_exams: list[CBTExam],
    limit: int | None,
) -> list[CBTQuestion]:
    """Same-subject questions from OTHER published boards, used when this
    board's bank has no questions for the subject (e.g. Civic Education was
    only uploaded under WAEC/NECO while the JAMB bank stores it as
    'Citizenship and Heritage Studies (Civic)'). Subject knowledge is
    board-independent, so this keeps locked subjects playable."""
    from app.models.cbt import normalize_paper_kind

    norm = _norm_subject(subject)
    if not norm:
        return []
    own_ids = {ex.id for ex in (own_exams or [])}
    board = normalize_board(exam_type)
    try:
        all_exams = (
            await db.execute(
                select(CBTExam).where(
                    CBTExam.is_published.is_(True),
                    CBTExam.is_school_exam.is_(False),
                )
            )
        ).scalars().all()
    except Exception:
        return []
    # One representative exam per distinct bank subject name.
    pool: dict[str, CBTExam] = {}
    for ex in all_exams:
        if ex.id in own_ids or normalize_board(ex.exam_type) == board:
            continue  # same-board misses were already checked; never cross within a board
        if normalize_paper_kind(getattr(ex, "paper_kind", None)) == "past_questions":
            continue
        ex_norm = _norm_subject(ex.subject)
        if ex_norm and ex_norm not in pool:
            pool[ex_norm] = ex
    exam_ids = [ex.id for name, ex in pool.items() if subjects_match(name, subject)]
    if not exam_ids:
        return []
    id_cap = 600
    if limit and limit > 0:
        id_cap = min(max(int(limit) * 8, 120), 600)
    id_rows = (
        await db.execute(
            select(CBTQuestion.id).where(CBTQuestion.exam_id.in_(exam_ids)).limit(id_cap)
        )
    ).scalars().all()
    ids = list(id_rows)
    if not ids:
        return []
    if limit and len(ids) > limit:
        ids = random.sample(ids, int(limit))
    rows = (
        await db.execute(select(CBTQuestion).where(CBTQuestion.id.in_(ids)))
    ).scalars().all()
    clean = [q for q in rows if not _question_has_junk(q)]
    return clean or list(rows)


async def _bank_questions_for(
    db: AsyncSession,
    exam_type: str,
    subject: str,
    practice_exams: list[CBTExam] | None = None,
    limit: int | None = None,
) -> list[CBTQuestion]:
    """Load a capped set of questions. Never use ORDER BY random() — it times out on Render."""
    exams = practice_exams if practice_exams is not None else await _published_practice_exams(db, exam_type)
    exam_ids = [ex.id for ex in exams if subjects_match(ex.subject, subject)]
    if not exam_ids:
        return await _bank_questions_cross_board(db, exam_type, subject, exams, limit)

    # Fast path: ids only, then sample in Python, then fetch rows
    id_cap = 600
    if limit and limit > 0:
        id_cap = min(max(int(limit) * 8, 120), 600)
    id_rows = (
        await db.execute(
            select(CBTQuestion.id).where(CBTQuestion.exam_id.in_(exam_ids)).limit(id_cap)
        )
    ).scalars().all()
    ids = list(id_rows)
    if not ids:
        return []
    if limit and len(ids) > limit:
        ids = random.sample(ids, int(limit))
    rows = (
        await db.execute(select(CBTQuestion).where(CBTQuestion.id.in_(ids)))
    ).scalars().all()
    clean = [q for q in rows if not _question_has_junk(q)]
    # Prefer the clean set; fall back to everything only if the bank would empty.
    if clean:
        return clean
    if rows:
        return list(rows)
    return await _bank_questions_cross_board(db, exam_type, subject, exams, limit)


async def build_section(
    db: AsyncSession,
    *,
    exam_type: str,
    subject: str,
    count: int,
    randomize_questions: bool,
    randomize_options: bool,
    practice_exams: list[CBTExam] | None = None,
) -> dict[str, Any]:
    need = max(int(count or 1), 1)
    bank = await _bank_questions_for(
        db,
        exam_type,
        subject,
        practice_exams=practice_exams,
        limit=need,
    )
    if not bank:
        raise ValueError(
            f"No practice questions available yet for {subject}. "
            "It will appear here as soon as questions are published."
        )
    pick_n = min(need, len(bank))
    chosen = random.sample(bank, pick_n) if randomize_questions else bank[:pick_n]
    questions_out = []
    for q in chosen:
        options, correct_key = _shuffle_options(q, randomize=randomize_options)
        questions_out.append(
            {
                "id": str(q.id),
                "question_text": q.question_text or "",
                "options": options,
                "correct_key": correct_key,
                "topic": q.topic,
                "image_url": q.image_url,
                "explanation": (q.explanation or "").strip() or None,
            }
        )
    return {
        "subject": subject,
        "total": len(questions_out),
        "completed": False,
        "questions": questions_out,
    }


def client_sections(sections: list[dict]) -> list[dict]:
    """Strip correct answers for the student client."""
    out = []
    for sec in sections:
        qs = []
        for q in sec.get("questions") or []:
            qs.append(
                {
                    "id": q["id"],
                    "question_text": q.get("question_text"),
                    "options": q.get("options") or [],
                    "topic": q.get("topic"),
                    "image_url": q.get("image_url"),
                }
            )
        out.append(
            {
                "subject": sec.get("subject"),
                "total": sec.get("total") or len(qs),
                "completed": bool(sec.get("completed")),
                "questions": qs,
            }
        )
    return out


DEFAULT_SCORE_MESSAGES = {
    "outstanding": "Outstanding! You are flying — keep it up! 🏆",
    "excellent": "Excellent result! A top score — brilliant work. 🎉",
    "very_good": "Very good! You are just a step from the top. 💪",
    "good": "Good score! Keep practising to push it higher. 👍",
    "fair": "Fair attempt — consistent practice will lift this fast. 📚",
    "poor": "Don't give up — every practice makes you better. Keep going! 🚀",
}


def rating_message(percent: float, overrides: dict | None = None) -> tuple[str, str]:
    """(rating_label, message) for a percentage — admin can override messages."""
    p = float(percent or 0)
    if p >= 90:
        key, label = "outstanding", "Outstanding"
    elif p >= 80:
        key, label = "excellent", "Excellent"
    elif p >= 70:
        key, label = "very_good", "Very Good"
    elif p >= 60:
        key, label = "good", "Good"
    elif p >= 45:
        key, label = "fair", "Fair"
    else:
        key, label = "poor", "Keep Practising"
    ov = overrides or {}
    return label, str(ov.get(key) or DEFAULT_SCORE_MESSAGES.get(key, ""))


def board_score_scale(board: str, settings: dict) -> dict[str, Any]:
    """How a board's score is reported: combined total (JAMB) or per-subject
    maximum (WAEC/NECO/etc.), derived from admin score-scale settings."""
    board = normalize_board(board)
    if board == "JAMB":
        per = int(settings.get("jamb_questions_per_subject") or 40)
        eng = int(settings.get("jamb_english_questions") or 60)
        per_subject = {"english": eng, "default": per}
        total = int(settings.get("jamb_score_total") or 400)
    elif board == "WAEC":
        per = int(settings.get("waec_questions_per_subject") or 50)
        over = int(settings.get("waec_score_per_subject") or 100)
        per_subject = {"default": per}
        total = over
    elif board == "NECO":
        per = int(settings.get("neco_questions_per_subject") or 50)
        over = int(settings.get("neco_score_per_subject") or 100)
        per_subject = {"default": per}
        total = over
    elif board == "JUNIOR_WAEC":
        per = int(settings.get("jw_questions_per_subject") or 60)
        over = int(settings.get("jw_score_per_subject") or 100)
        per_subject = {"default": per}
        total = over
    else:  # COMMON_ENTRANCE and anything else
        per = int(settings.get("ce_questions_per_subject") or 40)
        over = int(settings.get("ce_score_per_subject") or 100)
        per_subject = {"default": per}
        total = over
    return {"combined": board == "JAMB", "total": total, "per_subject": per_subject}


def build_practice_full_review(sections: list[dict], answers: dict) -> list[dict]:
    """Every question with answers — returned only after submit."""
    items: list[dict] = []
    ans = {str(k): str(v).upper()[:1] for k, v in (answers or {}).items()}
    for sec in sections or []:
        subject = sec.get("subject") or "Subject"
        for q in sec.get("questions") or []:
            qid = str(q.get("id"))
            student = ans.get(qid) or ""
            correct = (q.get("correct_key") or "").upper()
            items.append(
                {
                    "id": qid,
                    "subject": subject,
                    "topic": q.get("topic"),
                    "question_text": q.get("question_text") or "",
                    "options": q.get("options") or [],
                    "your_answer": student or None,
                    "correct_key": correct,
                    "is_correct": bool(student and student == correct),
                    "is_skipped": not bool(student),
                    "explanation": (q.get("explanation") or "").strip(),
                }
            )
    return items


def build_practice_review(sections: list[dict], answers: dict) -> list[dict]:
    """Wrong answers with explanations — returned only after submit."""
    return [q for q in build_practice_full_review(sections, answers) if not q.get("is_correct")]


def light_sections(sections: list[dict]) -> list[dict]:
    """Subject stubs only — full questions load per section on demand."""
    out = []
    for sec in sections or []:
        qs = sec.get("questions") or []
        out.append(
            {
                "subject": sec.get("subject"),
                "total": int(sec.get("total") or len(qs) or 0),
                "completed": bool(sec.get("completed")),
                "has_questions": bool(qs),
                "questions": [],
            }
        )
    return out


def client_section_at(sections: list[dict], index: int) -> dict[str, Any]:
    secs = list(sections or [])
    if index < 0 or index >= len(secs):
        raise IndexError("section index out of range")
    return client_sections([secs[index]])[0]


def section_stub(subject: str, count: int) -> dict[str, Any]:
    """Placeholder section — questions are filled on first open."""
    n = max(int(count or 1), 1)
    return {
        "subject": subject,
        "total": n,
        "completed": False,
        "questions": [],
    }


async def ensure_section_built(
    db: AsyncSession,
    attempt: CbtPracticeAttempt,
    section_index: int,
) -> dict[str, Any]:
    """Build one subject paper the first time the student opens it."""
    sections = list(attempt.sections or [])
    if section_index < 0 or section_index >= len(sections):
        raise IndexError("section index out of range")
    sec = dict(sections[section_index] or {})
    if sec.get("questions"):
        return sec

    settings = await get_cbt_settings(db)
    board = normalize_board(attempt.exam_type)
    subject = str(sec.get("subject") or "").strip()
    if not subject:
        raise ValueError("Section has no subject")

    if board == "JAMB":
        count = (
            int(settings["jamb_english_questions"] or 60)
            if is_english_subject(subject)
            else int(settings["jamb_questions_per_subject"] or 40)
        )
    elif board == "COMMON_ENTRANCE":
        count = int(settings.get("ce_questions_per_subject") or 40)
    elif board == "JUNIOR_WAEC":
        count = int(settings.get("jw_questions_per_subject") or 60)
    elif board == "WAEC":
        count = int(settings["waec_questions_per_subject"] or 50)
    else:
        count = int(settings["neco_questions_per_subject"] or 50)
    # Prefer stub total if admin already set it at start
    if int(sec.get("total") or 0) > 0:
        count = int(sec["total"])

    built = await build_section(
        db,
        exam_type=board,
        subject=subject,
        count=count,
        randomize_questions=bool(settings["randomize_questions"]),
        randomize_options=bool(settings["randomize_options"]),
    )
    sections[section_index] = built
    attempt.sections = sections
    flag_modified(attempt, "sections")
    await db.flush()
    await db.commit()
    return built


async def ensure_all_sections_built(db: AsyncSession, attempt: CbtPracticeAttempt) -> None:
    for i, sec in enumerate(list(attempt.sections or [])):
        if not (sec or {}).get("questions"):
            await ensure_section_built(db, attempt, i)


def _board_registered_subjects(profile, board: str) -> list[str]:
    """Registered subjects for a WAEC/NECO board (each board keeps its own list,
    falling back to the shared ssce_subjects / selected_subjects columns)."""
    if profile is None:
        return []
    if board == "WAEC":
        own = list(getattr(profile, "waec_subjects", None) or [])
        if own:
            return [str(s).strip() for s in own if str(s).strip()]
    elif board == "NECO":
        own = list(getattr(profile, "neco_subjects", None) or [])
        if own:
            return [str(s).strip() for s in own if str(s).strip()]
    elif board == "JUNIOR_WAEC":
        own = list(getattr(profile, "junior_subjects", None) or [])
        if own:
            return [str(s).strip() for s in own if str(s).strip()]
    if (getattr(profile, "ssce_exam_type", None) or "").upper() == board:
        return [str(s).strip() for s in (profile.ssce_subjects or []) if str(s).strip()]
    return []


def _save_board_subjects(profile, board: str, subjects: list[str]) -> None:
    clean = [str(s).strip() for s in subjects if str(s).strip()]
    if board == "WAEC":
        profile.waec_subjects = clean
    elif board == "NECO":
        profile.neco_subjects = clean
    elif board == "JUNIOR_WAEC":
        profile.junior_subjects = clean
    profile.ssce_subjects = clean
    profile.ssce_exam_type = board


async def register_board_subjects(
    db: AsyncSession,
    *,
    student_id: str,
    exam_type: str,
    subjects: list[str],
) -> dict:
    """Register (and lock) a WAEC/NECO subject list WITHOUT starting an exam.
    Also validates JAMB's required-count selection. Idempotent: re-registering
    the same board+list just refreshes it."""
    from app.models.user import StudentProfile

    board = normalize_board(exam_type)
    if board not in {"JAMB", "WAEC", "NECO", "JUNIOR_WAEC", "COMMON_ENTRANCE"}:
        raise ValueError("Exam type must be JAMB, WAEC, NECO, Junior WAEC, or COMMON_ENTRANCE")
    sid = uuid.UUID(str(student_id))
    clean = []
    for s in subjects:
        t = (s or "").strip()
        if t and t not in clean:
            clean.append(t)

    profile = (
        await db.execute(select(StudentProfile).where(StudentProfile.user_id == sid))
    ).scalar_one_or_none()
    if profile is None:
        raise ValueError("Complete your profile first")

    # Subject changes after registration go through admin approval. The lock
    # applies as soon as subjects were saved via the register endpoint (the
    # per-board columns) or once a WAEC/NECO attempt has started. Legacy rows
    # whose only record is the pre-polluted ssce_subjects list can still be
    # re-registered once before the first exam.
    if board in {"WAEC", "NECO", "JUNIOR_WAEC"}:
        existing = _board_registered_subjects(profile, board)
        own_col = list(
            getattr(
                profile,
                "waec_subjects" if board == "WAEC" else "neco_subjects" if board == "NECO" else "junior_subjects",
                None,
            )
            or []
        )
        if existing:
            try:
                any_ssce = (
                    await db.execute(
                        select(CbtPracticeAttempt.id)
                        .where(
                            CbtPracticeAttempt.student_id == sid,
                            CbtPracticeAttempt.exam_type.in_(
                                ["WAEC", "NECO"]
                                if board != "JUNIOR_WAEC"
                                else ["JUNIOR_WAEC"]
                            ),
                        )
                        .limit(1)
                    )
                ).first()
                started = any_ssce is not None
            except Exception:
                try:
                    await db.rollback()
                except Exception:
                    pass
                started = True
            if (own_col or started) and {s.lower() for s in clean} != {s.lower() for s in existing}:
                raise PermissionError("SUBJECTS_LOCKED_SEND_CHANGE_REQUEST")
            if not own_col and not started:
                pass  # legacy pre-start list: allow the one-time fix
            else:
                clean = existing  # no-op refresh
    elif board == "JAMB":
        existing_j = [str(s).strip() for s in (profile.jamb_subjects or [])]
        if existing_j and {s.lower() for s in clean} != {s.lower() for s in existing_j}:
            raise PermissionError("SUBJECTS_LOCKED_SEND_CHANGE_REQUEST")

    if not clean:
        raise ValueError("Select at least one subject")

    if board in {"WAEC", "NECO", "JUNIOR_WAEC"}:
        _save_board_subjects(profile, board, clean)
    elif board == "JAMB":
        profile.jamb_subjects = clean
    profile.cbt_subjects_locked = True
    if profile.locked_at is None:
        profile.locked_at = naive_utc_now()
    await db.flush()
    await db.commit()
    stored = (
        _board_registered_subjects(profile, board)
        if board in {"WAEC", "NECO", "JUNIOR_WAEC"}
        else list(clean)
    )
    return {"ok": True, "board": board, "subjects": stored, "locked": True}


async def start_practice_attempt(
    db: AsyncSession,
    *,
    student_id: str,
    exam_type: str,
    subjects: list[str],
    guest_access_boards: list[str] | None = None,
) -> CbtPracticeAttempt:
    from app.models.user import StudentProfile

    board = normalize_board(exam_type)
    if board not in {"JAMB", "WAEC", "NECO", "JUNIOR_WAEC", "COMMON_ENTRANCE"}:
        raise ValueError("Exam type must be JAMB, WAEC, NECO, Junior WAEC, or COMMON_ENTRANCE")

    sid = uuid.UUID(str(student_id))

    # Access check must never poison the DB transaction used to create the attempt.
    # Nested savepoint / entitlement failures leave the session aborted — always
    # rollback before INSERT into cbt_practice_attempts.
    allowed = board in {
        normalize_board(value) for value in (guest_access_boards or [])
    } if guest_access_boards is not None else False
    if guest_access_boards is None:
        try:
            allowed = await has_board_access(db, str(sid), board)
        except Exception:
            logger.exception("has_board_access failed during practice start")
            allowed = False
    try:
        await db.rollback()
    except Exception:
        pass

    if not allowed:
        raise PermissionError(f"{board}_PACKAGE_REQUIRED")

    settings = await get_cbt_settings(db)
    if not settings.get("cbt_enabled", True):
        raise ValueError("CBT practice is currently disabled by admin.")

    # Reuse an in-progress attempt for the SAME board + subjects ONLY when the
    # admin has "Allow resume" switched on. Default is OFF: leaving and coming
    # back hands out a freshly randomised paper — students expect practice to
    # reshuffle questions each time (the mobile app re-syncs the new paper
    # automatically, so nothing breaks).
    def _norm_subjects(lst) -> list[str]:
        return sorted({str(s).strip().lower() for s in (lst or []) if str(s).strip()})

    reusable: CbtPracticeAttempt | None = None
    if settings.get("allow_resume", False):
        try:
            open_attempts = (
                (
                    await db.execute(
                        select(CbtPracticeAttempt)
                        .where(
                            CbtPracticeAttempt.student_id == sid,
                            CbtPracticeAttempt.exam_type == board,
                            CbtPracticeAttempt.status == "in_progress",
                        )
                        .order_by(CbtPracticeAttempt.started_at.desc())
                        .limit(5)
                    )
                )
                .scalars()
                .all()
            )
            requested = _norm_subjects(subjects)
            for cand in open_attempts:
                if _norm_subjects(cand.subjects) == requested:
                    reusable = cand
                    break
        except Exception:
            logger.exception("practice start: reuse lookup failed")
            try:
                await db.rollback()
            except Exception:
                pass
            reusable = None

    if reusable is not None:
        now = naive_utc_now()
        timer_active = reusable.ends_at is not None and reusable.ends_at > now
        if timer_active:
            # Same paper, same progress — the student is resuming mid-exam.
            return reusable
        # Timer expired: hand out a FRESH randomised paper. Students expect
        # "start again" to reshuffle questions — reusing an old paper forever
        # (until submit) made practice feel broken/stale. Mark the old row so
        # grading history stays intact, then fall through to create a new one.
        try:
            reusable.status = "abandoned"
            reusable.submitted_at = now
            await db.flush()
        except Exception:
            logger.exception("practice start: could not expire stale attempt")
            try:
                await db.rollback()
            except Exception:
                pass
        reusable = None

    # No reusable attempt: abandon old in-progress rows with a lightweight
    # UPDATE (never SELECT the huge JSON sections blob into Python).
    try:
        await db.execute(
            update(CbtPracticeAttempt)
            .where(
                CbtPracticeAttempt.student_id == sid,
                CbtPracticeAttempt.exam_type == board,
                CbtPracticeAttempt.status == "in_progress",
            )
            .values(status="abandoned", submitted_at=naive_utc_now())
        )
    except Exception:
        logger.exception("abandon prior CBT attempts failed")
        try:
            await db.rollback()
        except Exception:
            pass

    subjects_clean = [s.strip() for s in subjects if (s or "").strip()]

    # Prefer student profile subjects (exam package), not a per-start selection form
    profile = None
    try:
        profile = (
            await db.execute(select(StudentProfile).where(StudentProfile.user_id == sid))
        ).scalar_one_or_none()
    except Exception:
        logger.warning("practice start: could not load student profile", exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass
        profile = None

    if board == "JAMB":
        need = int(settings["jamb_subjects_required"] or 4)
        profile_jamb = list((profile.jamb_subjects if profile else None) or [])
        if len(subjects_clean) != need and len(profile_jamb) == need:
            subjects_clean = [str(s).strip() for s in profile_jamb if str(s).strip()]
        if len(subjects_clean) != need:
            raise ValueError(
                f"Your profile must have exactly {need} JAMB subjects before starting CBT. "
                "Update Profile → Exam subjects, then try again."
            )
        # Remember the chosen combination so the next session opens with it
        # pre-selected (students kept re-ticking their subjects every time).
        if profile is not None and {s.lower() for s in subjects_clean} != {
            s.lower() for s in profile_jamb
        }:
            try:
                profile.jamb_subjects = [str(s).strip() for s in subjects_clean]
                await db.flush()
            except Exception:
                logger.warning("practice start: could not persist JAMB subjects", exc_info=True)
                try:
                    await db.rollback()
                except Exception:
                    pass
        duration = int(settings["jamb_duration_minutes"] or 60)
        # Fast open: create subject stubs now; build questions when student picks a subject
        sections = []
        for sub in subjects_clean:
            n = (
                int(settings["jamb_english_questions"] or 60)
                if is_english_subject(sub)
                else int(settings["jamb_questions_per_subject"] or 40)
            )
            sections.append(section_stub(sub, n))
    elif board == "COMMON_ENTRANCE":
        # Combined package like JAMB: subjects come from Admin CE settings (not one-at-a-time).
        configured = _normalize_ce_subjects(settings.get("ce_subjects"))
        if subjects_clean:
            # Keep caller order but only allow configured subjects when configured list exists
            allowed = {_norm_subject(s) for s in configured}
            filtered = [s for s in subjects_clean if _norm_subject(s) in allowed or any(
                subjects_match(s, cfg) for cfg in configured
            )]
            subjects_clean = filtered or list(configured)
        else:
            subjects_clean = list(configured)
        if len(subjects_clean) < 1:
            raise ValueError(
                "Common Entrance subjects are not configured. "
                "Ask admin to set Common Entrance subjects in CBT Settings."
            )
        duration = int(settings.get("ce_duration_minutes") or 60)
        per = int(settings.get("ce_questions_per_subject") or 40)
        sections = [section_stub(sub, per) for sub in subjects_clean]
    else:
        profile_ssce = _board_registered_subjects(profile, board)
        # If the student NEVER started this SSCE board before, ignore any pre-filled
        # 4-subject list (copied from JAMB at signup) so they can pick their own
        # subjects. Once an attempt exists, subjects are locked.
        if profile is not None:
            try:
                any_ssce = (
                    await db.execute(
                        select(CbtPracticeAttempt.id)
                        .where(
                            CbtPracticeAttempt.student_id == sid,
                            CbtPracticeAttempt.exam_type.in_(
                                ["JUNIOR_WAEC"]
                                if board == "JUNIOR_WAEC"
                                else ["WAEC", "NECO"]
                            ),
                        )
                        .limit(1)
                    )
                ).first()
                if any_ssce is None:
                    profile_ssce = []
            except Exception:
                try:
                    await db.rollback()
                except Exception:
                    pass
        if not subjects_clean:
            raise ValueError(f"Select your {board} subject(s) to practice.")

        # First-time SSCE start: persist the chosen subject(s) to the profile and
        # lock them — afterwards subjects can only change via an approved
        # admin subject-change request (see routers/cbt_subject_change.py).
        if not profile_ssce and profile is not None:
            try:
                _save_board_subjects(profile, board, [str(s).strip() for s in subjects_clean])
                profile.cbt_subjects_locked = True
                profile.locked_at = naive_utc_now()
                await db.flush()
                await db.commit()
                await db.refresh(profile)
            except Exception:
                logger.exception("practice start: could not persist SSCE subjects")
                try:
                    await db.rollback()
                except Exception:
                    pass
            profile_ssce = list(subjects_clean)
        # Already registered: every requested subject must be one of them
        if profile_ssce:
            allowed_subs = {str(s).strip().lower() for s in profile_ssce}
            for s in subjects_clean:
                if s.strip().lower() not in allowed_subs:
                    raise ValueError(
                        f"{s} is not in your registered {board} subjects. "
                        "Send your admin a subject-change request to update them."
                    )
        # Junior WAEC runs all selected subjects in ONE attempt — one section
        # per subject so the student practises every subject in one sitting.
        if board == "JUNIOR_WAEC":
            subjects_clean = [str(s).strip() for s in subjects_clean if str(s).strip()]
            duration = int(settings.get("jw_duration_minutes") or 60)
            count = int(settings.get("jw_questions_per_subject") or 60)
            sections = [section_stub(s, count) for s in subjects_clean]
        else:
            subjects_clean = [subjects_clean[0].strip()]
            duration = int(
                settings["waec_duration_minutes"]
                if board == "WAEC"
                else settings["neco_duration_minutes"]
            )
            count = int(
                settings["waec_questions_per_subject"]
                if board == "WAEC"
                else settings["neco_questions_per_subject"]
            )
            sections = [section_stub(subjects_clean[0], count)]

    now = naive_utc_now()
    attempt = CbtPracticeAttempt(
        student_id=sid,
        exam_type=board,
        subjects=subjects_clean,
        sections=sections,
        answers={},
        status="in_progress",
        section_index=0,
        duration_minutes=duration,
        started_at=now,
        ends_at=now + timedelta(minutes=duration),
    )
    db.add(attempt)
    await db.flush()
    await db.commit()
    await db.refresh(attempt)
    return attempt


def attempt_client_dict(
    attempt: CbtPracticeAttempt,
    *,
    include_questions: bool = True,
) -> dict[str, Any]:
    now = naive_utc_now()
    ends = attempt.ends_at
    seconds_left = None
    if ends:
        seconds_left = max(0, int((ends - now).total_seconds()))
    raw_sections = attempt.sections or []
    sections = (
        client_sections(raw_sections) if include_questions else light_sections(raw_sections)
    )
    return {
        "attempt_id": str(attempt.id),
        "exam_type": attempt.exam_type,
        "subjects": attempt.subjects or [],
        "sections": sections,
        "section_index": int(attempt.section_index or 0),
        "status": attempt.status,
        "duration_minutes": attempt.duration_minutes,
        "started_at": attempt.started_at.isoformat() if attempt.started_at else None,
        "ends_at": attempt.ends_at.isoformat() if attempt.ends_at else None,
        "seconds_left": seconds_left,
        "answers": attempt.answers or {},
        "questions_deferred": not include_questions,
    }


import re as _re

_MISLABELED_TITLE_RE = _re.compile(
    r"\b(WAEC|WASSCE|NECO|JAMB|UTME)\b", _re.IGNORECASE
)


async def relabel_mislabeled_bank_exams(db: AsyncSession) -> int:
    """Fix question-bank exams whose title names a different board than their
    exam_type column (that mismatch is what made WAEC/NECO serve JAMB questions
    even though every query filters strictly by board). One-time self-heal —
    runs at startup and is idempotent."""
    try:
        exams = (
            await db.execute(
                select(CBTExam).where(
                    CBTExam.is_school_exam.is_(False),
                    CBTExam.paper_kind == "cbt_practice",
                )
            )
        ).scalars().all()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        return 0

    fixed = 0
    for ex in exams:
        m = _MISLABELED_TITLE_RE.search(ex.title or "")
        if not m:
            continue
        title_board = normalize_board(m.group(1).upper())
        if title_board == normalize_board(ex.exam_type):
            continue
        if title_board not in {"JAMB", "WAEC", "NECO"}:
            continue
        ex.exam_type = title_board
        fixed += 1
    if fixed:
        try:
            await db.commit()
        except Exception:
            try:
                await db.rollback()
            except Exception:
                pass
            return 0
    return fixed
