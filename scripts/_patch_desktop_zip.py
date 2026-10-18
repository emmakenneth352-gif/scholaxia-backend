import os, shutil, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = os.path.join(ROOT, "website", "downloads", "Scholaxia-Desktop-1.0.2-win64.zip")
SRC = os.path.join(ROOT, "scholaxia-desktop", "renderer")
TMP = ZIP + ".tmp"

# zip path -> source path
PATCH = {
    "ScholaxiaDesktop/resources/app/renderer/admin.html": "admin.html",
    "ScholaxiaDesktop/resources/app/renderer/index.html": "index.html",
    "ScholaxiaDesktop/resources/app/renderer/js/admin.js": os.path.join("js", "admin.js"),
    "ScholaxiaDesktop/resources/app/renderer/js/auth.js": os.path.join("js", "auth.js"),
    # student-facing updates: study gating (videos/library) + Coding Tutorials tab
    "ScholaxiaDesktop/resources/app/renderer/app.html": "app.html",
    "ScholaxiaDesktop/resources/app/renderer/js/app.js": os.path.join("js", "app.js"),
    "ScholaxiaDesktop/resources/app/renderer/js/library.js": os.path.join("js", "library.js"),
    "ScholaxiaDesktop/resources/app/renderer/css/scholaxia-purple.css": os.path.join("css", "scholaxia-purple.css"),
}

with zipfile.ZipFile(ZIP, "r") as zin, zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zout:
    for item in zin.infolist():
        if item.filename in PATCH:
            continue  # drop old copy, re-added below
        zout.writestr(item, zin.read(item.filename))
    for zpath, rel in PATCH.items():
        with open(os.path.join(SRC, rel), "rb") as f:
            zout.writestr(zpath, f.read())

shutil.move(TMP, ZIP)
print("patched:", ", ".join(PATCH))
print("zip MB: %.1f" % (os.path.getsize(ZIP) / 1e6))
