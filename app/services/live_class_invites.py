"""Live class email invitations.

When a teacher creates a private class with invited emails (kids are invited
by email — they never enter access codes), every address gets a real email
with the class details and the join code. Addresses that already have a
Scholaxia account are also resolved to user ids so the class shows directly
in the child's Live Class list.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.live_class import LiveClass
from app.models.user import User
from app.services.otp_service import send_transactional_email

logger = logging.getLogger(__name__)

_SITE_URL = "https://scholaxia.com"


def _escape(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _fmt_when(start, end) -> str:
    try:
        s = start.strftime("%a %d %b %Y, %I:%M %p")
        e = end.strftime("%I:%M %p") if end else ""
        return f"{s} – {e}" if e else s
    except Exception:
        return ""


def _build_email(
    *,
    class_title: str,
    subject: str,
    teacher_name: str,
    when: str,
    join_code: str,
    child_name: str | None,
) -> tuple[str, str, str]:
    """Returns (subject, html, text)."""
    mail_subject = f"Scholaxia live class invitation — {class_title}"
    who = f"for {child_name}" if child_name else "for your child"
    text = (
        f"Hello,\n\n"
        f"{teacher_name} invited you {who} to a live class on Scholaxia.\n\n"
        f"Class: {class_title} ({subject})\n"
        f"When: {when}\n"
        f"Join code: {join_code}\n\n"
        f"Open the Scholaxia app or website, go to Live Class, and the class "
        f"appears in your list — no code needed when invited by email.\n\n"
        f"— Scholaxia"
    )
    html = f"""\
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:24px 28px;">
        <h1 style="color:#ffffff;font-size:20px;margin:0;">Live class invitation</h1>
        <p style="color:#e9d5ff;font-size:13px;margin:6px 0 0;">{_escape(teacher_name)} invited you {who}</p>
      </div>
      <div style="padding:28px;">
        <p style="font-size:15px;color:#111827;margin:0 0 16px;">
          <strong>{_escape(class_title)}</strong> &middot; {_escape(subject)}
        </p>
        <table style="width:100%;font-size:14px;color:#374151;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;">When</td><td style="padding:6px 0;font-weight:600;">{_escape(when)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Join code</td><td style="padding:6px 0;font-weight:700;font-size:16px;color:#4f46e5;">{_escape(join_code)}</td></tr>
        </table>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:18px 0 0;">
          Open the Scholaxia app or website, go to <strong>Live Class</strong> —
          the class appears in your list already. If a code is ever asked for, use
          <strong>{_escape(join_code)}</strong>.
        </p>
      </div>
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin:18px 0 0;">
      &copy; Scholaxia — learn without limits
    </p>
  </div>
</body></html>"""
    return mail_subject, html, text


async def send_live_class_invites(
    db: AsyncSession,
    live_class: LiveClass,
    teacher_name: str,
    extra_emails: list[str] | None = None,
) -> int:
    """Email every invited address that has no user id yet + parents of resolved kids.

    `extra_emails` is the raw `invited_student_emails` list from the create
    payload (the model only stores resolved user ids).

    Returns how many emails were attempted.
    """
    from app.routers.live_class import _parse_id_list

    invited_ids = _parse_id_list(live_class.invited_student_ids)
    sent = 0

    when = _fmt_when(live_class.start_time, live_class.end_time)

    # Kids already on Scholaxia: email their account address too (parent inbox).
    id_emails: dict[str, str | None] = {}
    if invited_ids:
        try:
            import uuid as _uuid

            ids = []
            for raw in invited_ids:
                try:
                    ids.append(_uuid.UUID(raw))
                except Exception:
                    continue
            res = await db.execute(select(User).where(User.id.in_(ids)))
            for u in res.scalars().all():
                id_emails[str(u.id)] = u.email
        except Exception:
            pass

    def _send_one(to_email: str, child_name: str | None) -> None:
        nonlocal sent
        subject, html, text = _build_email(
            class_title=live_class.title or live_class.subject,
            subject=live_class.subject,
            teacher_name=teacher_name,
            when=when,
            join_code=live_class.join_code or "",
            child_name=child_name,
        )

        async def _deliver() -> None:
            try:
                await send_transactional_email(
                    to_email=to_email,
                    to_name=child_name or "Parent",
                    subject=subject,
                    html_body=html,
                    text_body=text,
                )
            except Exception as e:
                logger.warning("Live class invite email failed for %s: %s", to_email, e)

        try:
            import asyncio

            asyncio.get_running_loop().create_task(_deliver())
            sent += 1
        except Exception as e:
            logger.warning("Live class invite schedule failed for %s: %s", to_email, e)

    # 1) Emails of kids who already have accounts (their inbox / parent's).
    for _uid, email in id_emails.items():
        if email:
            _send_one(email, None)

    # 2) Raw invited emails (from creation payload) not already covered.
    raw_emails = extra_emails or []
    for email in raw_emails:
        email = (email or "").strip().lower()
        if email and email not in {e for e in id_emails.values() if e}:
            _send_one(email, None)

    logger.info("Live class invites queued: %s for class %s", sent, live_class.id)
    return sent
