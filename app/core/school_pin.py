"""The school admin PIN that guards editing and deleting.

Teachers and the school admin share the same school portal. Read screens are
open to both; the things that change or delete school data ask for the 6-digit
PIN the school admin set in Settings. A teacher does not know it, so they get
"PIN_REQUIRED" and have to ask their school admin.
"""

from fastapi import HTTPException, Request

from app.core.security import verify_password

PIN_HEADER = "X-School-Pin"
PIN_REQUIRED = "PIN_REQUIRED"


def _role(current_user: dict) -> str:
    return str((current_user or {}).get("role") or "").lower().replace("userrole.", "")


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
