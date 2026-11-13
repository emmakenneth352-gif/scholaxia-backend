"""The school admin PIN that guards editing and deleting.

Teachers and the school admin share the same school portal. Read screens are
open to both; the things that change or delete school data ask for the 6-digit
PIN the school admin set in Settings. A teacher does not know it, so they get
"PIN_REQUIRED" and have to ask their school admin.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_school_staff
from app.core.security import verify_password

PIN_HEADER = "X-School-Pin"
PIN_REQUIRED = "PIN_REQUIRED"


def _role(current_user: dict) -> str:
    return str((current_user or {}).get("role") or "").lower().replace("userrole.", "")


# Write requests that change or remove school data. Reads are never gated.
_WRITE_METHODS = {"DELETE", "PATCH", "PUT"}
_DESTRUCTIVE_POSTS = ("/delete", "/clear", "/restrict", "/remove")


def is_write(request: Request) -> bool:
    method = request.method.upper()
    if method in _WRITE_METHODS:
        return True
    if method == "POST":
        path = request.url.path.lower()
        return any(marker in path for marker in _DESTRUCTIVE_POSTS)
    return False


async def require_write_pin(
    request: Request,
    current_user: dict = Depends(require_school_staff),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Router-level guard: any write on a school endpoint needs the admin PIN.

    Applied with `dependencies=[Depends(require_write_pin)]`, so every current
    and future DELETE/PATCH/PUT (and delete-all / clear / restrict POST) is
    covered without touching each route by hand.
    """
    if not is_write(request):
        return
    sid = current_user.get("school_id") or request.query_params.get("school_id")
    if not sid:
        return
    from app.models.school_campus import SchoolCampus

    campus = (
        await db.execute(select(SchoolCampus).where(SchoolCampus.id == sid))
    ).scalar_one_or_none()
    if campus is None:
        return
    await require_admin_pin(request, campus, current_user)


async def require_admin_pin(request: Request, campus, current_user: dict) -> None:
    """Raise unless the caller is allowed to change this school.

    - Platform admin: always allowed.
    - School admin with no PIN set yet: allowed (they are prompted to create one).
    - Everyone else: must send the correct X-School-Pin header.
    """
    role = _role(current_user)
    if role == "admin":
        return
    has_pin = bool(getattr(campus, "admin_pin_hash", None))
    if not has_pin:
        if role == "school_admin":
            return
        raise HTTPException(status_code=403, detail=PIN_REQUIRED)
    sent = (request.headers.get(PIN_HEADER) or "").strip()
    if sent and verify_password(sent, campus.admin_pin_hash):
        return
    raise HTTPException(status_code=403, detail=PIN_REQUIRED)
