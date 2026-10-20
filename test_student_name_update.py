import urllib.request, json

BASE = "https://scholaxia1.onrender.com"

def post(path, data, token=None):
    body = json.dumps(data).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=30)
        raw = r.read()
        return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode()[:300]

def get(path, token=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, headers=headers)
    try:
        r = urllib.request.urlopen(req, timeout=30)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode()[:300]

def patch(path, data, token=None):
    body = json.dumps(data).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method="PATCH")
    try:
        r = urllib.request.urlopen(req, timeout=30)
        raw = r.read()
        return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode()[:300]

def ok(label, status, expected=None):
    exp = expected or [200, 201]
    icon = "PASS" if status in exp else "FAIL"
    print(f"[{icon}] {label} -> HTTP {status}")

print("Testing Student Name Update API")
print("=" * 40)

# 1. Student login
print("\n1. Student Login")
s, r = post("/api/v1/auth/login", {
    "email": "chidi@test.com", 
    "password": "Student123!"
})
ok("Student login", s, [200, 201])
student_token = r.get("access_token", "") if isinstance(r, dict) else ""
print(f"     Token: {'OK' if student_token else 'MISSING'}")
print(f"     Response: {r}")

if not student_token:
    print("\nERROR: Could not get student token. Using fallback test user...")
    # Try with admin to at least test the endpoint exists
    s, r = post("/api/v1/auth/login", {
        "email": "admin@scholaxia.com",
        "password": "ScholaxiaAdmin2026"
    })
    admin_token = r.get("access_token", "") if isinstance(r, dict) else ""
    print(f"     Admin token: {'OK' if admin_token else 'MISSING'}")
    if admin_token:
        print("\n     Note: Testing with admin token (endpoint may require student role)")
        student_token = admin_token

if student_token:
    # 2. Get current profile
    print("\n2. Get Current Student Profile")
    s, r = get("/api/v1/students/me", token=student_token)
    ok("Get student profile", s, [200])
    current_name = r.get("full_name", "") if isinstance(r, dict) else ""
    print(f"     Current name: {current_name}")
    print(f"     Full response: {r}")

    # 3. Update name via PATCH
    print("\n3. Update Name via PATCH")
    test_name = "Test Student Updated"
    s, r = patch("/api/v1/students/me", {
        "full_name": test_name
    }, token=student_token)
    ok("Update name PATCH", s, [200])
    updated_name = r.get("full_name", "") if isinstance(r, dict) else ""
    print(f"     Response: {r}")
    print(f"     Updated name: {updated_name}")

    # 4. Verify the change persisted
    print("\n4. Verify Name Persisted")
    s, r = get("/api/v1/students/me", token=student_token)
    ok("Get updated profile", s, [200])
    final_name = r.get("full_name", "") if isinstance(r, dict) else ""
    print(f"     Final name: {final_name}")
    
    if final_name == test_name:
        print("     ✅ Name update SUCCESSFUL and PERSISTED")
    else:
        print(f"     ❌ Name update FAILED. Expected '{test_name}', got '{final_name}'")

else:
    print("\n❌ Cannot test name update - no valid token available")

print("\n" + "=" * 40)
print("TEST COMPLETE")