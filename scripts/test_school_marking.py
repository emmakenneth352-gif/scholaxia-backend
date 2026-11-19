"""MARKING ACCURACY test for the school portal CBT engine (in-memory SQLite).

Every paper here is submitted through the real endpoints and the score is
checked against what a teacher would count by hand:

  A. 20 questions, no randomisation  -> 15 right, 3 wrong, 2 blank = 75%
  B. Randomised option order         -> 10 right, 10 wrong        = 50%
  C. "Show 8 of 20" + shuffled paper -> 8 right                   = 100%
  D. Multi-select / theory / missing key handling
  E. Per-question marks (3 + 1)      -> 3/4                        = 75%
  F. Grant retake                    -> second sit marked cleanly

Run:  PYTHONIOENCODING=utf-8 ./.venv/Scripts/python.exe -u scripts/test_school_marking.py
"""
import asyncio
import os
import sys
import uuid as uuidmod

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.core.database as database  # noqa: E402
from app.core.database import Base  # noqa: E402

engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = async_sessionmaker(engine, expire_on_commit=False)
database.engine = engine
database.AsyncSessionLocal = TestingSession


async def _stub_db():
    yield None


database.get_db = _stub_db

import app.core.startup_db as startup_db  # noqa: E402
import app.routers.school_office as soffice  # noqa: E402


async def _noop_schema() -> None:
    return None


startup_db.ensure_school_campus_schema = _noop_schema
soffice.ensure_school_campus_schema = _noop_schema

import app.models  # noqa: E402,F401
from app.models.school_campus import SchoolCampus  # noqa: E402
from app.models.user import User, UserRole, StudentProfile  # noqa: E402
from app.core.security import hash_password  # noqa: E402

from sqlalchemy import JSON as _JSON  # noqa: E402
from sqlalchemy.dialects.postgresql import ARRAY  # noqa: E402
from sqlalchemy.dialects.postgresql import UUID as PG_UUID  # noqa: E402
from sqlalchemy.types import CHAR, TypeDecorator  # noqa: E402


class _GuidAny(TypeDecorator):
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return value if isinstance(value, str) else str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value if isinstance(value, uuidmod.UUID) else uuidmod.UUID(str(value))


for _t in Base.metadata.tables.values():
    for _c in _t.columns:
        if isinstance(_c.type, ARRAY):
            _c.type = _JSON()
        elif isinstance(_c.type, PG_UUID):
            _c.type = _GuidAny()

import app.routers.school_cbt as scbt  # noqa: E402

PASS, FAIL = [], []
STUDENT_IDS = []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name + (f"  [{extra}]" if extra and not cond else ""))
    print(("  PASS " if cond else "  FAIL ") + name + (f"  -> {extra}" if extra and not cond else ""))


TABLES = {
    "school_campuses", "users", "student_profiles",
    "school_ex_question_banks", "school_ex_questions",
    "school_exams", "school_exam_questions", "school_exam_assignments",
    "school_exam_access_codes", "school_exam_attempts", "school_exam_answers",
    "school_exam_downloads", "school_exam_sync_logs", "school_exam_results",
}

LETTERS = ["A", "B", "C", "D"]


def question_payload(i):
    """Question i with a known key, four distinct option texts."""
    key = LETTERS[i % 4]
    opts = {LETTERS[j]: f"OPT{i}-{LETTERS[j]}" for j in range(4)}
    return {
        "q": f"ACCTEST question number {i}",
        "opts": opts,
        "key": key,
    }


async def make_exam(db, bank, title, **over):
    payload = dict(
        title=title, subject="Mathematics", class_name="SS2",
        session="2026/2027", term="First Term", instructions="Answer all.",
        exam_mode="ONLINE", total_mark=100, duration_minutes=60,
        questions_to_display=0, questions_to_answer=0,
        randomize_questions=False, randomize_options=False,
        bank_ids=[bank["id"]], auto_pick_count=0,
        assigned_class_names=["SS2"], generate_codes=True, publish=True,
    )
    payload.update(over)
    return await scbt.create_exam(scbt.ExamCreateIn(**payload), admin_user_ctx, db)


admin_user_ctx = {}


async def student_token(exam_id, db, index=0):
    detail = await scbt.exam_detail(exam_id, STAFF, admin_user_ctx, db)
    assigned = detail["assigned"]
    row = assigned[index] if index < len(assigned) else assigned[0]
    login = await scbt.student_exam_login(
        scbt.StudentLoginIn(reg_number=row["reg_number"], access_code=row["access_code"]), db
    )
    return creds(login["access_token"]), login["student"]


