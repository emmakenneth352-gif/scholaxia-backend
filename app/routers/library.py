"""
Library Router
--------------
Student Library  — books uploaded by admin for students
Teacher Library  — books uploaded by admin specifically for teachers

Rules (same for both):
  - Download is off unless admin marks the item downloadable
  - No copy / text selection (DRM flag sent to frontend)
  - No screenshot unless flagged otherwise (frontend enforces)
  - Books can be saved inside the app (SavedBook)
  - Reading progress is tracked (BookReadProgress)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import or_, select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.core.database import get_db
from app.core.deps import get_current_user, require_student, require_teacher, require_kind
from app.models.content import Book, BookPurchase, SavedBook, BookReadProgress, LibraryTarget
from app.models.user import UserRole
from app.services.media_service import generate_read_url, fetch_book_bytes

router = APIRouter(prefix="/library", tags=["Library"])


# ── Shared: Book detail response with DRM flags ───────────────────────────────

def _book_response(book: Book, read_url: str = None, current_page: int = 1,
                   has_access: bool = True) -> dict:
    return {
        "id": str(book.id),
        "title": book.title,
        "author": book.author,
        "subject": book.subject,
        "exam_type": book.exam_type,
        "cover_image_url": book.cover_image_url,
        "description": book.description,
        "total_pages": book.total_pages,
        "category": getattr(book, "category", "Books") or "Books",
        "education_level": getattr(book, "education_level", None),
        "term": getattr(book, "term", None),
        "scheme_week": getattr(book, "scheme_week", None),
        "scheme_topic": getattr(book, "scheme_topic", None),
        "library_target": book.library_target,
        "source": "scholaxia",
        "is_free": getattr(book, "is_free", True),
        "price": float(getattr(book, "price", 0) or 0),
        "has_access": has_access,
        "is_downloadable": bool(getattr(book, "is_downloadable", False)),
        # DRM flags — frontend must respect these
        "drm": {
            "is_downloadable": bool(getattr(book, "is_downloadable", False)),
            "allow_copy": False,            # no text selection or highlight copy
            "allow_screenshot": False,      # frontend blocks screenshot
            "allow_print": False,
        },
        # Signed read URL — expires in 30 min, inline only (no download trigger)
        "read_url": read_url,
        "current_page": current_page,
    }


async def _student_has_book_access(db: AsyncSession, student_id: str, book: Book) -> bool:
    if getattr(book, "is_free", True):
        return True
    result = await db.execute(
        select(BookPurchase).where(
            BookPurchase.student_id == student_id,
            BookPurchase.book_id == book.id,
        )
    )
    return result.scalar_one_or_none() is not None


async def _book_for_read(book_id: str, current_user: dict, db: AsyncSession) -> Book:
    result = await db.execute(select(Book).where(Book.id == book_id, Book.is_active == True))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    role = current_user.get("role")
    if role == UserRole.student and book.library_target != LibraryTarget.student:
        raise HTTPException(status_code=403, detail="This book is not in your library")
    if role == UserRole.teacher and book.library_target != LibraryTarget.teacher:
        raise HTTPException(status_code=403, detail="This book is not in your library")
    if role == UserRole.kind and book.library_target != LibraryTarget.kind:
        raise HTTPException(status_code=403, detail="This book is not in your library")
    if role in (UserRole.student, UserRole.kind):
        if not await _student_has_book_access(db, current_user["sub"], book):
            raise HTTPException(status_code=402, detail="Pay to unlock this Scholaxia material")
    return book


# ── Student Library ───────────────────────────────────────────────────────────

@router.get("/student")
async def student_library(
    subject: Optional[str] = None,
    exam_type: Optional[str] = None,
    q: Optional[str] = None,
    category: Optional[str] = None,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Browse all books available in the student library."""
    query = select(Book).where(
        Book.library_target == LibraryTarget.student,
        Book.is_active == True,
    )
    if subject:
        query = query.where(Book.subject == subject)
    if exam_type:
        query = query.where(Book.exam_type.ilike(exam_type))
    if category:
        query = query.where(Book.category.ilike(category))
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.where(
            or_(
                Book.title.ilike(term),
                Book.author.ilike(term),
                Book.subject.ilike(term),
                Book.description.ilike(term),
                Book.scheme_topic.ilike(term),
                Book.category.ilike(term),
            )
        )

    result = await db.execute(query.order_by(Book.created_at.desc()))
    books = result.scalars().all()

    paid_ids = [b.id for b in books if not getattr(b, "is_free", True)]
    purchased_ids = set()
    if paid_ids:
        purchases = await db.execute(
            select(BookPurchase.book_id).where(
                BookPurchase.student_id == current_user["sub"],
                BookPurchase.book_id.in_(paid_ids),
            )
        )
        purchased_ids = set(purchases.scalars().all())

    return [
        _book_response(
            book,
            has_access=getattr(book, "is_free", True) or book.id in purchased_ids,
        )
        for book in books
    ]


