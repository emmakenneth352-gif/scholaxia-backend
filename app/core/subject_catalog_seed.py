"""Seed data for the global (shared) subject catalogue.

Initial catalogue only — administrators can add, disable, or extend it per
school from the admin panel. Names follow the owner spec; near-duplicates
across levels share one canonical row (e.g. "Fine Arts").
"""
from __future__ import annotations

from app.models.school_subjects import LEVEL_JSS, LEVEL_PRIMARY, LEVEL_SSS

CRS = "Christian Religious Studies (CRS)"
IRS = "Islamic Religious Studies (IRS)"
NIG_LANG = "Nigerian Language"
COMPUTER = "Computer Studies / ICT"

PRIMARY_SUBJECTS = [
    "English Studies",
    "Mathematics",
    "Basic Science and Technology",
    "Physical and Health Education",
    COMPUTER,
    "Social Studies",
    "Civic Education",
    "Cultural and Creative Arts",
    NIG_LANG,
    CRS,
    IRS,
    "Agricultural Science",
    "Home Economics",
    "History",
    "Security Education",
    "Handwriting",
    "Phonics",
    "Reading",
    "Writing",
    "Verbal Reasoning",
    "Quantitative Reasoning",
    "French",
    "Physical Education",
    "Music",
    "Fine Arts",
]

JSS_SUBJECTS = [
    "English Language",
    "Mathematics",
    "Basic Science",
    "Basic Technology",
    "Business Studies",
    COMPUTER,
    "Social Studies",
    "Civic Education",
    "Physical and Health Education",
    "Cultural and Creative Arts",
    "Agricultural Science",
    "Home Economics",
    CRS,
    IRS,
    NIG_LANG,
    "French",
    "Arabic",
    "History",
    "Security Education",
    "Pre-vocational Studies",
    "Entrepreneurship",
    "Technical Drawing",
    "Reading and Writing",
]

SSS_SUBJECTS = [
    "English Language",
    "Mathematics",
    "Civic Education",
    COMPUTER,
    NIG_LANG,
    "French",
    "Arabic",
    "Biology",
    "Chemistry",
    "Physics",
    "Further Mathematics",
    "Agricultural Science",
    "Computer Science",
    "Data Processing",
    "Technical Drawing",
    "Geography",
    "Health Education",
    "Physical Education",
    "Fisheries",
    "Animal Husbandry",
    "Economics",
    "Commerce",
    "Financial Accounting",
    "Marketing",
    "Insurance",
    "Office Practice",
    "Store Management",
    "Business Studies",
    "Literature-in-English",
    "Government",
    "History",
    CRS,
    IRS,
    "Fine Arts",
    "Music",
    "Food and Nutrition",
    "Home Management",
    "Clothing and Textiles",
]

# level -> subjects offered in every class of that level by default.
CATALOGUE: dict[str, list[str]] = {
    LEVEL_PRIMARY: PRIMARY_SUBJECTS,
    LEVEL_JSS: JSS_SUBJECTS,
    LEVEL_SSS: SSS_SUBJECTS,
}


async def seed_subject_catalogue(db) -> dict[str, int]:
    """Idempotently seed global subjects + offerings. Returns counts added."""
    from sqlalchemy import select

    from app.models.school_subjects import (
        LEVEL_CLASSES,
        SchoolSubject,
        SchoolSubjectOffering,
        normalize_subject_name,
    )

    added_subjects = 0
    added_offerings = 0
    cache: dict[str, SchoolSubject] = {}

    async def get_subject(name: str) -> tuple[SchoolSubject, bool]:
        norm = normalize_subject_name(name)
        if norm in cache:
            return cache[norm], False
        row = (
            await db.execute(
                select(SchoolSubject).where(
                    SchoolSubject.school_id.is_(None),
                    SchoolSubject.normalized == norm,
                )
            )
        ).scalars().first()
        if row is None:
            row = SchoolSubject(name=name.strip(), normalized=norm, school_id=None)
            db.add(row)
            await db.flush()
            cache[norm] = row
            return row, True
        cache[norm] = row
        return row, False

    for level, names in CATALOGUE.items():
        seen: set[str] = set()
        for name in names:
            norm = normalize_subject_name(name)
            if norm in seen:
                continue
            seen.add(norm)
            subj, created = await get_subject(name)
            if created:
                added_subjects += 1
            for class_name in LEVEL_CLASSES[level]:
                exists = (
                    await db.execute(
                        select(SchoolSubjectOffering).where(
                            SchoolSubjectOffering.subject_id == subj.id,
                            SchoolSubjectOffering.school_id.is_(None),
                            SchoolSubjectOffering.level == level,
                            SchoolSubjectOffering.class_name == class_name,
                        )
                    )
                ).scalars().first()
                if exists is None:
                    db.add(
                        SchoolSubjectOffering(
                            subject_id=subj.id,
                            school_id=None,
                            level=level,
                            class_name=class_name,
                            is_enabled=True,
                        )
                    )
                    added_offerings += 1
    await db.flush()
    return {"subjects": added_subjects, "offerings": added_offerings}
