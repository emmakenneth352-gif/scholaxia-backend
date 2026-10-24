import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func
from pydantic import BaseModel, EmailStr, Field, ValidationError
from typing import Optional
from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token, issue_auth_tokens
from app.core.config import settings
from app.models.user import User, UserRole, StudentProfile, TeacherProfile, VendorProfile, KindProfile
from app.services.otp_service import (
    OtpStoreUnavailable,
    send_otp,
    verify_otp,
    store_pending_signup,
    load_pending_signup,
    clear_pending_signup,
)
from app.services.firebase_auth_service import (
    normalize_phone,
    phone_to_email,
    phone_from_firebase_token,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)


class StudentSignupRequest(BaseModel):
    """Legacy email signup (kept for older clients). Prefer phone OTP flow."""
    email: EmailStr
    password: str
    full_name: str


class KindSignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    age_group: str = "6-8"
    grade_level: Optional[str] = None
    parent_email: Optional[EmailStr] = None
    favorite_subjects: Optional[list] = None


class LoginRequest(BaseModel):
    password: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None  # legacy phone login (older clients)
    # School platform: students sign in WITHOUT email — student ID /
    # registration number + password (or the slip access code).
    student_id: Optional[str] = None
    access_code: Optional[str] = None
    email_or_id: Optional[str] = None  # single identifier field from the web form


class SendOtpRequest(BaseModel):
    email: EmailStr
    purpose: str = "signup"  # signup | login | reset_password


class PasswordResetRequest(BaseModel):
    email: EmailStr
    otp: str = Field(..., min_length=4, max_length=10)
    new_password: str = Field(..., min_length=8, max_length=128)


class SignupStartRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role: str = "student"  # student | kind | teacher | vendor
    age_group: str = "6-8"
    grade_level: Optional[str] = None
    parent_email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    subjects: Optional[list[str]] = None
    business_name: Optional[str] = None
    categories: Optional[list[str]] = None
    country: Optional[str] = None
    language: Optional[str] = None  # en | fr | pt | ar — drives site translation


class SignupVerifyRequest(BaseModel):
    email: EmailStr
    otp: str = Field(..., min_length=4, max_length=10)
    # Optional affiliate "Refer & Earn" code — saved from ?ref= on the portal link.
    ref_code: Optional[str] = None


class FirebaseAuthRequest(BaseModel):
    """Complete signup/login after Firebase Phone Auth SMS verification."""
    id_token: str = Field(..., min_length=20)
    mode: str = "login"  # login | signup
    full_name: Optional[str] = None
    password: Optional[str] = None
    role: str = "student"  # student | kind | teacher | vendor
    age_group: str = "6-8"
    grade_level: Optional[str] = None
    parent_email: Optional[str] = None


class OAuthRequest(BaseModel):
    provider: str
    token: str
    full_name: str = ""


