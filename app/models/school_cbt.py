"""SCHOLAXIA — School CBT / Examination engine models.

Owner spec §31: every important record carries the school/tenant key so a
multi-school platform can never leak one school's data to another:

    school_ex_question_banks   — reusable question bank (Subject → Class → Topic)
    school_ex_questions        — bank question rows (options + correct answer)
    school_exams               — exam configuration (mode, total mark, duration…)
    school_exam_assignments    — exam ↔ student relationship
    school_exam_access_codes   — REG NUMBER + access code credentials per student
    school_exam_attempts       — one attempt per student per exam
    school_exam_answers        — per-question answers inside an attempt
    school_exam_downloads      — offline download receipts (§17/§18)
    school_exam_sync_logs      — offline sync audit trail (§21/§23)
    school_exam_results        — marked results (raw score → configured total mark)

Backend is the authority for every exam rule (spec §30): authorization,
attempt validity, question selection and marking all happen server-side.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text, Integer, Float, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base

EXAM_MODES = ("ONLINE", "OFFLINE", "HYBRID")
QUESTION_TYPES = ("mcq", "true_false", "multi_select", "theory")
DIFFICULTIES = ("easy", "medium", "hard")


def _gen_reg_number(school_code: str) -> str:
    """SCHX/26/544560-style registration number (login screen format)."""
    import secrets

    year = datetime.utcnow().strftime("%y")
    return f"{(school_code or 'SCH').upper()[:4]}/{year}/{secrets.randbelow(900000) + 100000}"


def _gen_access_code() -> str:
    """SCH-82K7-X91P-style exam access code (spec §13)."""
    import secrets
    import string

    alphabet = string.ascii_uppercase + string.digits
    part1 = "".join(secrets.choice(alphabet) for _ in range(4))
    part2 = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"SCH-{part1}-{part2}"


class SchoolExQuestionBank(Base):
    """Exam Bank / Question Bank (spec §2/§3): Subject → Class → Topic → Questions."""
    __tablename__ = "school_ex_question_banks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    subject: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    class_name: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    school_level: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="active", nullable=False)  # draft/active/archived
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    questions: Mapped[list["SchoolExQuestion"]] = relationship(
        "SchoolExQuestion", back_populates="bank", cascade="all, delete-orphan"
    )


class SchoolExQuestion(Base):
    """A reusable bank question (spec §2). Question type MCQ primary."""
    __tablename__ = "school_ex_questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bank_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_ex_question_banks.id"), nullable=False, index=True
    )
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    option_a: Mapped[str] = mapped_column(Text, nullable=False, default="")
    option_b: Mapped[str] = mapped_column(Text, nullable=False, default="")
    option_c: Mapped[str] = mapped_column(Text, nullable=False, default="")
    option_d: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # "A" for option_a, "B"…; multi-select stores "A,C"
    correct_option: Mapped[str] = mapped_column(String(12), nullable=False, default="A")
    question_type: Mapped[str] = mapped_column(String(16), default="mcq", nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=True)
    sub_topic: Mapped[str] = mapped_column(String(255), nullable=True)
    marks: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(10), default="medium", nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=True)
    year: Mapped[str] = mapped_column(String(20), nullable=True)  # session/year e.g. 2026/2027
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    image_url: Mapped[str] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="active", nullable=False)

    bank: Mapped["SchoolExQuestionBank"] = relationship("SchoolExQuestionBank", back_populates="questions")


class SchoolExam(Base):
    """A school examination with the FULL owner-spec configuration (§4–§12)."""
    __tablename__ = "school_exams"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(120), nullable=False)
    class_name: Mapped[str] = mapped_column(String(40), nullable=False)
    exam_type: Mapped[str] = mapped_column(String(30), default="SCHOOL", nullable=False)
    session: Mapped[str] = mapped_column(String(30), nullable=True)   # 2026/2027
    term: Mapped[str] = mapped_column(String(30), nullable=True)      # First/Second/Third Term
    instructions: Mapped[str] = mapped_column(Text, nullable=True)

    # §5 — per-exam mode, never global. Download only when OFFLINE/HYBRID (§16).
    exam_mode: Mapped[str] = mapped_column(String(10), default="ONLINE", nullable=False)
    # §6 — school decides the total mark; never assume 100.
    total_mark: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    # §7 — duration; timer start is authoritative server-side.
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    # §8/§9 — questions to display vs questions to answer.
    questions_to_display: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0 = all
    questions_to_answer: Mapped[int] = mapped_column(Integer, default=0, nullable=False)   # 0 = all
    # §10 — randomization; correct-answer mapping preserved server-side.
    randomize_questions: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    randomize_options: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_review: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_previous: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_flagging: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # §26 item 3 — question selection: manual (list of bank question ids) or
    # auto/random pick from banks; resolved to exam_questions at creation.
    bank_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    selected_question_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)  # manual selection
    auto_pick_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # random N from banks

    # §26 items 5/6 — scheduling + assignment.
    exam_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    scheduled_start: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    scheduled_end: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    assigned_student_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)  # explicit students
    assigned_class_names: Mapped[list | None] = mapped_column(JSON, nullable=True)  # whole classes

    # §26 item 7 — access control.
    access_code_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    max_attempts: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # "Grant Exam Retake" (reference admin dashboard): students given a second
    # chance — each listed student gets one extra attempt beyond max_attempts.
    retake_student_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # §22/§29 — results stay hidden from students until the school publishes.
    results_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # §28 — publish / state machine: draft → published → completed.
    status: Mapped[str] = mapped_column(String(12), default="draft", nullable=False, index=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    questions: Mapped[list["SchoolExamQuestion"]] = relationship(
        "SchoolExamQuestion", back_populates="exam", cascade="all, delete-orphan"
    )


class SchoolExamQuestion(Base):
    """Question snapshot inside a specific exam (copied from the bank)."""
    __tablename__ = "school_exam_questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exams.id"), nullable=False, index=True
    )
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    bank_question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_ex_questions.id"), nullable=True
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    option_a: Mapped[str] = mapped_column(Text, nullable=False, default="")
    option_b: Mapped[str] = mapped_column(Text, nullable=False, default="")
    option_c: Mapped[str] = mapped_column(Text, nullable=False, default="")
    option_d: Mapped[str] = mapped_column(Text, nullable=False, default="")
    correct_option: Mapped[str] = mapped_column(String(12), nullable=False, default="A")  # server-only
    question_type: Mapped[str] = mapped_column(String(16), default="mcq", nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=True)
    marks: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Optional diagram/image shown with the question (bank snapshot)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    exam: Mapped["SchoolExam"] = relationship("SchoolExam", back_populates="questions")


class SchoolExamAssignment(Base):
    """§12 — the school↔student↔class↔subject↔exam relationship, verified on
    every request so a student can never open another student's exam."""
    __tablename__ = "school_exam_assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exams.id"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    class_name: Mapped[str] = mapped_column(String(40), nullable=True)
    subject: Mapped[str] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ux_school_exam_assignments", "exam_id", "student_id", unique=True),
    )


