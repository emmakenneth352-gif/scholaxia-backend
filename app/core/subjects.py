"""Shared subject list for exam setup and filtering."""

AVAILABLE_SUBJECTS = [
    "Mathematics",
    "English Language",
    "Biology",
    "Chemistry",
    "Physics",
    "Economics",
    "Government",
    "Geography",
    "Literature in English",
    "Agricultural Science",
    "Commerce",
    "Christian Religious Studies",
    "Islamic Religious Studies",
    "Further Mathematics",
    "Citizenship and Heritage Studies (Civic)",
    "Physical Education",
    "Office Practice",
    "Home Management",
    "Fine Arts",
    "Animal Husbandry",
    "Book Keeping",
    "Data Processing",
    # Remaining JAMB UTME subjects
    "Arabic",
    "Art (Fine Art)",
    "Hausa",
    "History",
    "Home Economics",
    "Igbo",
    "Music",
    "Physical and Health Education",
    "Principles of Accounts",
    "Yoruba",
    # Skill-acquisition papers schools register candidates for
    "Coding & Programming",
    "Graphics Design",
    "Digital Marketing",
    "Web Design",
]

# Junior WAEC (BECE) — nine core Junior Secondary subjects, one paper at a time.
JUNIOR_WAEC_SUBJECTS = [
    "English Studies",
    "Mathematics",
    "Basic Science",
    "Basic Technology",
    "Social Studies",
    "Business Studies",
    "Civic Education",
    "Computer Studies/ICT",
    "Agricultural Science",
]

# Common Entrance CBT — three papers taken together (like JAMB).
COMMON_ENTRANCE_SUBJECTS = [
    "Mathematics / Quantitative Reasoning",
    "English Language / Verbal Reasoning",
    "General Knowledge",
]


def subject_matches(exam_subject: str, selected_subjects: list[str]) -> bool:
    """Flexible match: 'English' matches 'English Language', 'Maths' matches 'Mathematics'."""
    if not selected_subjects:
        return True
    exam_s = (exam_subject or "").lower().strip()
    aliases = {
        "math": "mathematics",
        "maths": "mathematics",
        "further math": "further mathematics",
        "further maths": "further mathematics",
        "english": "english language",
        "agric": "agricultural science",
        "agriculture": "agricultural science",
        "crs": "christian religious studies",
        "c.r.s": "christian religious studies",
        "c.r.s.": "christian religious studies",
        "christian religious studies": "christian religious studies",
        "irs": "islamic religious studies",
        "i.r.s": "islamic religious studies",
        "i.r.s.": "islamic religious studies",
        "islamic religious studies": "islamic religious studies",
        "literature": "literature in english",
        "lit": "literature in english",
        "literature-in-english": "literature in english",
        "civic": "citizenship and heritage studies (civic)",
        "civic education": "citizenship and heritage studies (civic)",
        "citizenship and heritage studies (civic)": "citizenship and heritage studies (civic)",
        "econs": "economics",
        "govt": "government",
        "geo": "geography",
        "pe": "physical education",
        "p.e": "physical education",
        "physical and health education": "physical education",
        "phe": "physical education",
        "bookkeeping": "book keeping",
        "book-keeping": "book keeping",
        "fine art": "fine arts",
        "visual arts": "fine arts",
        "animal husbandry": "animal husbandry",
        "livestock farming": "animal husbandry",
        "data processing": "data processing",
        "computer studies": "data processing",
        "computer studies/ict": "data processing",
        "office practice": "office practice",
        "accounting": "principles of accounts",
        "accounts": "principles of accounts",
        "principles of accounts": "principles of accounts",
        "financial accounting": "principles of accounts",
        "art": "fine arts",
        "coding": "coding & programming",
        "programming": "coding & programming",
        "graphics": "graphics design",
        "graphic design": "graphics design",
        "web design": "web design",
        "websites": "web design",
        "digital marketing": "digital marketing",
    }
    exam_norm = aliases.get(exam_s, exam_s)
    for s in selected_subjects:
        sl = (s or "").lower().strip()
        sl_norm = aliases.get(sl, sl)
        if (
            exam_norm == sl_norm
            or exam_s == sl
            or exam_s in sl
            or sl in exam_s
            or exam_norm in sl_norm
            or sl_norm in exam_norm
        ):
            return True
    return False