class UserInfo(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    profile_picture: Optional[str] = None
    phone: Optional[str] = None
    exam_type: Optional[str] = None
    selected_subjects: Optional[list] = None
    education_level: Optional[str] = None
    has_active_subscription: Optional[bool] = None
    subjects: Optional[list] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    is_approved: Optional[bool] = None
    business_name: Optional[str] = None
    vendor_categories: Optional[list] = None
    vendor_whatsapp: Optional[str] = None
    kyc_completed: Optional[bool] = None
    country: Optional[str] = None
    language: Optional[str] = None
    # Sub-admin scope for admin dashboards: None = main admin (full access).
    sub_admin_permissions: Optional[list] = None
    age_group: Optional[str] = None
    grade_level: Optional[str] = None
    parent_email: Optional[str] = None
    favorite_subjects: Optional[list] = None
    learning_goals: Optional[str] = None
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    school_student_id: Optional[str] = None
    school_subscription_active: Optional[bool] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    user: UserInfo


async def _safe_rollback(db: AsyncSession) -> None:
    try:
        await db.rollback()
    except Exception:
        pass


async def _build_user_info(user: User, db: AsyncSession) -> UserInfo:
    role = user.role.value if hasattr(user.role, "value") else str(user.role or "student")
    try:
        info = UserInfo(
            id=str(user.id),
            email=str(getattr(user, "email", "") or ""),
            full_name=str(getattr(user, "full_name", "") or "Student"),
            role=role,
            profile_picture=getattr(user, "profile_picture", None),
            phone=getattr(user, "phone", None),
            country=getattr(user, "country", None),
            language=getattr(user, "language", None),
            school_id=str(user.school_id) if getattr(user, "school_id", None) else None,
        )
    except Exception:
        logger.exception("Minimal user info failed for %s", getattr(user, "email", None))
        return UserInfo(
            id=str(getattr(user, "id", "") or ""),
            email=str(getattr(user, "email", "") or "student@scholaxia.local"),
            full_name=str(getattr(user, "full_name", "") or "Student"),
            role=role or "student",
        )
    if getattr(user, "school_id", None):
        try:
            from app.models.school_campus import SchoolCampus
            campus = (
                await db.execute(select(SchoolCampus).where(SchoolCampus.id == user.school_id))
            ).scalar_one_or_none()
            if campus:
                info.school_name = campus.name
                info.school_subscription_active = bool(getattr(campus, "subscription_active", False))
        except Exception:
            await _safe_rollback(db)
    try:
        if user.role == UserRole.student:
            res = await db.execute(select(StudentProfile).where(StudentProfile.user_id == user.id))
            profile = res.scalar_one_or_none()
            if profile:
                et = profile.exam_type
                info.exam_type = et.value if hasattr(et, "value") else (str(et) if et else None)
                info.selected_subjects = profile.selected_subjects or []
                info.education_level = profile.education_level
                info.school_student_id = getattr(profile, "school_student_id", None)
                info.has_active_subscription = profile.has_active_subscription or bool(info.school_subscription_active)
        elif user.role == UserRole.teacher:
            res = await db.execute(select(TeacherProfile).where(TeacherProfile.user_id == user.id))
            profile = res.scalar_one_or_none()
            if profile:
                info.subjects = profile.subjects or []
                info.bio = profile.bio
                info.location = profile.location
                info.is_approved = bool(profile.is_approved)
        elif user.role == UserRole.vendor:
            res = await db.execute(select(VendorProfile).where(VendorProfile.user_id == user.id))
            profile = res.scalar_one_or_none()
            if profile:
                info.business_name = profile.business_name
                info.location = profile.location
                info.vendor_categories = profile.categories or []
                info.is_approved = bool(profile.is_approved)
                info.vendor_whatsapp = profile.whatsapp
                info.kyc_completed = bool(profile.kyc_completed and (profile.nin or "").strip())
        elif user.role == UserRole.kind:
            res = await db.execute(select(KindProfile).where(KindProfile.user_id == user.id))
            profile = res.scalar_one_or_none()
            if profile:
                info.age_group = profile.age_group
                info.grade_level = profile.grade_level
                info.parent_email = profile.parent_email
                info.favorite_subjects = profile.favorite_subjects or []
                info.learning_goals = profile.learning_goals
    except Exception:
        await _safe_rollback(db)
    return info


async def _user_from_sql(db: AsyncSession, email: str):
    await _safe_rollback(db)
    try:
        row = (
            await db.execute(
                text(
                    """
                    SELECT id, email, full_name, hashed_password, CAST(role AS VARCHAR) AS role,
                           COALESCE(is_active, true) AS is_active, school_id, phone,
                           profile_picture, COALESCE(token_version, 0) AS token_version
                    FROM users
                    WHERE lower(email) = lower(:e)
                    LIMIT 1
                    """
                ),
                {"e": email},
            )
        ).mappings().first()
    except Exception:
        logger.exception("SQL login lookup failed for %s", email)
        await _safe_rollback(db)
        return None
    if not row:
        return None

    class SqlUser:
        pass

    user = SqlUser()
    user.id = row["id"]
    user.email = row["email"]
    user.full_name = row["full_name"]
    user.hashed_password = row["hashed_password"]
    user.role = (row["role"] or "student").replace("UserRole.", "")
    user.is_active = bool(row["is_active"])
    user.school_id = row["school_id"]
    user.phone = row["phone"]
    user.profile_picture = row["profile_picture"]
    user.token_version = int(row["token_version"] or 0)
    return user


async def _find_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    email = email.lower().strip()
    try:
        res = await db.execute(select(User).where(User.email == email))
        return res.scalar_one_or_none()
    except Exception:
        logger.exception("ORM login lookup failed for %s", email)
        await _safe_rollback(db)
        return await _user_from_sql(db, email)


async def _find_user_by_phone(db: AsyncSession, phone_e164: str) -> Optional[User]:
    res = await db.execute(select(User).where(User.phone == phone_e164))
    user = res.scalar_one_or_none()
    if user:
        return user
    email = phone_to_email(phone_e164)
    res = await db.execute(select(User).where(User.email == email))
    return res.scalar_one_or_none()


@router.post("/firebase", response_model=TokenResponse)
async def firebase_phone_auth(payload: FirebaseAuthRequest, db: AsyncSession = Depends(get_db)):
    """
    After the client verifies SMS with Firebase Phone Auth, send the ID token here.
    mode=login  → phone must already exist
    mode=signup → create student/kind account (requires full_name + password)
    """
    phone = phone_from_firebase_token(payload.id_token)
    mode = (payload.mode or "login").strip().lower()
    if mode not in ("login", "signup"):
        raise HTTPException(status_code=400, detail="mode must be login or signup")

    user = await _find_user_by_phone(db, phone)

    if mode == "login":
        if not user:
            raise HTTPException(
                status_code=404,
                detail="No account for this phone. Please sign up first.",
            )
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account disabled")
        user.is_verified = True
        await db.flush()
        user_info = await _build_user_info(user, db)
        access_token, refresh_token = await issue_auth_tokens(db, user)
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            role=user.role,
            user=user_info,
        )

    # signup
    if user:
        raise HTTPException(status_code=400, detail="Phone already registered. Please log in.")

    full_name = (payload.full_name or "").strip()
    if len(full_name) < 2:
        raise HTTPException(status_code=400, detail="full_name is required for signup")
    password = payload.password or ""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    role = (payload.role or "student").strip().lower()
    if role not in ("student", "kind", "teacher", "vendor"):
        raise HTTPException(status_code=400, detail="role must be student, kind, teacher, or vendor")
    if role == "kind" and payload.age_group not in ("3-5", "6-8", "9-12"):
        raise HTTPException(status_code=400, detail="age_group must be 3-5, 6-8, or 9-12")

    role_map = {
        "student": UserRole.student,
        "kind": UserRole.kind,
        "teacher": UserRole.teacher,
        "vendor": UserRole.vendor,
    }
    user = User(
        email=phone_to_email(phone),
        phone=phone,
        hashed_password=hash_password(password),
        full_name=full_name,
        role=role_map.get(role, UserRole.student),
        is_verified=True,
        oauth_provider="firebase_phone",
        oauth_id=phone,
    )
    db.add(user)
    await db.flush()

    if role == "kind":
        db.add(
            KindProfile(
                user_id=user.id,
                age_group=payload.age_group or "6-8",
                grade_level=payload.grade_level,
                parent_email=payload.parent_email,
                favorite_subjects=[],
            )
        )
    elif role == "teacher":
        db.add(
            TeacherProfile(
                user_id=user.id,
                subjects=[],
                location=None,
                bio="",
                is_approved=False,
            )
        )
    elif role == "vendor":
        db.add(
            VendorProfile(
                user_id=user.id,
                business_name=full_name,
                location=None,
                categories=[],
                whatsapp=phone,
                is_approved=False,
            )
        )
    else:
        db.add(StudentProfile(user_id=user.id, selected_subjects=[]))
    await db.flush()

    user_info = await _build_user_info(user, db)
    access_token, refresh_token = await issue_auth_tokens(db, user)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        role=user.role,
        user=user_info,
    )