# ── Public past questions (browsing needs no account) ─────────────────────────

@router.get("/public")
async def public_library(
    subject: Optional[str] = None,
    exam_type: Optional[str] = None,
    q: Optional[str] = None,
    category: Optional[str] = Query("Past Questions"),
    db: AsyncSession = Depends(get_db),
):
    """The past-question shelf anyone can browse.

    Only opening a paper (read / download) or buying one needs an account, so
    guests on the desktop app and the website can still see what is available.
    No read URL is handed out here.
    """
    query = select(Book).where(
        Book.library_target == LibraryTarget.student,
        Book.is_active == True,
    )
    if subject:
        query = query.where(Book.subject == subject)
    if exam_type:
        query = query.where(Book.exam_type.ilike(exam_type))
    if category:
        query = query.where(Book.category.ilike(category))
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.where(
            or_(
                Book.title.ilike(term),
                Book.author.ilike(term),
                Book.subject.ilike(term),
                Book.description.ilike(term),
                Book.category.ilike(term),
            )
        )

    result = await db.execute(query.order_by(Book.created_at.desc()))
    books = result.scalars().all()
    return [
        _book_response(book, has_access=bool(getattr(book, "is_free", True)))
        for book in books
    ]


# ── Kids Library (kind learners only) ─────────────────────────────────────────

@router.get("/kind")
async def kind_library(
    subject: Optional[str] = None,
    exam_type: Optional[str] = None,
    q: Optional[str] = None,
    category: Optional[str] = None,
    current_user: dict = Depends(require_kind),
    db: AsyncSession = Depends(get_db),
):
    """Browse PDF materials uploaded for Kids (separate from student library)."""
    query = select(Book).where(
        Book.library_target == LibraryTarget.kind,
        Book.is_active == True,
    )
    if subject:
        query = query.where(Book.subject == subject)
    if exam_type:
        query = query.where(Book.exam_type.ilike(exam_type))
    if category:
        query = query.where(Book.category.ilike(category))
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.where(
            or_(
                Book.title.ilike(term),
                Book.author.ilike(term),
                Book.subject.ilike(term),
                Book.description.ilike(term),
                Book.category.ilike(term),
            )
        )

    result = await db.execute(query.order_by(Book.created_at.desc()))
    books = result.scalars().all()

    paid_ids = [b.id for b in books if not getattr(b, "is_free", True)]
    purchased_ids = set()
    if paid_ids:
        purchases = await db.execute(
            select(BookPurchase.book_id).where(
                BookPurchase.student_id == current_user["sub"],
                BookPurchase.book_id.in_(paid_ids),
            )
        )
        purchased_ids = set(purchases.scalars().all())

    return [
        _book_response(
            book,
            has_access=getattr(book, "is_free", True) or book.id in purchased_ids,
        )
        for book in books
    ]


# ── Teacher Library ───────────────────────────────────────────────────────────

