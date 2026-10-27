"""Temp E2E test: catalogue + preview + confirm + exam reuse (sqlite)."""
import asyncio
import io
import os
import sys
import uuid
import zipfile

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./sx_up_test.db"
if os.path.exists("./sx_up_test.db"):
    os.remove("./sx_up_test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import AsyncSessionLocal, Base, engine, get_db  # noqa: E402
from app.core.deps import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.models.school_cbt import SchoolExQuestion, SchoolExQuestionBank  # noqa: E402
from app.models.school_subjects import SchoolSubject, SchoolSubjectOffering  # noqa: E402

SCHOOL = str(uuid.uuid4())
ADMIN = {"sub": str(uuid.uuid4()), "role": "admin", "school_id": None}


async def setup():
    from app.models.school_cbt import (  # noqa: E402
        SchoolExam, SchoolExamAccessCode, SchoolExamAssignment, SchoolExamQuestion,
    )

    async with engine.begin() as conn:
        await conn.run_sync(
            Base.metadata.create_all,
            tables=[
                SchoolSubject.__table__, SchoolSubjectOffering.__table__,
                SchoolExQuestionBank.__table__, SchoolExQuestion.__table__,
                SchoolExam.__table__, SchoolExamQuestion.__table__,
                SchoolExamAccessCode.__table__, SchoolExamAssignment.__table__,
            ],
        )
    from app.core.subject_catalog_seed import seed_subject_catalogue

    async with AsyncSessionLocal() as db:
        print("seed:", await seed_subject_catalogue(db))
        await db.commit()


async def override_db():
    async with AsyncSessionLocal() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise


async def override_user():
    return dict(ADMIN)


def make_docx(paras):
    buf = io.BytesIO()
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paras)
    xml = ('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           f"<w:body>{body}</w:body></w:document>")
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def main():
    asyncio.run(setup())
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    c = TestClient(app, raise_server_exceptions=False)
    q = {"school_id": SCHOOL}

    r = c.get("/api/v1/school-cbt/subjects/meta")
    assert r.status_code == 200, r.text
    print("meta levels:", [l["id"] for l in r.json()["levels"]])

    r = c.get("/api/v1/school-cbt/subjects", params={"level": "primary", "class_name": "Primary 3", **q})
    assert r.status_code == 200, r.text
    subs = r.json()["subjects"]
    print("primary-3 subjects:", len(subs))
    math = next(s for s in subs if s["name"] == "Mathematics")
    print("math:", math["id"], math["classes_by_level"])

    r = c.post("/api/v1/school-cbt/subjects", params=q,
               json={"name": "Robotics ", "level": "jss", "class_names": ["JSS 2"]})
    assert r.status_code == 201, r.text
    print("custom:", r.json()["subject"]["name"], "reused:", r.json()["reused"])
    r = c.post("/api/v1/school-cbt/subjects", params=q,
               json={"name": "  robotics", "level": "jss", "class_names": ["JSS 1"]})
    assert r.status_code == 201, r.text
    print("duplicate custom reused:", r.json()["reused"])
    robo_id = r.json()["subject"]["id"]

    csv_bytes = (b"question_text,option_a,option_b,option_c,option_d,correct_option,topic,marks\n"
                 b"What is 2+2?,3,4,5,6,B,Addition,2\nCapital of Nigeria?,Lagos,Abuja,Kano,Ibadan,B,Geo,1\n")
    r = c.post("/api/v1/school-cbt/bank-uploads/preview",
               params={"school_id": SCHOOL},
               data={"level": "primary", "class_name": "Primary 3", "subject_id": math["id"]},
               files={"file": ("m.csv", csv_bytes, "text/csv")})
    assert r.status_code == 200, r.text
    pv = r.json()
    print("preview:", pv["total_questions"], "valid:", pv["valid_count"], "review:", pv["needs_review_count"])

    confirm_qs = [dict(x, topic="Numbers") for x in pv["questions"]]
    r = c.post("/api/v1/school-cbt/bank-uploads/confirm",
               json={"subject_id": math["id"], "level": "primary", "class_name": "Primary 3",
                     "questions": confirm_qs, "import_mode": "skip_duplicates", "school_id": SCHOOL})
    assert r.status_code == 201, r.text
    print("confirm:", r.json())
    bank_id = r.json()["bank_id"]

    # upload same file again -> duplicates flagged in bank
    r = c.post("/api/v1/school-cbt/bank-uploads/preview",
               params={"school_id": SCHOOL},
               data={"level": "primary", "class_name": "Primary 3", "subject_id": math["id"]},
               files={"file": ("m.csv", csv_bytes, "text/csv")})
    print("dup in bank:", r.json()["duplicate_in_bank"])

    # docx + txt parse through preview
    docx = make_docx(["1. Red planet?", "A. Earth", "B. Mars", "Answer: B"])
    r = c.post("/api/v1/school-cbt/bank-uploads/preview",
               params={"school_id": SCHOOL},
               data={"level": "jss", "class_name": "JSS 2", "subject_id": robo_id},
               files={"file": ("q.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert r.status_code == 200, r.text
    print("docx preview:", r.json()["total_questions"], r.json()["questions"][0]["correct_option"])
    r = c.post("/api/v1/school-cbt/bank-uploads/preview",
               params={"school_id": SCHOOL},
               data={"level": "jss", "class_name": "JSS 2", "subject_id": robo_id},
               files={"file": ("n.txt", b"1. Boiling point of water?\nA. 90C\nB. 100C\nAnswer: B\n", "text/plain")})
    assert r.status_code == 200, r.text
    print("txt preview:", r.json()["total_questions"])

    # wrong-class subject rejected (Robotics is only enabled for JSS 1 + JSS 2)
    r = c.post("/api/v1/school-cbt/bank-uploads/preview",
               params={"school_id": SCHOOL},
               data={"level": "jss", "class_name": "JSS 3", "subject_id": robo_id},
               files={"file": ("m.csv", csv_bytes, "text/csv")})
    print("wrong class status:", r.status_code, r.json().get("detail"))
    assert r.status_code == 400, r.text

    # exam reuse: create exam from the bank
    r = c.post("/api/v1/school-cbt/exams",
               json={"title": "Maths Test", "subject": "Mathematics", "class_name": "Primary 3",
                     "bank_ids": [bank_id], "publish": False, "school_id": SCHOOL})
    if r.status_code != 201:
        print("EXAM CREATE FAILED:", r.status_code, r.text[:2000])
    assert r.status_code == 201, r.text
    print("exam from bank:", r.json().get("id"), "questions:", r.json().get("question_count", r.json()))
    print("ALL E2E OK")


if __name__ == "__main__":
    sys.exit(main())