@router.post("/otp/send")
async def send_otp_email(payload: SendOtpRequest, db: AsyncSession = Depends(get_db)):
    """
    Send an OTP through the configured email provider.
    purpose=signup         → email must NOT be registered
    purpose=login          → email must already exist
    purpose=reset_password → email must already exist
    """
    email = payload.email.lower().strip()
    purpose = (payload.purpose or "signup").strip().lower()
    if purpose not in ("signup", "login", "reset_password"):
        raise HTTPException(
            status_code=400,
            detail="purpose must be signup, login, or reset_password",
        )

    existing = await _find_user_by_email(db, email)
    if purpose == "signup" and existing:
        raise HTTPException(status_code=400, detail="Email already registered. Please log in.")
    if purpose in ("login", "reset_password") and not existing:
        raise HTTPException(status_code=404, detail="No account found for this email.")

    name = existing.full_name if existing else "there"
    try:
        otp = await send_otp(email, name, purpose)
    except OtpStoreUnavailable as e:
        logger.exception("OTP storage unavailable while sending %s OTP", purpose)
        raise HTTPException(
            status_code=503,
            detail="Verification is temporarily unavailable. Please try again shortly.",
        ) from e
    except Exception as e:
        print(f"[OTP] email send failed for {email}: {e}")
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not send email right now (email service error: "
                + str(e)[:120].replace("\n", " ")
                + "). The Scholaxia email provider needs attention — try again later."
            ),
        )
    out = {
        "ok": True,
        "message": "OTP sent to your email",
        "email": email,
        "expires_in_minutes": settings.OTP_EXPIRE_MINUTES,
    }
    if settings.DEBUG:
        out["debug_otp"] = otp
        out["message"] = f"OTP sent to your email (debug code: {otp})"
    return out


