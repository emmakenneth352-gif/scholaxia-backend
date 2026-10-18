"""Read-only: count published practice questions per exam_type/subject."""
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
_db_url = os.environ.get("DATABASE_URL", "")
if _db_url and ".oregon-postgres.render.com" not in _db_url:
    os.environ["DATABASE_URL"] = _db_url.replace(
        "dpg-d8co30jtqb8s738m3f10-a",
        "dpg-d8co30jtqb8s738m3f10-a.oregon-postgres.render.com",
    )

from collections import Counter

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.cbt import CBTExam, CBTQuestion


async def main() -> int:
    async with AsyncSessionLocal() as db:
        exams = (
            await db.execute(
                select(CBTExam).where(
                    CBTExam.is_published.is_(True),
                    CBTExam.is_school_exam.is_(False),
                )
            )
        ).scalars().all()
        by_id = {e.id: e for e in exams}
        counts: Counter = Counter()
        qids = (
            await db.execute(select(CBTQuestion.exam_id, CBTQuestion.id))
        ).all()
        for exam_id, _qid in qids:
            ex = by_id.get(exam_id)
            if ex is None:
                continue
            counts[(ex.exam_type, ex.subject)] += 1
        print("Published practice questions by exam_type / subject:")
        for (etype, subj), n in sorted(counts.items()):
            print(f"  {etype:<14} {subj:<38} {n}")
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
