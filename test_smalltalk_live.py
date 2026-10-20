"""Live check: small-talk replies must be natural, plain, human."""
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
        r = urllib.request.urlopen(req, timeout=120)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]
    except Exception as e:
        return 0, str(e)[:200]


e = "sia_" + "".join(random.choices(string.ascii_lowercase, k=5)) + "@test.com"
s, r = post("/api/v1/auth/student/signup", {
    "email": e, "password": "Test1234!", "full_name": "Emma Test"
})
token = r.get("access_token", "") if isinstance(r, dict) else ""
print(f"signup: {s}")
if not token:
    print(r)
    sys.exit(1)

for q in ["how are u doing", "hi", "i am tired"]:
    s, r = post("/api/v1/sia/ask", {"question": q, "subject": "Physics", "language": "english"}, token=token)
    reply = r.get("sia", "") if isinstance(r, dict) else str(r)
    has_md = ("**" in reply) or ("##" in reply)
    print("\n" + "-" * 55)
    print(f"Q: {q}   [HTTP {s} | markdown={has_md}]")
    print(f"A: {reply[:300]}")