@router.get("/teacher")
async def teacher_library(
    subject: Optional[str] = None,
    current_user: dict = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Browse all books sent to teachers by admin."""
    query = select(Book).where(
        Book.library_target == LibraryTarget.teacher,
        Book.is_active == True,
    )
    if subject:
        query = query.where(Book.subject == subject)

    result = await db.execute(query.order_by(Book.created_at.desc()))
    books = result.scalars().all()

    return [_book_response(b) for b in books]


# ── Open a book (get signed read URL) ────────────────────────────────────────

@router.get("/{book_id}/read")
async def open_book(
    book_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a short-lived signed URL to render the book inside the app.
    Prefer GET /{book_id}/file on the website — Cloudinary authenticated
    links return HTTP 401 if opened in a new browser tab.
    """
    book = await _book_for_read(book_id, current_user, db)

    progress_result = await db.execute(
        select(BookReadProgress).where(
            BookReadProgress.user_id == current_user["sub"],
            BookReadProgress.book_id == book_id,
        )
    )
    progress = progress_result.scalar_one_or_none()
    current_page = progress.current_page if progress else 1

    read_url = generate_read_url(book.file_key, expires_in_seconds=1800)
    return _book_response(book, read_url=read_url, current_page=current_page, has_access=True)


@router.get("/{book_id}/file")
async def stream_book_file(
    book_id: str,
    download: bool = Query(False),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream the PDF through Scholaxia so the student site can show it without a 401 tab."""
    book = await _book_for_read(book_id, current_user, db)
    if download and not bool(getattr(book, "is_downloadable", False)):
        raise HTTPException(status_code=403, detail="This material is not downloadable.")
    try:
        content, content_type = fetch_book_bytes(book.file_key)
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="This PDF could not be opened. Wait one minute after a server update, then try Read again. If it still fails, Admin → Library → Replace PDF.",
        )
    filename = "".join(ch if ch.isalnum() or ch in " ._-" else "_" for ch in (book.title or "material"))[:80]
    if not filename.lower().endswith(".pdf") and content_type == "application/pdf":
        filename = filename + ".pdf"
    disposition = "attachment" if download else "inline"
    return Response(
        content=content,
        media_type=content_type or "application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "private, max-age=60",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ── Save a book inside the app ────────────────────────────────────────────────

@router.post("/{book_id}/save")
async def save_book(
    book_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Save a book to the user's in-app library.
    This does NOT download the file — it just bookmarks it inside the app.
    """
    result = await db.execute(select(Book).where(Book.id == book_id, Book.is_active == True))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Check not already saved
    existing = await db.execute(
        select(SavedBook).where(
            SavedBook.user_id == current_user["sub"],
            SavedBook.book_id == book_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "Already saved"}

    saved = SavedBook(user_id=current_user["sub"], book_id=book_id)
    db.add(saved)
    await db.flush()
    return {"message": "Book saved to your library", "book_id": book_id}


@router.delete("/{book_id}/save")
async def unsave_book(
    book_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a book from saved list."""
    result = await db.execute(
        select(SavedBook).where(
            SavedBook.user_id == current_user["sub"],
            SavedBook.book_id == book_id,
        )
    )
    saved = result.scalar_one_or_none()
    if not saved:
        raise HTTPException(status_code=404, detail="Book not in saved list")
    await db.delete(saved)
    return {"message": "Removed from saved"}


@router.get("/saved")
async def my_saved_books(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all books the user has saved inside the app."""
    result = await db.execute(
        select(SavedBook, Book)
        .join(Book, Book.id == SavedBook.book_id)
        .where(SavedBook.user_id == current_user["sub"])
        .order_by(SavedBook.saved_at.desc())
    )
    rows = result.all()
    return [_book_response(b) for _, b in rows]


# ── Reading progress ──────────────────────────────────────────────────────────

class UpdateProgressRequest(BaseModel):
    current_page: int


@router.post("/{book_id}/progress")
async def update_read_progress(
    book_id: str,
    payload: UpdateProgressRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Frontend calls this as the user turns pages — tracks where they left off."""
    result = await db.execute(
        select(BookReadProgress).where(
            BookReadProgress.user_id == current_user["sub"],
            BookReadProgress.book_id == book_id,
        )
    )
    progress = result.scalar_one_or_none()

    if progress:
        progress.current_page = payload.current_page
        progress.last_read_at = datetime.utcnow()
    else:
        progress = BookReadProgress(
            user_id=current_user["sub"],
            book_id=book_id,
            current_page=payload.current_page,
        )
        db.add(progress)

    await db.flush()
    return {"book_id": book_id, "current_page": payload.current_page}
