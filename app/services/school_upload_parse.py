"""Parsing + validation for school question-bank uploads (Phase 1).

Supported: CSV, JSON (via cbt_import), PDF/DOCX text (via cbt_pdf_parser),
TXT (plain-text papers), XLSX (first worksheet).

Nothing here touches the database. Every row is returned with an `issues`
list so the teacher can preview and correct before confirming.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Any

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_QUESTIONS = 500
SUPPORTED_EXTENSIONS = (".csv", ".json", ".txt", ".xlsx", ".pdf", ".docx")
FORMAT_GUIDANCE = {
    "csv": "CSV columns: question_text, option_a, option_b, option_c, option_d, correct_option, topic, marks",
    "json": 'JSON: {"questions": [{"question_text, option_a..d, correct_option (A-D), topic?, marks?, explanation?, question_type?}]}',
    "txt": "TXT: numbered questions (1. …), options A–D on their own lines, answer key as ANS:, Answer: or (B).",
    "xlsx": "Excel: header row with the CSV columns (question_text, option_a..d, correct_option, topic, marks). First sheet only.",
    "pdf": "PDF: text-based papers extract automatically. Scanned/image PDFs are not supported — re-export as text PDF or use Word.",
    "docx": "Word: same numbered layout as TXT. Old .doc files must first be saved as .docx in Microsoft Word.",
}

_ANSWER_LETTER = re.compile(r"^\s*\(?([A-Da-d])\)?[\).\s]*$")


def _norm_text(v: Any) -> str:
    return str(v or "").strip()


def _normalize_answer_value(raw: Any) -> tuple[str, str | None]:
    """Return (letter or '', issue or None). Accepts A-D, 1-4, 'True'/'False'."""
    t = _norm_text(raw)
    if not t:
        return "", "missing answer"
    m = _ANSWER_LETTER.match(t)
    if m:
        return m.group(1).upper(), None
    if t in ("1", "2", "3", "4"):
        return "ABCD"[int(t) - 1], None
    low = t.lower()
    if low in ("true", "false"):
        return ("A" if low == "true" else "B"), None
    if len(t) == 1 and t.upper() in "ABCD":
        return t.upper(), None
    return "", f"unrecognised answer {t!r} (use A, B, C or D)"


def _detect_type(q: dict[str, Any]) -> str:
    explicit = _norm_text(q.get("question_type")).lower()
    if explicit in ("mcq", "true_false", "multi_select", "theory", "essay"):
        return "theory" if explicit == "essay" else explicit
    opts = [q.get("option_a", ""), q.get("option_b", ""), q.get("option_c", ""), q.get("option_d", "")]
    lows = [o.strip().lower() for o in opts if o and str(o).strip()]
    if len(lows) == 2 and set(lows) == {"true", "false"}:
        return "true_false"
    if not any(str(o or "").strip() for o in opts):
        return "theory"
    return "mcq"


def normalize_upload_row(raw: dict[str, Any], number: int) -> dict[str, Any]:
    """Lenient per-row parse — never raises, records issues instead."""
    def pick(*keys: str) -> str:
        for k in keys:
            if raw.get(k) is not None and str(raw.get(k)).strip():
                return str(raw.get(k)).strip()
        # case-insensitive fallback
        lowered = {str(k).lower(): v for k, v in (raw or {}).items()}
        for k in keys:
            if lowered.get(k) is not None and str(lowered.get(k)).strip():
                return str(lowered.get(k)).strip()
        return ""

    q = {
        "number": number,
        "question_text": pick("question_text", "question", "text", "q"),
        "option_a": pick("option_a", "a", "optiona"),
        "option_b": pick("option_b", "b", "optionb"),
        "option_c": pick("option_c", "c", "optionc"),
        "option_d": pick("option_d", "d", "optiond"),
        "topic": pick("topic", "subject_topic"),
        "explanation": pick("explanation", "explain", "solution"),
        "issues": [],
        "confidence": 1.0,
    }
    marks_raw = pick("marks", "mark", "points", "score")
    try:
        q["marks"] = max(1, min(int(float(marks_raw)), 100)) if marks_raw else 1
    except (TypeError, ValueError):
        q["marks"] = 1
        if marks_raw:
            q["issues"].append(f"marks {marks_raw!r} ignored (use 1-100)")

    q["question_type"] = _detect_type({**q, "question_type": pick("question_type", "type", "qtype")})
    letter, ans_issue = _normalize_answer_value(pick("correct_option", "answer", "correct", "correct_answer", "key"))
    q["correct_option"] = letter
    if ans_issue and q["question_type"] != "theory":
        q["issues"].append(ans_issue)

    if not q["question_text"]:
        q["issues"].append("missing question text")
    if q["question_type"] == "mcq":
        filled = [k for k in ("option_a", "option_b", "option_c", "option_d") if q[k]]
        if len(filled) < 2:
            q["issues"].append("multiple-choice needs at least 2 options")
        elif filled != ["option_a", "option_b", "option_c", "option_d"] and len(filled) < 4:
            q["issues"].append("options should fill A-D in order")
        if letter and letter not in "ABCD":
            q["issues"].append("answer must be A, B, C or D")
    elif q["question_type"] == "true_false" and letter not in ("A", "B"):
        q["issues"].append("true/false answer must be True (A) or False (B)")
    q["confidence"] = 0.4 if q["issues"] else 1.0
    return q


def parse_xlsx_questions(content: bytes) -> list[dict[str, Any]]:
    try:
        import openpyxl
    except ImportError as exc:
        raise ValueError("Excel support is not installed on the server yet.") from exc
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise ValueError(f"Could not read this Excel file: {exc}") from exc
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise ValueError("This Excel sheet is empty.")
    headers = [str(h or "").strip() for h in rows[0]]
    if not any(headers) or "question_text" not in [h.lower() for h in headers] and "question" not in [h.lower() for h in headers]:
        raise ValueError("Excel needs a header row with at least a question_text (or question) column.")
    out: list[dict[str, Any]] = []
    for i, r in enumerate(rows[1:], start=2):
        if not any(v is not None and str(v).strip() for v in (r or [])):
            continue
        raw = {headers[j]: ("" if v is None else str(v)) for j, v in enumerate(r or []) if j < len(headers)}
        out.append(normalize_upload_row(raw, len(out) + 1))
    if not out:
        raise ValueError("No question rows found in this Excel sheet.")
    return out


def parse_csv_questions(content: bytes) -> list[dict[str, Any]]:
    """Lenient CSV parse — every row becomes a question with issues flagged."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Could not read this CSV (use UTF-8 encoding).") from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV must include a header row.")
    out: list[dict[str, Any]] = []
    for row in reader:
        if not row or not any(str(v or "").strip() for v in row.values()):
            continue
        out.append(normalize_upload_row(dict(row), len(out) + 1))
    if not out:
        raise ValueError("CSV file has no question rows.")
    return out