class SchoolExamAccessCode(Base):
    """§13 — REG NUMBER + access code per student per exam.

    Format: SCH-82K7-X91P. Brute-force protection is server-side (§14).
    """
    __tablename__ = "school_exam_access_codes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    # Pass 7: NULL = credential issued at REGISTRATION (reference flow — the
    # slip prints immediately), attached to a real exam when the subject is
    # scheduled (_ensure_access_codes reuses the pending row instead of
    # minting new credentials, so the printed slip stays valid).
    exam_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exams.id"), nullable=True, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    reg_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    access_code: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    # Subjects picked at REGISTRATION (JSON list, e.g. ["English Language"] or
    # ["ALL"]) — shown on the slip even before exams are scheduled.
    requested_subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    used_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    # Brute-force throttle (server-side, §14).
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    # School can restrict a student (or all) from accessing their exams
    is_restricted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ux_school_exam_codes", "exam_id", "student_id", unique=True),
    )


class SchoolExamAttempt(Base):
    """§12 — one attempt per student per exam. Server owns start time."""
    __tablename__ = "school_exam_attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exams.id"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    access_code_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exam_access_codes.id"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    # Server-computed deadline = started_at + duration_minutes. Client timer
    # is display-only (spec §7: never trust a timer value from the device).
    deadline_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    is_auto_submitted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="in_progress", nullable=False)  # in_progress/submitted
    sync_status: Mapped[str] = mapped_column(String(24), nullable=True)  # Waiting for Secure Sync → synced
    # Question order + option order this student received (randomization
    # mapping is stored server-side, §10).
    question_order: Mapped[list | None] = mapped_column(JSON, nullable=True)
    option_order: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    retake_granted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        Index("ix_school_exam_attempts_exam_student", "exam_id", "student_id"),
    )


class SchoolExamAnswer(Base):
    """§21 — every answer, saved immediately, validated server-side."""
    __tablename__ = "school_exam_answers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exam_attempts.id"), nullable=False, index=True
    )
    exam_question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exam_questions.id"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    answer: Mapped[str] = mapped_column(String(50), nullable=True)   # "A"/"B"/"C"/"D" or "A,C"
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    synced_offline: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        Index("ux_school_exam_answers", "attempt_id", "exam_question_id", unique=True),
    )


class SchoolExamDownload(Base):
    """§17/§18 — download receipts for offline/hybrid exams only."""
    __tablename__ = "school_exam_downloads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exams.id"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    checksum: Mapped[str] = mapped_column(String(80), nullable=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # §10/§18 — the per-student randomization baked into the downloaded copy;
    # start_attempt reuses it so the device and server always agree.
    question_order: Mapped[list | None] = mapped_column(JSON, nullable=True)
    option_order: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SchoolExamSyncLog(Base):
    """§21/§23 — audit trail of every offline sync (answers + submissions)."""
    __tablename__ = "school_exam_sync_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exams.id"), nullable=False, index=True
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exam_attempts.id"), nullable=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    event: Mapped[str] = mapped_column(String(32), nullable=False)  # answer_saved/submitted/offline_queued/synced
    channel: Mapped[str] = mapped_column(String(16), default="online", nullable=False)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SchoolExamResult(Base):
    """§29 — backend-marked result: raw score mapped to the configured total mark."""
    __tablename__ = "school_exam_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exams.id"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_exam_attempts.id"), nullable=True
    )
    total_questions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    questions_answered: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    correct_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    wrong_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    raw_score: Mapped[float] = mapped_column(Float, default=0, nullable=False)  # sum of marks earned
    raw_total: Mapped[float] = mapped_column(Float, default=0, nullable=False)  # sum of all marks
    total_mark: Mapped[int] = mapped_column(Integer, default=100, nullable=False)  # configured
    final_score: Mapped[float] = mapped_column(Float, default=0, nullable=False)   # mapped to total_mark
    percentage: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    grade: Mapped[str] = mapped_column(String(5), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # §22/§29
    published_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ux_school_exam_results", "exam_id", "student_id", unique=True),
    )


def grade_from_percentage(pct: float) -> str:
    """Configurable-by-school later (spec §29); Nigerian standard for now."""
    if pct >= 75: return "A1"
    if pct >= 70: return "B2"
    if pct >= 65: return "B3"
    if pct >= 60: return "C4"
    if pct >= 55: return "C5"
    if pct >= 50: return "C6"
    if pct >= 45: return "D7"
    if pct >= 40: return "E8"
    return "F9"
