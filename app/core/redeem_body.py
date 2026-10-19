"""Tolerant body parsing for coupon-redememption endpoints.

Live traffic shows older/quirky clients hitting /study-coupons/redeem and
/cbt/coupons/redeem with bodies that a strict ``{"code": "..."}`` Pydantic
model rejects with a 422, e.g.:

  - double-encoded JSON:  "\"{\\\"code\\\":\\\"SX-ABCD1234\\\"}\""
  - a bare token:         "SX-ABCD1234"          (no JSON at all)
  - form-encoded:         "code=SX-ABCD1234"

Accepting these server-side fixes every client at once (old web page loads,
the mobile app builds, guest users) instead of waiting for a redeploy of
each frontend.
"""
import json
import logging
from urllib.parse import parse_qs

from fastapi import Request

logger = logging.getLogger(__name__)


async def extract_redeem_code(request: Request) -> str | None:
    """Best-effort extraction of the coupon code from any sensible body shape."""
    raw = await request.body()
    if not raw:
        return None
    text = raw.decode("utf-8", errors="ignore").strip()
    if not text:
        return None

    content_type = (request.headers.get("content-type") or "").lower()
    if "x-www-form-urlencoded" in content_type:
        try:
            values = parse_qs(text, keep_blank_values=True)
            for key in ("code", "Code", "coupon", "coupon_code"):
                if values.get(key):
                    return values[key][0]
        except Exception:
            logger.debug("redeem body: unparseable form data", exc_info=True)
        return None

    # JSON-shaped bodies (the normal case, plus the double-encoded regression).
    try:
        parsed = json.loads(text)
    except Exception:
        # Not JSON — treat the whole body as a bare token.
        if len(text) <= 80 and not text.startswith("{"):
            return text
        return None

    if isinstance(parsed, dict):
        for key in ("code", "Code", "coupon", "coupon_code"):
            value = parsed.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return None

    if isinstance(parsed, str):
        # The body itself was a JSON string. If that string is *also* JSON
        # (double-encoded), unwrap one more layer; otherwise use it as-is.
        candidate = parsed.strip()
        if candidate.startswith("{"):
            try:
                inner = json.loads(candidate)
                if isinstance(inner, dict):
                    for key in ("code", "Code", "coupon", "coupon_code"):
                        value = inner.get(key)
                        if isinstance(value, str) and value.strip():
                            return value
            except Exception:
                pass
        return candidate or None

    logger.info("redeem body: unrecognised JSON type %s", type(parsed).__name__)
    return None
