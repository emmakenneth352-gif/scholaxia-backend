"""
OTP Service
-----------
Generates, stores, and verifies OTPs for:
  - Email verification on signup
  - Password reset

OTPs and pending signup details are stored in the shared database with an
expiration time (default 10 minutes), so signup does not depend on Redis.
Email is sent through Gmail SMTP, SendGrid, Mailgun, or Brevo.
"""

import asyncio
import html
import json
import logging
import random
import smtplib
import string
import time
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Optional

import httpx
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.auth_transient import AuthTransientRecord
from sqlalchemy import delete

OTP_LENGTH = 6
OTP_TTL = settings.OTP_EXPIRE_MINUTES * 60  # seconds
PENDING_TTL = OTP_TTL

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"
logger = logging.getLogger(__name__)

# In-memory fallback when the shared database is down (debug mode only).
_MEMORY_STORE: dict[str, tuple[str, float]] = {}


class OtpStoreUnavailable(RuntimeError):
    """Raised when OTPs cannot be stored in shared production storage."""


def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=OTP_LENGTH))


def _redis_key(purpose: str, email: str) -> str:
    return f"otp:{purpose}:{email.lower()}"


def _pending_key(email: str) -> str:
    return f"signup_pending:{email.lower()}"


async def _store_set(key: str, value: str, ex: int) -> None:
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        async with AsyncSessionLocal() as db:
            record = await db.get(AuthTransientRecord, key)
            if record is None:
                record = AuthTransientRecord(key=key, value=value, expires_at=now + timedelta(seconds=ex))
                db.add(record)
            else:
                record.value = value
                record.expires_at = now + timedelta(seconds=ex)
            await db.execute(
                delete(AuthTransientRecord).where(AuthTransientRecord.expires_at <= now)
            )
            await db.commit()
        _MEMORY_STORE.pop(key, None)
    except Exception as exc:
        if not settings.DEBUG:
            raise OtpStoreUnavailable("Shared OTP database is unavailable") from exc
        _MEMORY_STORE[key] = (value, time.monotonic() + ex)
        logger.warning("Shared OTP database unavailable; using in-memory storage in DEBUG mode", exc_info=True)


async def _store_get(key: str) -> Optional[str]:
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        async with AsyncSessionLocal() as db:
            record = await db.get(AuthTransientRecord, key)
            if record is None:
                return _memory_store_get(key) if settings.DEBUG else None
            if record.expires_at <= now:
                await db.delete(record)
                await db.commit()
                return None
            return record.value
    except Exception as exc:
        if not settings.DEBUG:
            raise OtpStoreUnavailable("Shared OTP database is unavailable") from exc
        logger.warning("Shared OTP database unavailable; checking in-memory storage in DEBUG mode", exc_info=True)
        return _memory_store_get(key)


def _memory_store_get(key: str) -> Optional[str]:
    entry = _MEMORY_STORE.get(key)
    if not entry:
        return None
    value, expires_at = entry
    if time.monotonic() >= expires_at:
        _MEMORY_STORE.pop(key, None)
        return None
    return value


async def _store_delete(key: str) -> None:
    try:
        async with AsyncSessionLocal() as db:
            record = await db.get(AuthTransientRecord, key)
            if record is not None:
                await db.delete(record)
            await db.commit()
        _MEMORY_STORE.pop(key, None)
    except Exception as exc:
        if not settings.DEBUG:
            raise OtpStoreUnavailable("Shared OTP database is unavailable") from exc
        logger.warning("Shared OTP database unavailable while deleting; clearing debug memory entry", exc_info=True)
        _MEMORY_STORE.pop(key, None)


def _encode_codes(new_otp: str, previous_raw: Optional[str]) -> str:
    """Serialize the OTP bucket: newest code first, previous code kept as a
    grace fallback. Emails from the provider can arrive late (spam filters,
    slow relay), so re-requesting a code must not silently invalidate the one
    still sitting in the student's inbox — both stay answerable.
    """
    codes = [new_otp]
    if previous_raw:
        for code in _decode_codes(previous_raw):
            if code not in codes:
                codes.append(code)
    return json.dumps({"codes": codes[:2]})  # newest first, cap at two


def _decode_codes(raw: str) -> list[str]:
    """Accept the new JSON bucket AND the legacy plain-code format."""
    if not raw:
        return []
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return [str(c).strip() for c in parsed.get("codes", []) if str(c).strip()]
        except Exception:
            pass
        return []
    return [raw] if raw else []


