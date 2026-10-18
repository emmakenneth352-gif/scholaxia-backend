"""Verify live /sia/ask works after the DBAPIError fix + returns tokens_left."""
import base64
import json
import random
import string
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "https://scholaxia1.onrender.com"


def call(path, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    try:
        r = urllib.request.urlopen(req, timeout=120)
        return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main() -> int:
    rnd = "".join(random.choices(string.ascii_lowercase, k=8))
    email = f"probe_{rnd}@example.com"
    status, body = call(
        "/api/v1/auth/student/signup",
        {
            "email": email,
            "password": "Probe#12345",
            "full_name": "Probe Tester",
        },
    )
    print("signup:", status)
    data = {}
    try:
        data = json.loads(body)
    except Exception:
        print(body[:300])
        return 1
    token = data.get("access_token") or ""
    if not token:
        print("no token:", body[:300])
        return 1

    status, body = call(
        "/api/v1/sia/ask",
        {"question": "teach me limit in maths in one short sentence", "subject": "Mathematics"},
        token,
    )
    print("ask:", status)
    try:
        out = json.loads(body)
        text = str(out.get("sia") or out.get("detail") or body)[:220]
        print("answer:", text.replace("\n", " "))
        print("tokens_left:", out.get("tokens_left"))
    except Exception:
        print(body[:300])
        return 1
    ok = status == 200 and "DBAPIError" not in body and out.get("tokens_left") is not None
    print("ASK_LIVE_OK" if ok else "ASK_LIVE_FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