@router.post("/password/reset")
async def reset_password(payload: PasswordResetRequest, db: AsyncSession = Depends(get_db)):
    """Verify reset OTP and set a new password."""
    email = payload.email.lower().strip()
    try:
        valid = await verify_otp(email, payload.otp, purpose="reset_password")
    except OtpStoreUnavailable as e:
        logger.exception("OTP storage unavailable while verifying reset OTP")
        raise HTTPException(
            status_code=503,
            detail="Verification is temporarily unavailable. Please try again shortly.",
        ) from e
    if not valid:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    user = await _find_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=404, detail="No account found for this email.")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    user.hashed_password = hash_password(payload.new_password)
    await db.flush()
    return {"ok": True, "message": "Password updated. You can log in with your new password."}


@router.post("/signup/start")
async def signup_start(payload: SignupStartRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 1 — collect email, name, password; send email OTP.
    Call /auth/signup/verify with the OTP to create the account.
    """
    email = payload.email.lower().strip()
    role = (payload.role or "student").strip().lower()
    if role not in ("student", "kind", "teacher", "vendor"):
        raise HTTPException(
            status_code=400,
            detail="role must be student, kind, teacher, or vendor",
        )
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if role == "kind" and payload.age_group not in ("3-5", "6-8", "9-12"):
        raise HTTPException(status_code=400, detail="age_group must be 3-5, 6-8, or 9-12")
    if role == "teacher" and not (payload.subjects or []):
        raise HTTPException(status_code=400, detail="Teacher subjects are required")
    if role == "teacher" and len((payload.phone or "").strip()) < 7:
        raise HTTPException(status_code=400, detail="WhatsApp number is required for teacher signup")
    if role == "vendor" and not (payload.business_name or "").strip():
        raise HTTPException(status_code=400, detail="Business name is required for vendor signup")
    if role == "vendor" and not (payload.location or "").strip():
        raise HTTPException(status_code=400, detail="Location is required for vendor signup")
    if role == "vendor" and not (payload.address or "").strip():
        raise HTTPException(status_code=400, detail="Address is required for vendor signup")
    if role == "vendor" and len((payload.phone or "").strip()) < 7:
        raise HTTPException(status_code=400, detail="WhatsApp / phone number is required for vendor signup")

    existing = await _find_user_by_email(db, email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered. Please log in.")

    pending = {
        "email": email,
        "full_name": payload.full_name.strip(),
        "password_hash": hash_password(payload.password),
        "role": role,
        "age_group": payload.age_group,
        "grade_level": payload.grade_level,
        "parent_email": payload.parent_email,
        "phone": (payload.phone or "").strip() or None,
        "location": (payload.location or "").strip() or None,
        "address": (payload.address or "").strip() or None,
        "subjects": payload.subjects or [],
        "business_name": (payload.business_name or "").strip() or None,
        "categories": payload.categories or [],
        "country": (payload.country or "").strip() or None,
        "language": (payload.language or "").strip().lower() or None,
    }
    try:
        await store_pending_signup(email, pending)
        otp = await send_otp(email, payload.full_name.strip(), "signup")
    except OtpStoreUnavailable as e:
        logger.exception("OTP storage unavailable during signup")
        raise HTTPException(
            status_code=503,
            detail="Verification is temporarily unavailable. Please try again shortly.",
        ) from e
    except Exception as e:
        print(f"[OTP] email send failed for {email}: {e}")
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not send the verification email right now (email service error: "
                + str(e)[:120].replace("\n", " ")
                + "). The Scholaxia email provider needs attention — try again later."
            ),
        )
    out = {
        "ok": True,
        "message": "OTP sent to your email",
        "email": email,
        "expires_in_minutes": settings.OTP_EXPIRE_MINUTES,
    }
    if settings.DEBUG:
        out["debug_otp"] = otp
        out["message"] = f"OTP sent to your email (debug code: {otp})"
    return out


@router.post("/signup/verify", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup_verify(payload: SignupVerifyRequest, db: AsyncSession = Depends(get_db)):
    """Step 2 — verify email OTP and create the account."""
    email = payload.email.lower().strip()
    try:
        valid = await verify_otp(email, payload.otp, purpose="signup")
        pending = await load_pending_signup(email)
    except OtpStoreUnavailable as e:
        logger.exception("OTP storage unavailable while verifying signup")
        raise HTTPException(
            status_code=503,
            detail="Verification is temporarily unavailable. Please try again shortly.",
        ) from e
    if not valid:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    if not pending:
        raise HTTPException(
            status_code=400,
            detail="Signup session expired. Please start signup again.",
        )

    existing = await _find_user_by_email(db, email)
    if existing:
        await clear_pending_signup(email)
        raise HTTPException(status_code=400, detail="Email already registered")

    role = pending.get("role") or "student"
    role_map = {
        "student": UserRole.student,
        "kind": UserRole.kind,
        "teacher": UserRole.teacher,
        "vendor": UserRole.vendor,
    }
    user = User(
        email=email,
        hashed_password=pending["password_hash"],
        full_name=pending["full_name"],
        role=role_map.get(role, UserRole.student),
        is_verified=True,
        phone=pending.get("phone"),
        country=pending.get("country"),
        language=pending.get("language"),
    )
    db.add(user)
    await db.flush()

    if role == "kind":
        db.add(
            KindProfile(
                user_id=user.id,
                age_group=pending.get("age_group") or "6-8",
                grade_level=pending.get("grade_level"),
                parent_email=pending.get("parent_email"),
                favorite_subjects=[],
            )
        )
    elif role == "teacher":
        db.add(
            TeacherProfile(
                user_id=user.id,
                subjects=pending.get("subjects") or [],
                location=pending.get("location"),
                bio="",
                is_approved=False,
            )
        )
    elif role == "vendor":
        vendor_phone = (pending.get("phone") or "").strip() or None
        db.add(
            VendorProfile(
                user_id=user.id,
                business_name=pending.get("business_name") or user.full_name,
                location=pending.get("location"),
                address=pending.get("address"),
                whatsapp=vendor_phone,
                categories=pending.get("categories") or [],
                is_approved=False,
                kyc_completed=False,
            )
        )
    else:
        db.add(StudentProfile(user_id=user.id, selected_subjects=[]))
    await db.flush()
    await clear_pending_signup(email)

    from app.routers.affiliate import credit_referral  # local import avoids cycles
    try:
        await credit_referral(db, payload.ref_code, user)
    except Exception:
        pass  # affiliate tracking must never block signup

    user_info = await _build_user_info(user, db)
    access_token, refresh_token = await issue_auth_tokens(db, user)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        role=user.role,
        user=user_info,
    )


@router.post("/student/signup", status_code=status.HTTP_201_CREATED)
async def student_signup(payload: StudentSignupRequest, db: AsyncSession = Depends(get_db)):
    """Legacy email signup — prefer /auth/signup/start + /auth/signup/verify."""
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=UserRole.student,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    db.add(StudentProfile(user_id=user.id, selected_subjects=[]))
    await db.flush()

    user_info = await _build_user_info(user, db)
    access_token, refresh_token = await issue_auth_tokens(db, user)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        role=user.role,
        user=user_info,
    )


@router.post("/kind/signup", status_code=status.HTTP_201_CREATED)
async def kind_signup(payload: KindSignupRequest, db: AsyncSession = Depends(get_db)):
    if payload.age_group not in ("3-5", "6-8", "9-12"):
        raise HTTPException(status_code=400, detail="age_group must be 3-5, 6-8, or 9-12")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=UserRole.kind,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    db.add(
        KindProfile(
            user_id=user.id,
            age_group=payload.age_group,
            grade_level=payload.grade_level,
            parent_email=payload.parent_email,
            favorite_subjects=payload.favorite_subjects or [],
        )
    )
    await db.flush()

    user_info = await _build_user_info(user, db)
    access_token, refresh_token = await issue_auth_tokens(db, user)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        role=user.role,
        user=user_info,
    )


async def _payload_from_request(request: Request) -> LoginRequest:
    ctype = (request.headers.get("content-type") or "").lower()
    if "application/x-www-form-urlencoded" in ctype or "multipart/form-data" in ctype:
        form = await request.form()
        email = (str(form.get("email") or "")).strip() or None
        phone = (str(form.get("phone") or "")).strip() or None
        ident = (str(form.get("email_or_id") or form.get("student_id") or "")).strip() or None
        access = (str(form.get("access_code") or "")).strip() or None
        return LoginRequest(
            email=email,
            password=str(form.get("password") or ""),
            phone=phone,
            student_id=ident,
            email_or_id=ident,
            access_code=access,
        )
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail="Send email and password")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Send email and password")
    try:
        return LoginRequest(**data)
    except ValidationError as exc:
        # Bad email/password shape etc. — surface as 422, not a raw 500.
        first = exc.errors()[0] if exc.errors() else {}
        msg = str(first.get("msg") or "Invalid email or password format")
        if "valid email" in msg.lower():
            msg = "That email address doesn't look right. Check it and try again."
        raise HTTPException(status_code=422, detail=msg)


@router.post("/login")
async def login(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await _payload_from_request(request)
    try:
        return await _login_user(payload, db)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Student login failed")
        raise HTTPException(
            status_code=503,
            detail="Could not sign in (%s). Try again in 20 seconds." % type(exc).__name__,
        )


@router.post("/login-form")
async def login_form(request: Request, db: AsyncSession = Depends(get_db)):
    return await login(request, db)


async def _find_school_student(db: AsyncSession, identifier: str):
    """Find a school student by student ID / reg number (no email needed).

    Matches StudentProfile.school_student_id first (admission number), then
    full name as a last resort (exact, case-insensitive) — school students
    often have no email at all.
    """
    ident = (identifier or "").strip()
    if not ident:
        return None
    row = (
        await db.execute(
            select(User)
            .join(StudentProfile, StudentProfile.user_id == User.id)
            .where(
                User.role == UserRole.student,
                func.upper(StudentProfile.school_student_id) == ident.upper(),
            )
            .limit(2)
        )
    ).scalars().all()
    if not row:
        row = (
            await db.execute(
                select(User)
                .join(StudentProfile, StudentProfile.user_id == User.id)
                .where(
                    User.role == UserRole.student,
                    func.upper(User.full_name) == ident.upper(),
                )
                .limit(2)
            )
        ).scalars().all()
    if not row:
        return None
    if len(row) > 1:
        # Ambiguous (duplicate names): prefer one attached to a school
        with_school = [u for u in row if u.school_id is not None]
        if len(with_school) == 1:
            return with_school[0]
        raise HTTPException(
            status_code=409,
            detail="This student ID matches more than one account. Ask your school to check the records.",
        )
    return row[0]


async def _login_user(payload: LoginRequest, db: AsyncSession):
    email_raw = (payload.email or "").strip()
    ident_raw = (payload.student_id or payload.email_or_id or "").strip()
    phone_raw = (payload.phone or "").strip()

    # Single identifier field: an "@" means email, anything else is a
    # student ID / registration number (school platform — no email needed).
    if not email_raw and ident_raw and "@" in ident_raw:
        email_raw, ident_raw = ident_raw, ""

    user = await _user_from_sql(db, email_raw) if email_raw else None

    if user is None and phone_raw:
        try:
            phone = normalize_phone(phone_raw)
        except HTTPException:
            phone = phone_raw
        user = await _find_user_by_phone(db, phone)

    if user is None and ident_raw:
        # School platform: student ID / registration number login (no email)
        user = await _find_school_student(db, ident_raw)
        if user is not None and payload.access_code:
            # Access code accepted in either field; if a password is absent,
            # the slip's access code doubles as the password.
            slip = (
                await db.execute(
                    text(
                        """
                        SELECT access_code FROM school_exam_candidates
                        WHERE UPPER(access_code) = UPPER(:code)
                          AND user_id = :uid
                        LIMIT 1
                        """
                    ),
                    {"code": (payload.access_code or "").strip(), "uid": user.id},
                )
            ).first()
            if slip:
                payload.password = (payload.access_code or "").strip()

    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=401,
            detail="No account found for that Student ID or email. Ask your school to register you, or sign up.",
        )
    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect password for this account. Try again or reset your password.",
        )

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    # Email signup finished but OTP never verified — take the user to the
    # verification step instead of logging them in.
    if not getattr(user, "is_verified", True) and email_raw:
        try:
            await send_otp(email_raw, str(user.full_name or "there"), "signup")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail="Could not send the verification email ("
                + str(e)[:120].replace("\n", " ")
                + "). Try again in a minute.",
            )
        raise HTTPException(
            status_code=403,
            detail={
                "code": "EMAIL_NOT_VERIFIED",
                "message": (
                    "Your email is not verified yet — we just sent a new code to "
                    + email_raw
                    + ". Verify it to continue."
                ),
                "email": email_raw,
            },
        )

    role = str(getattr(user, "role", "student") or "student").replace("UserRole.", "").lower()
    if role == "teacher":
        teacher_profile = (
            await db.execute(
                text(
                    "SELECT COALESCE(is_approved, false) FROM teacher_profiles "
                    "WHERE user_id = :id LIMIT 1"
                ),
                {"id": user.id},
            )
        ).scalar_one_or_none()
        if not teacher_profile:
            raise HTTPException(
                status_code=403,
                detail="Your teacher account is awaiting admin approval. You can log in after it is approved.",
            )
    school_name = None
    school_sub = False
    if getattr(user, "school_id", None):
        try:
            campus = (
                await db.execute(
                    text(
                        """
                        SELECT name, COALESCE(subscription_active, false) AS subscription_active,
                               approval_status
                        FROM school_campuses WHERE id = :id LIMIT 1
                        """
                    ),
                    {"id": user.school_id},
                )
            ).mappings().first()
            if campus:
                # Owner spec §3: a school that is still pending (or was
                # rejected/suspended) cannot sign its people in yet.
                status = (campus["approval_status"] or "approved").lower()
                if status in ("pending", "rejected", "suspended"):
                    why = {
                        "pending": "Your school is still pending review by Scholaxia. Try again once it is approved.",
                        "rejected": "Your school's registration was not approved. Contact Scholaxia support.",
                        "suspended": "Your school's account is currently suspended. Contact Scholaxia support.",
                    }[status]
                    raise HTTPException(status_code=403, detail=why)
                school_name = campus["name"]
                school_sub = bool(campus["subscription_active"])
        except HTTPException:
            raise
        except Exception:
            await _safe_rollback(db)

    education_level = None
    school_student_id = None
    has_sub = school_sub
    exam_type = None
    try:
        profile = (
            await db.execute(
                text(
                    """
                    SELECT education_level, school_student_id,
                           COALESCE(has_active_subscription, false) AS has_active_subscription,
                           CAST(exam_type AS VARCHAR) AS exam_type
                    FROM student_profiles WHERE user_id = :id LIMIT 1
                    """
                ),
                {"id": user.id},
            )
        ).mappings().first()
        if profile:
            education_level = profile["education_level"]
            school_student_id = profile["school_student_id"]
            has_sub = bool(profile["has_active_subscription"]) or school_sub
            exam_type = profile["exam_type"]
    except Exception:
        await _safe_rollback(db)

    user_info = UserInfo(
        id=str(user.id),
        email=str(user.email or ""),
        full_name=str(user.full_name or "Student"),
        role=role,
        phone=getattr(user, "phone", None),
        profile_picture=getattr(user, "profile_picture", None),
        school_id=str(user.school_id) if getattr(user, "school_id", None) else None,
        school_name=school_name,
        school_subscription_active=school_sub,
        education_level=education_level,
        school_student_id=school_student_id,
        has_active_subscription=has_sub,
        exam_type=exam_type,
        sub_admin_permissions=(
            None
            if not (getattr(user, "sub_admin_permissions", None) or "").strip()
            else [p for p in (s.strip() for s in str(user.sub_admin_permissions).split(",")) if p]
        ),
    )

    sv = int(getattr(user, "token_version", 0) or 0)
    try:
        bumped = (
            await db.execute(
                text(
                    """
                    UPDATE users
                    SET token_version = COALESCE(token_version, 0) + 1
                    WHERE id = :id
                    RETURNING token_version
                    """
                ),
                {"id": user.id},
            )
        ).first()
        if bumped:
            sv = int(bumped[0])
    except Exception:
        await _safe_rollback(db)

    access_token = create_access_token(str(user.id), role, session_version=sv)
    refresh_token = create_refresh_token(str(user.id), session_version=sv)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        role=role,
        user=user_info,
    )


@router.post("/oauth", response_model=TokenResponse)
async def oauth_login(payload: OAuthRequest, db: AsyncSession = Depends(get_db)):
    raise HTTPException(status_code=501, detail="OAuth not yet implemented")


# ── Account deletion request (Play Store requirement) ────────────────────────
class DeletionRequestPayload(BaseModel):
    email: str
    reason: str = ""
    note: str = ""


@router.post("/request-deletion")
async def request_account_deletion(
    payload: DeletionRequestPayload,
    db: AsyncSession = Depends(get_db),
):
    """Log an account deletion request. Returns 200 always so the form UX is clean.
    Admins can review pending deletions and manually process them.
    """
    import logging
    log = logging.getLogger(__name__)
    try:
        email = (payload.email or "").strip().lower()
        reason = (payload.reason or "")[:120]
        note = (payload.note or "")[:500]
        log.warning(
            "ACCOUNT_DELETION_REQUEST email=%s reason=%s note=%s",
            email, reason, note,
        )
        # Optionally send an admin notification — best-effort, never blocks response
        try:
            from app.services.notification_service import send_admins_notification
            await send_admins_notification(
                db=db,
                title="Account deletion request",
                body=f"{email} requested account deletion. Reason: {reason or 'none'}",
                notification_type="admin_alert",
                data={"email": email, "reason": reason, "note": note},
            )
        except Exception:
            pass
    except Exception as exc:
        log.exception("deletion request failed: %s", exc)
    return {"message": "Deletion request received. We will process it within 30 days."}
