import hashlib
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token, _role_str
from app.core.datetime_utils import naive_utc_now
from app.models.guest_cbt_access import GuestCbtAccess
from app.models.user import User, TeacherProfile

bearer_scheme = HTTPBearer(auto_error=False)


def _norm_role(role) -> str:
    return _role_str(role)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    if credentials is None or not getattr(credentials, "credentials", None):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if "sv" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    try:
        user_id = UUID(str(sub))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    # NOTE: `payload.get("sv") or -1` would turn a legitimate sv=0 (fresh
    # account that has only ever logged in via the school portal, which does
    # not bump token_version) into -1 and reject EVERY request. Use a
    # missing-key default instead of a falsy-value default.
    if int(user.token_version or 0) != int(payload.get("sv", -1)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Logged in on another device. Please sign in again.",
        )

    payload["sub"] = str(user.id)
    # Always prefer DB role and normalize (fixes UserRole.student / case mismatches → false 403s)
    payload["role"] = _norm_role(getattr(user, "role", None) or payload.get("role") or "student")
    payload["school_id"] = str(user.school_id) if getattr(user, "school_id", None) else None
    # Sub-admin scope: None = main admin (full access); list = scoped sub-admin.
    raw_perms = (getattr(user, "sub_admin_permissions", None) or "").strip()
    payload["sub_admin_permissions"] = None if not raw_perms else [
        p for p in (s.strip() for s in raw_perms.split(",")) if p
    ]
    payload["_db"] = db
    return payload


async def require_student(current_user: dict = Depends(get_current_user)):
    if _norm_role(current_user.get("role")) != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Students only")
    return current_user


async def require_student_or_kind(current_user: dict = Depends(get_current_user)):
    role = _norm_role(current_user.get("role"))
    if role in ("student", "kind"):
        return current_user
    # Fallback: user may have a student/kind profile even if role string is odd
    db = current_user.get("_db")
    if db is not None:
        try:
            from app.models.user import StudentProfile, KindProfile

            uid = current_user.get("sub")
            sp = await db.execute(select(StudentProfile).where(StudentProfile.user_id == uid))
            if sp.scalar_one_or_none():
                current_user["role"] = "student"
                return current_user
            kp = await db.execute(select(KindProfile).where(KindProfile.user_id == uid))
            if kp.scalar_one_or_none():
                current_user["role"] = "kind"
                return current_user
        except Exception:
            pass
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Students or kid learners only",
    )


async def require_student_or_cbt_guest(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Allow an authenticated student or an active anonymous CBT package token."""
    token = credentials.credentials if credentials else ""
    if token.startswith("guest-cbt."):
        token_hash = hashlib.sha256(token[len("guest-cbt."):].encode("utf-8")).hexdigest()
        access = (
            await db.execute(
                select(GuestCbtAccess).where(
                    GuestCbtAccess.token_hash == token_hash,
                    GuestCbtAccess.is_active.is_(True),
                    GuestCbtAccess.expires_at > naive_utc_now(),
                )
            )
        ).scalar_one_or_none()
        if not access:
            raise HTTPException(status_code=401, detail="Guest CBT access is invalid or expired")
        return {
            "sub": str(access.id),
            "role": "guest",
            "guest_cbt": True,
            "guest_boards": list(access.boards or []),
            "guest_package_id": access.package_id,
        }
    current_user = await get_current_user(credentials=credentials, db=db)
    return await require_student_or_kind(current_user=current_user)


async def require_kind(current_user: dict = Depends(get_current_user)):
    if _norm_role(current_user.get("role")) != "kind":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Kind learners only")
    return current_user


async def require_teacher(current_user: dict = Depends(get_current_user)):
    if _norm_role(current_user.get("role")) != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teachers only")
    db = current_user.get("_db")
    if db is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database context missing")
    res = await db.execute(select(TeacherProfile).where(TeacherProfile.user_id == current_user["sub"]))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher profile not found")
    if not profile.is_approved:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher account pending admin approval")
    return current_user


async def require_teacher_or_admin(current_user: dict = Depends(get_current_user)):
    role = _norm_role(current_user.get("role"))
    if role not in ("teacher", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teachers or admins only",
        )
    if role == "teacher":
        db = current_user.get("_db")
        if db is None:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database context missing")
        res = await db.execute(select(TeacherProfile).where(TeacherProfile.user_id == current_user["sub"]))
        profile = res.scalar_one_or_none()
        if not profile or not profile.is_approved:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher account pending admin approval")
    return current_user


async def require_vendor(current_user: dict = Depends(get_current_user)):
    if _norm_role(current_user.get("role")) != "vendor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Vendors only")
    return current_user


async def require_vendor_or_admin(current_user: dict = Depends(get_current_user)):
    if _norm_role(current_user.get("role")) not in ("vendor", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Vendors or admins only")
    return current_user


async def require_admin(current_user: dict = Depends(get_current_user)):
    if _norm_role(current_user.get("role")) != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Main Scholaxia admin only")
    return current_user


async def require_school_staff(current_user: dict = Depends(get_current_user)):
    """Main admin (all schools) or a school admin (their campus only)."""
    role = _norm_role(current_user.get("role"))
    if role == "admin":
        return current_user
    if role != "school_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="School admin or main admin only",
        )
    if not current_user.get("school_id"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This school admin is not assigned to a school yet",
        )
    return current_user


async def require_developer(current_user: dict = Depends(get_current_user)):
    if _norm_role(current_user.get("role")) not in ("developer", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Developer account required")
    return current_user
