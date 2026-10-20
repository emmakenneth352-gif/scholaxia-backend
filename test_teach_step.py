"""
Voice Teaching Mode — live API test for /api/v1/sia/teach-step.
Checks: (1) greeting replies naturally to "hi" (no markdown notes),
(2) teaching returns voice+board steps that follow each other.
"""
import urllib.request, urllib.error, json, random, string

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
        return e.code, e.read().decode()[:500]
    except Exception as e:
        return 0, str(e)[:200]


e = "sia_" + "".join(random.choices(string.ascii_lowercase, k=5)) + "@test.com"
s, r = post("/api/v1/auth/student/signup", {
    "email": e, "password": "Test1234!", "full_name": "Emma Test"
})
token = r.get("access_token", "") if isinstance(r, dict) else ""
print(f"signup: {s} token={'YES' if token else 'NO'}")
if not token:
    print(r)
    raise SystemExit(1)

post("/api/v1/students/setup-exam", {
    "exam_type": "WAEC",
    "subjects": ["Physics", "Mathematics", "Chemistry"],
    "education_level": "SS1",
}, token=token)


def show(title, payload):
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)
    s, r = post("/api/v1/sia/teach-step", payload, token=token)
    print(f"HTTP {s}")
    if not isinstance(r, dict):
        print(r)
        return
    for i, st in enumerate(r.get("steps", []), 1):
        print(f"\n--- step {i} (teacher={st.get('teacher')}, wait={st.get('wait')}) ---")
        print(f"VOICE : {st.get('voice')}")
        for ln in st.get("board", []):
            print(f"BOARD : {ln}")
        if st.get("highlight"):
            print(f"HIGHLIGHT -> line {st.get('highlight')}")
    print(f"\ndone={r.get('done')} parse_error={r.get('parse_error')}")


show("GREETING TEST: student says 'hi'", {
    "question": "hi",
    "subject": "Physics",
    "education_level": "SS1",
    "language": "english",
})

show("TEACHING TEST: 'teach me Newton's first law'", {
    "question": "teach me Newton's first law of motion",
    "subject": "Physics",
    "education_level": "SS1",
    "language": "english",
})

print("\nTEST COMPLETE")