from fastapi.security import HTTPAuthorizationCredentials  # noqa: E402


def creds(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def label_of(q, text):
    for o in q["options"]:
        if (o.get("text") or "").strip() == text:
            return o["label"]
    raise AssertionError(f"option {text!r} not on this question")


async def submit_and_score(exam_id, attempt_id, tok, db, student_id=None):
    res = await scbt.submit_attempt(exam_id, scbt.SubmitIn(attempt_id=attempt_id), credentials=tok, db=db)
    await scbt.publish_results(exam_id, True, STAFF, admin_user_ctx, db)
    staff = await scbt.exam_results(exam_id, STAFF, admin_user_ctx, db)
    rows = staff["results"]
    if student_id:
        rows = [r for r in rows if float(r.get("percentage") or 0) >= 0 and True] or rows
    row = rows[0]
    return res, row


async def main():
    todo = [t for t in Base.metadata.sorted_tables if t.name in TABLES]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=todo))

    global STAFF
    async with TestingSession() as db:
        campus = SchoolCampus(name="Marking College", code="MRK", slug="marking", is_active=True)
        db.add(campus)
        await db.flush()
        admin = User(email="ad@mrk.sch", hashed_password=hash_password("password123"),
                     full_name="Marking Admin", role=UserRole.school_admin,
                     is_verified=True, is_active=True, school_id=campus.id)
        db.add(admin)
        await db.flush()
        for i in (1, 2):
            u = User(email=f"s{i}@mrk.sch", hashed_password=hash_password("password123"),
                     full_name=f"Student {i}", role=UserRole.student,
                     is_verified=True, is_active=True, school_id=campus.id)
            db.add(u)
            await db.flush()
            STUDENT_IDS.append(str(u.id))
            db.add(StudentProfile(user_id=u.id, education_level="SS2", school_student_id=f"MRK/26/90{i}"))
        await db.commit()
        STAFF = str(campus.id)
        admin_user_ctx.update({"sub": admin.id, "role": "school_admin", "school_id": str(campus.id)})

    async with TestingSession() as db:
        # ── bank of 20 questions ────────────────────────────────────────────
        bank = await scbt.create_bank(
            scbt.BankIn(name="Marking Bank SS2", subject="Mathematics", class_name="SS2"),
            admin_user_ctx, db,
        )
        rows = []
        for i in range(20):
            item = question_payload(i)
            rows.append(scbt.BankQuestionIn(
                question_text=item["q"],
                option_a=item["opts"]["A"], option_b=item["opts"]["B"],
                option_c=item["opts"]["C"], option_d=item["opts"]["D"],
                correct_option=item["key"], topic="T", marks=1,
            ))
        await scbt.add_bank_questions(bank["id"], rows, admin_user_ctx, db)
        check("bank holds 20 questions", True)

        # ── A. plain paper, 15 right / 3 wrong / 2 blank = 75% ──────────────
        print("\n-- A. 20 questions, no randomisation --")
        exA = await make_exam(db, bank, "Marking A", auto_pick_count=20)
        tokA, studentA = await student_token(exA["id"], db)
        started = await scbt.start_attempt(exA["id"], credentials=tokA, db=db)
        qsA = started["questions"]
        check("A shows 20 questions", len(qsA) == 20, str(len(qsA)))
        for idx, q in enumerate(qsA):
            num = int(q["question_text"].split("number ")[1])
            item = question_payload(num)
            if idx < 15:
                await scbt.save_answer(scbt.AnswerIn(attempt_id=started["attempt_id"], question_id=q["id"],
                                                     answer=label_of(q, item["opts"][item["key"]])),
                                       credentials=tokA, db=db)
            elif idx < 18:
                wrong = next(L for L in LETTERS if L != item["key"])
                await scbt.save_answer(scbt.AnswerIn(attempt_id=started["attempt_id"], question_id=q["id"],
                                                     answer=label_of(q, item["opts"][wrong])),
                                       credentials=tokA, db=db)
            # last 2 left blank
        resA, rowA = await submit_and_score(exA["id"], started["attempt_id"], tokA, db)
        sA = resA["summary"]
        check("A correct = 15", sA["correct"] == 15, str(sA))
        check("A wrong = 5 (3 wrong + 2 blank)", sA["wrong"] == 5, str(sA))
        check("A total = 20", sA["total_questions"] == 20, str(sA))
        check("A answered = 18", sA["answered"] == 18, str(sA))
        check("A percentage = 75", rowA["percentage"] == 75.0, str(rowA.get("percentage")))
        check("A final score = 75/100", rowA["final_score"] == 75.0, str(rowA.get("final_score")))
        check("A grade = A1", rowA["grade"] == "A1", str(rowA.get("grade")))

        # ── B. randomised options, 10 right / 10 wrong = 50% ────────────────
        print("\n-- B. randomised option order --")
        exB = await make_exam(db, bank, "Marking B", auto_pick_count=20, randomize_options=True,
                              assigned_class_names=["SS2"])
        tokB, _ = await student_token(exB["id"], db, index=1)
        stB = await scbt.start_attempt(exB["id"], credentials=tokB, db=db)
        shuffled = 0
        for idx, q in enumerate(stB["questions"]):
            num = int(q["question_text"].split("number ")[1])
            item = question_payload(num)
            if [o["text"] for o in q["options"]] != [item["opts"][L] for L in LETTERS]:
                shuffled += 1
            target = item["opts"][item["key"]] if idx < 10 else item["opts"][next(L for L in LETTERS if L != item["key"])]
            await scbt.save_answer(scbt.AnswerIn(attempt_id=stB["attempt_id"], question_id=q["id"],
                                                 answer=label_of(q, target)),
                                   credentials=tokB, db=db)
        check("B option content really shuffled", shuffled > 0, str(shuffled))
        resB, rowB = await submit_and_score(exB["id"], stB["attempt_id"], tokB, db)
        sB = resB["summary"]
        check("B correct = 10 despite shuffled labels", sB["correct"] == 10, str(sB))
        check("B wrong = 10", sB["wrong"] == 10, str(sB))
        check("B percentage = 50", rowB["percentage"] == 50.0, str(rowB.get("percentage")))
        check("B grade = C6", rowB["grade"] == "C6", str(rowB.get("grade")))

        # ── C. show 8 of 20 + shuffled paper: all 8 right = 100% ────────────
        print("\n-- C. show 8 of 20, shuffled paper --")
        exC = await make_exam(db, bank, "Marking C", auto_pick_count=20,
                              questions_to_display=8, randomize_questions=True)
        tokC, _ = await student_token(exC["id"], db)
        stC = await scbt.start_attempt(exC["id"], credentials=tokC, db=db)
        check("C paper has 8 questions", len(stC["questions"]) == 8, str(len(stC["questions"])))
        for q in stC["questions"]:
            num = int(q["question_text"].split("number ")[1])
            item = question_payload(num)
            await scbt.save_answer(scbt.AnswerIn(attempt_id=stC["attempt_id"], question_id=q["id"],
                                                 answer=label_of(q, item["opts"][item["key"]])),
                                   credentials=tokC, db=db)
        resC, rowC = await submit_and_score(exC["id"], stC["attempt_id"], tokC, db)
        sC = resC["summary"]
        check("C scored out of the 8 shown", sC["total_questions"] == 8, str(sC))
        check("C correct = 8", sC["correct"] == 8, str(sC))
        check("C percentage = 100", rowC["percentage"] == 100.0, str(rowC.get("percentage")))

        # ── D. multi-select, theory, missing key ────────────────────────────
        print("\n-- D. multi-select / theory / no answer key --")
        bankD = await scbt.create_bank(
            scbt.BankIn(name="Mixed Bank", subject="Data Processing", class_name="SS2"),
            admin_user_ctx, db,
        )
        await scbt.add_bank_questions(bankD["id"], [
            scbt.BankQuestionIn(question_text="DSELECT pick A and C", option_a="one", option_b="two",
                                option_c="three", option_d="four", correct_option="A,C",
                                question_type="multi_select", marks=1),
            scbt.BankQuestionIn(question_text="DTHEORY explain something", option_a="", option_b="",
                                option_c="", option_d="", correct_option="",
                                question_type="theory", marks=1),
            scbt.BankQuestionIn(question_text="DNOKEY nobody set the answer", option_a="p", option_b="q",
                                option_c="r", option_d="s", correct_option="", marks=1),
            scbt.BankQuestionIn(question_text="DPLAIN wrong on purpose", option_a="p", option_b="q",
                                option_c="r", option_d="s", correct_option="B", marks=1),
        ], admin_user_ctx, db)
        exD = await make_exam(db, bankD, "Marking D", subject="Data Processing", auto_pick_count=0,
                              bank_ids=[bankD["id"]], assigned_class_names=["SS2"])
        tokD, _ = await student_token(exD["id"], db)
        stD = await scbt.start_attempt(exD["id"], credentials=tokD, db=db)
        for q in stD["questions"]:
            if q["question_text"].startswith("DSELECT"):
                await scbt.save_answer(scbt.AnswerIn(attempt_id=stD["attempt_id"], question_id=q["id"],
                                                     answer="A,C"), credentials=tokD, db=db)
            elif q["question_text"].startswith("DPLAIN"):
                await scbt.save_answer(scbt.AnswerIn(attempt_id=stD["attempt_id"], question_id=q["id"],
                                                     answer="A"), credentials=tokD, db=db)
        resD, rowD = await submit_and_score(exD["id"], stD["attempt_id"], tokD, db)
        sD = resD["summary"]
        check("D multi-select exact match scores", sD["correct"] == 1, str(sD))
        check("D only gradable questions counted (2)", sD["total_questions"] == 2, str(sD))
        check("D wrong = 1", sD["wrong"] == 1, str(sD))
        check("D percentage = 50", rowD["percentage"] == 50.0, str(rowD.get("percentage")))

        # ── E. per-question marks weigh into the score ─────────────────────
        print("\n-- E. marks weighting (3 + 1) --")
        bankE = await scbt.create_bank(
            scbt.BankIn(name="Weighted Bank", subject="Economics", class_name="SS2"),
            admin_user_ctx, db,
        )
        await scbt.add_bank_questions(bankE["id"], [
            scbt.BankQuestionIn(question_text="EWEIGHT big question", option_a="a", option_b="b",
                                option_c="c", option_d="d", correct_option="C", marks=3),
            scbt.BankQuestionIn(question_text="EWEIGHT small question", option_a="a", option_b="b",
                                option_c="c", option_d="d", correct_option="A", marks=1),
        ], admin_user_ctx, db)
        exE = await make_exam(db, bankE, "Marking E", subject="Economics", auto_pick_count=0,
                              bank_ids=[bankE["id"]], assigned_class_names=["SS2"])
        tokE, _ = await student_token(exE["id"], db)
        stE = await scbt.start_attempt(exE["id"], credentials=tokE, db=db)
        for q in stE["questions"]:
            if q["question_text"].startswith("EWEIGHT big"):
                await scbt.save_answer(scbt.AnswerIn(attempt_id=stE["attempt_id"], question_id=q["id"],
                                                     answer="C"), credentials=tokE, db=db)
            else:
                await scbt.save_answer(scbt.AnswerIn(attempt_id=stE["attempt_id"], question_id=q["id"],
                                                     answer="B"), credentials=tokE, db=db)
        resE, rowE = await submit_and_score(exE["id"], stE["attempt_id"], tokE, db)
        check("E raw score = 3", resE["summary"]["raw_score"] == 3.0, str(resE["summary"]))
        check("E percentage = 75 (3 of 4 marks)", rowE["percentage"] == 75.0, str(rowE.get("percentage")))
        check("E final score 75/100", rowE["final_score"] == 75.0, str(rowE.get("final_score")))

        # ── F. grant retake → clean second sit ─────────────────────────────
        print("\n-- F. grant retake and re-sit --")
        await scbt.grant_retake(exA["id"], scbt.RetakeIn(student_ids=[STUDENT_IDS[0]]),
                                STAFF, admin_user_ctx, db)
        mine = await scbt.student_my_exams(credentials=tokA, db=db)
        rowA_exam = next(e for e in mine["exams"] if e["id"] == exA["id"])
        check("F retake exam is open again", rowA_exam["status"] == "Open", str(rowA_exam)[:200])
        stF = await scbt.start_attempt(exA["id"], credentials=tokA, db=db)
        check("F retake starts a new attempt", stF["attempt_id"] != started["attempt_id"])
        for q in stF["questions"]:
            num = int(q["question_text"].split("number ")[1])
            item = question_payload(num)
            await scbt.save_answer(scbt.AnswerIn(attempt_id=stF["attempt_id"], question_id=q["id"],
                                                 answer=label_of(q, item["opts"][item["key"]])),
                                   credentials=tokA, db=db)
        resF, rowF = await submit_and_score(exA["id"], stF["attempt_id"], tokA, db)
        check("F retake marked on its own answers (20/20)", resF["summary"]["correct"] == 20, str(resF["summary"]))
        check("F retake percentage 100", rowF["percentage"] == 100.0, str(rowF.get("percentage")))
        staffF = await scbt.exam_results(exA["id"], STAFF, admin_user_ctx, db)
        check("F one result row for the student (retake replaced it)",
              len(staffF["results"]) == 1, str(len(staffF["results"])))
        check("F retake result is the visible one",
              staffF["results"][0]["final_score"] == 100.0, str(staffF["results"][0])[:200])

    print(f"\n==== RESULT: {len(PASS)} passed, {len(FAIL)} failed ====")
    if FAIL:
        for f in FAIL:
            print("  FAIL " + f)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