async def send_otp(email: str, full_name: str, purpose: str) -> str:
    """
    Generate an OTP, store it, and send it through the configured email provider.
    purpose: "signup" | "verify_email" | "reset_password" | "login"
    Returns the OTP (only expose to clients when DEBUG=True).
    """
    otp = _generate_otp()
    key = _redis_key(purpose, email)
    previous: Optional[str] = None
    try:
        previous = await _store_get(key)
    except Exception:
        previous = None  # store hiccups must not block sending a fresh code
    await _store_set(key, _encode_codes(otp, previous), OTP_TTL)
    print(f"[OTP] generated for {email} purpose={purpose}")

    if settings.DEBUG:
        print(f"[OTP] email sending skipped in DEBUG mode for {email}")
    else:
        subject, html_body, text_body = _build_email(purpose, full_name, otp)
        await _send_email(
            to_email=email,
            to_name=full_name,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )
    return otp


async def send_transactional_email(
    to_email: str,
    to_name: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    """Public wrapper — any feature can send email via the configured provider."""
    await _send_email(to_email, to_name, subject, html_body, text_body)


async def _send_email(
    to_email: str,
    to_name: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    """Send transactional email via the configured provider.

    Resilience: if the primary provider fails (dead key, credits exhausted,
    network error), automatically try the remaining configured providers.
    Unconfigured providers (missing keys) are skipped silently.
    """
    primary = (settings.EMAIL_PROVIDER or "gmail").strip().lower()
    order = [primary] + [p for p in ("gmail", "sendgrid", "mailgun", "brevo") if p != primary]
    last_exc: Optional[Exception] = None
    for provider in order:
        try:
            if provider == "gmail":
                await _send_via_gmail(to_email, to_name, subject, html_body, text_body)
            elif provider == "brevo":
                await _send_via_brevo(to_email, to_name, subject, html_body)
            elif provider == "mailgun":
                await _send_via_mailgun(to_email, to_name, subject, html_body, text_body)
            else:
                await _send_via_sendgrid(to_email, to_name, subject, html_body, text_body)
            if provider != primary:
                print(f"[OTP] primary email provider {primary!r} failed — sent via fallback {provider!r}")
            return
        except RuntimeError:
            # Not configured (missing keys) — skip to the next provider.
            continue
        except Exception as e:
            print(f"[OTP] email provider {provider!r} failed: {e}")
            last_exc = e
            continue
    raise last_exc or RuntimeError("No email provider is configured")


def _smtp_send_gmail(
    to_email: str,
    to_name: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    sender = (settings.GMAIL_SMTP_EMAIL or "").strip()
    password = (settings.GMAIL_SMTP_APP_PASSWORD or "").strip().replace(" ", "")
    name = (settings.GMAIL_SMTP_NAME or "Scholaxia").strip()
    if not sender or not password:
        raise RuntimeError(
            "Gmail SMTP is not configured (GMAIL_SMTP_EMAIL / GMAIL_SMTP_APP_PASSWORD). "
            "Create a Google App Password and set those env vars."
        )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{name} <{sender}>"
    msg["To"] = f"{to_name} <{to_email}>" if to_name else to_email
    msg["Reply-To"] = sender
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(sender, password)
        server.sendmail(sender, [to_email], msg.as_string())


async def _send_via_gmail(
    to_email: str,
    to_name: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    """Send via Gmail SMTP so From/@gmail.com authenticates correctly (inbox, not spam)."""
    await asyncio.to_thread(
        _smtp_send_gmail, to_email, to_name, subject, html_body, text_body
    )


async def _send_via_sendgrid(
    to_email: str,
    to_name: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    """Send a transactional email via SendGrid API."""
    if not settings.SENDGRID_API_KEY or not settings.SENDGRID_SENDER_EMAIL:
        raise RuntimeError(
            "SendGrid is not configured (SENDGRID_API_KEY / SENDGRID_SENDER_EMAIL)"
        )

    sender = settings.SENDGRID_SENDER_EMAIL.strip().lower()
    if sender.endswith("@gmail.com") or sender.endswith("@googlemail.com"):
        print(
            "[OTP] WARNING: SendGrid From is a Gmail address — Gmail often marks "
            "these as spam. Prefer EMAIL_PROVIDER=gmail with an App Password, "
            "or authenticate a custom domain in SendGrid."
        )

    payload = {
        "personalizations": [
            {"to": [{"email": to_email, "name": to_name}], "subject": subject}
        ],
        "from": {
            "email": settings.SENDGRID_SENDER_EMAIL,
            "name": settings.SENDGRID_SENDER_NAME,
        },
        "reply_to": {
            "email": settings.SENDGRID_SENDER_EMAIL,
            "name": settings.SENDGRID_SENDER_NAME,
        },
        "content": [
            {"type": "text/plain", "value": text_body},
            {"type": "text/html", "value": html_body},
        ],
        "categories": ["transactional", "otp"],
        "mail_settings": {
            "bypass_list_management": {"enable": True},
        },
        "tracking_settings": {
            "click_tracking": {"enable": False},
            "open_tracking": {"enable": False},
        },
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            json=payload,
            headers={
                "Authorization": f"Bearer {settings.SENDGRID_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=15.0,
        )
        if response.status_code >= 400:
            print(f"[OTP] SendGrid error {response.status_code}: {response.text[:300]}")
        response.raise_for_status()


async def _send_via_mailgun(
    to_email: str,
    to_name: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    """Send a transactional email via Mailgun API."""
    domain = (settings.MAILGUN_DOMAIN or "").strip()
    if not settings.MAILGUN_API_KEY or not domain:
        raise RuntimeError("Mailgun is not configured (MAILGUN_API_KEY / MAILGUN_DOMAIN)")

    base = (settings.MAILGUN_BASE_URL or "https://api.mailgun.net").rstrip("/")
    url = f"{base}/v3/{domain}/messages"
    sender_email = (settings.MAILGUN_SENDER_EMAIL or f"postmaster@{domain}").strip()
    from_header = f"{settings.MAILGUN_SENDER_NAME} <{sender_email}>"

    data = {
        "from": from_header,
        "to": f"{to_name} <{to_email}>",
        "subject": subject,
        "text": text_body,
        "html": html_body,
        "o:tracking": "no",
        "o:tracking-clicks": "no",
        "o:tracking-opens": "no",
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            auth=("api", settings.MAILGUN_API_KEY),
            data=data,
            timeout=15.0,
        )
        if response.status_code >= 400:
            print(f"[OTP] Mailgun error {response.status_code}: {response.text[:300]}")
        response.raise_for_status()


async def verify_otp(email: str, otp: str, purpose: str) -> bool:
    """
    Verify the OTP for a given email and purpose.
    Returns True if valid, False otherwise.
    Deletes the OTP on successful verification (one-time use).
    """
    key = _redis_key(purpose, email)
    stored = await _store_get(key)

    codes = _decode_codes(stored or "")
    if not codes:
        return False  # expired or never sent

    if (otp or "").strip() not in codes:
        return False  # wrong code

    # Consume — delete so it can't be reused
    await _store_delete(key)
    return True


async def store_pending_signup(email: str, payload: dict[str, Any]) -> None:
    await _store_set(_pending_key(email), json.dumps(payload), PENDING_TTL)


async def load_pending_signup(email: str) -> Optional[dict[str, Any]]:
    raw = await _store_get(_pending_key(email))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def clear_pending_signup(email: str) -> None:
    await _store_delete(_pending_key(email))


def _build_email(purpose: str, full_name: str, otp: str) -> tuple[str, str, str]:
    safe_name = html.escape((full_name or "there").strip() or "there")
    mins = settings.OTP_EXPIRE_MINUTES

    if purpose in ("signup", "verify_email"):
        subject = "Your Scholaxia signup code"
        intro = "Use this code to finish creating your Scholaxia account."
    elif purpose == "reset_password":
        subject = "Your Scholaxia password reset code"
        intro = "Use this code to reset your Scholaxia password."
    elif purpose == "login":
        subject = "Your Scholaxia login code"
        intro = "Use this code to sign in to Scholaxia."
    else:
        subject = "Your Scholaxia code"
        intro = "Use this code for your Scholaxia request."

    text_body = (
        f"Hi {full_name or 'there'},\n\n"
        f"{intro}\n\n"
        f"Code: {otp}\n\n"
        f"This code expires in {mins} minutes.\n"
        f"If you did not request this, you can ignore this email.\n\n"
        f"— Scholaxia\n"
    )

    html_body = f"""<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px 24px;">
          <tr><td style="font-size:20px;font-weight:700;color:#5b21b6;padding-bottom:12px;">Scholaxia</td></tr>
          <tr><td style="font-size:16px;padding-bottom:8px;">Hi {safe_name},</td></tr>
          <tr><td style="font-size:15px;line-height:1.5;padding-bottom:18px;">{html.escape(intro)}</td></tr>
          <tr>
            <td align="center" style="padding:16px 0 20px;">
              <div style="display:inline-block;letter-spacing:8px;font-size:28px;font-weight:700;color:#111827;background:#f3f4f6;border-radius:10px;padding:14px 22px;">{otp}</div>
            </td>
          </tr>
          <tr><td style="font-size:13px;color:#6b7280;line-height:1.5;">This code expires in {mins} minutes. If you did not request this, ignore this email.</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    return subject, html_body, text_body


async def _send_via_brevo(to_email: str, to_name: str, subject: str, html_body: str) -> None:
    """Send a transactional email via Brevo API."""
    payload = {
        "sender": {
            "name": settings.BREVO_SENDER_NAME,
            "email": settings.BREVO_SENDER_EMAIL,
        },
        "to": [{"email": to_email, "name": to_name}],
        "subject": subject,
        "htmlContent": html_body,
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            BREVO_SEND_URL,
            json=payload,
            headers={
                "api-key": settings.BREVO_API_KEY,
                "Content-Type": "application/json",
            },
            timeout=10.0,
        )
        response.raise_for_status()
