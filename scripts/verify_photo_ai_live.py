"""Verify /sia/analyze-image works on the live backend after deploy."""
import urllib.request, urllib.error, json, random, string, sys, base64

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "https://scholaxia1.onrender.com"

# 64x64 red JPEG (generated with PIL, embedded as base64)
JPEG = base64.b64decode(
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgK"
    "DBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAA"
    "BABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAw"
    "IEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJ"
    "icoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWW"
    "l5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb"
    "3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==".split("base64,")[1]
)


def post_json(path, data, token=None):
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


def post_multipart(path, fields, file_field, filename, file_bytes, ctype, token):
    boundary = "----verify" + "".join(random.choices(string.ascii_lowercase, k=10))
    lines = []
    for k, v in fields.items():
        lines.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    lines.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {ctype}\r\n\r\n".encode() + file_bytes + f"\r\n--{boundary}--\r\n".encode()
    )
    body = b"".join(lines)
    req = urllib.request.Request(
        BASE + path, data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                 "Authorization": f"Bearer {token}"},
    )
    try:
        r = urllib.request.urlopen(req, timeout=180)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)[:300]


def signup():
    e = "sia_" + "".join(random.choices(string.ascii_lowercase, k=6)) + "@test.com"
    s, r = post_json("/api/v1/auth/student/signup", {
        "email": e, "password": "Test1234!", "full_name": "Photo Verify",
    })
    try:
        r = json.loads(r)
    except Exception:
        pass
    token = r.get("access_token", "") if isinstance(r, dict) else ""
    print("signup:", s, "token:", bool(token))
    if token:
        post_json("/api/v1/students/setup-exam", {
            "exam_type": "WAEC", "subjects": ["Physics"], "education_level": "SS1",
        }, token=token)
    return token


def main():
    token = signup()
    if not token:
        sys.exit(1)
    print("\n=== /sia/analyze-image with real JPEG ===")
    s, r = post_multipart("/api/v1/sia/analyze-image",
                          {"question": "What color is this image? One sentence."},
                          "image", "photo.jpg", JPEG, "image/jpeg", token)
    print("HTTP", s)
    print(str(r)[:400])
    ok = s == 200 and "sia" in r
    print("\nRESULT:", "PASS - photo AI works" if ok else "FAIL - deploy not live yet or still broken")


main()