def parse_json_questions(content: bytes) -> list[dict[str, Any]]:
    """Lenient JSON parse — accepts a list, {questions:[...]}, {exams:[...]},
    or a single exam object. Rows are validated, never rejected outright."""
    import json as _json

    try:
        data = _json.loads(content.decode("utf-8-sig"))
    except (UnicodeDecodeError, _json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc
    raws: list[dict[str, Any]] = []
    if isinstance(data, list):
        raws = [d for d in data if isinstance(d, dict)]
    elif isinstance(data, dict):
        if isinstance(data.get("questions"), list):
            raws = [d for d in data["questions"] if isinstance(d, dict)]
        elif isinstance(data.get("items"), list):
            raws = [d for d in data["items"] if isinstance(d, dict)]
        elif isinstance(data.get("exams"), list):
            for ex in data["exams"]:
                if isinstance(ex, dict):
                    raws.extend([d for d in (ex.get("questions") or []) if isinstance(d, dict)])
        elif any(k in data for k in ("question_text", "question", "text", "q")):
            raws = [data]
    if not raws:
        raise ValueError('JSON must hold questions: a list, {"questions": [...]}, or {"exams": [...]}.')
    return [normalize_upload_row(raw, i) for i, raw in enumerate(raws, start=1)]


def parse_txt_questions(content: bytes) -> list[dict[str, Any]]:
    from app.services.cbt_pdf_parser import PDFParseError, _parse_questions_from_text

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Could not read this text file (use UTF-8 encoding).") from exc
    try:
        result = _parse_questions_from_text(text, "Text file")
    except PDFParseError as exc:
        raise ValueError(str(exc)) from exc
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(result.get("questions") or [], start=1):
        q = normalize_upload_row(raw, i)
        # keep parser confidence/issues alongside row validation
        for issue in raw.get("issues") or []:
            if issue not in q["issues"]:
                q["issues"].append(issue)
        try:
            conf = float(raw.get("confidence") or 1.0)
        except (TypeError, ValueError):
            conf = 1.0
        q["confidence"] = min(q["confidence"], conf)
        out.append(q)
    if not out:
        raise ValueError("No questions detected in this text file. Number them like 1. 2. 3. with options A–D.")
    return out


def parse_upload_file(filename: str, content: bytes) -> dict[str, Any]:
    """Parse any supported upload into flat question rows. Raises ValueError."""
    if not content:
        raise ValueError("The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("File is larger than 10 MB. Split it and upload in parts.")
    name = (filename or "").lower()
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""
    if ext == ".xls":
        raise ValueError("Old .xls files are not supported — re-save as .xlsx in Excel, then upload.")
    if ext == ".doc":
        raise ValueError("Old .doc files are not supported — re-save as .docx in Word, then upload.")
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type {ext or '(none)'}. Upload CSV, Excel (.xlsx), JSON, TXT, PDF or Word (.docx).")

    warnings: list[str] = []
    if ext == ".csv":
        questions, source = parse_csv_questions(content), "csv"
    elif ext == ".json":
        questions, source = parse_json_questions(content), "json"
    elif ext == ".xlsx":
        questions, source = parse_xlsx_questions(content), "xlsx"
    elif ext == ".txt":
        questions, source = parse_txt_questions(content), "txt"
    else:  # pdf / docx via the text parser (no OCR — clear error for scans)
        from app.services.cbt_pdf_parser import (
            PDFParseError,
            parse_docx_questions,
            parse_pdf_questions,
        )

        try:
            result = parse_docx_questions(content) if ext == ".docx" else parse_pdf_questions(content)
        except PDFParseError as exc:
            raise ValueError(str(exc)) from exc
        questions = [normalize_upload_row({**raw, "number": i}, i) for i, raw in enumerate(result.get("questions") or [], start=1)]
        for q, raw in zip(questions, result.get("questions") or []):
            for issue in raw.get("issues") or []:
                if issue not in q["issues"]:
                    q["issues"].append(issue)
        warnings = list(result.get("warnings") or [])
        source = "docx" if ext == ".docx" else "pdf"

    if not questions:
        raise ValueError("No questions detected in this file. Check the format guidance and try again.")
    if len(questions) > MAX_QUESTIONS:
        raise ValueError(f"Too many questions ({len(questions)}). Split into files of {MAX_QUESTIONS} or fewer.")
    return {"source": source, "questions": questions, "warnings": warnings}
