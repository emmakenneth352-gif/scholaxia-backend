"""See the RAW voice/board text /sia/teach-step returns (checking for $ signs)."""
import urllib.request, urllib.error, json, random, string, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "https://scholaxia1.onrender.com"


def post(path, data, token=None):
    body = json.dumps(data).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=180)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)[:300]


e = "sia_" + "".join(random.choices(string.ascii_lowercase, k=6)) + "@test.com"
s, r = post("/api/v1/auth/student/signup", {
    "email": e, "password": "Test1234!", "full_name": "Dollar Probe",
})
try:
    r = json.loads(r)
except Exception:
    pass
token = r.get("access_token", "") if isinstance(r, dict) else ""
print("signup:", s, "token:", bool(token))
if not token:
    sys.exit(1)

s, r = post("/api/v1/sia/teach-step", {
    "question": "teach me limits in mathematics",
    "subject": "Mathematics",
    "education_level": "SS1",
    "language": "english",
}, token=token)
print("HTTP", s)
try:
    data = json.loads(r)
    for i, st in enumerate(data.get("steps", []), 1):
        print(f"\n--- step {i} ---")
        print("VOICE:", st.get("voice"))
        for b in st.get("board", []):
            print("BOARD:", b)
except Exception:
    print(str(r)[:800])
