"""Build the cPanel site zip for scholaxia.com deploy (same layout as
Scholaxia-Website-cPanel.zip: files at zip root, media/ included, downloads/ skipped).

Run:  .venv/Scripts/python.exe scripts/_zip_site_cpanel.py
"""

import os
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "website")
OUT = os.path.join(os.path.dirname(ROOT), "Scholaxia-Website-cPanel.zip")
SKIP_DIRS = {".git", "__pycache__", ".nitrogen", "downloads"}

count, raw = 0, 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            z.write(full, rel)
            count += 1
            raw += os.path.getsize(full)

print("files:", count)
print("raw MB: %.1f" % (raw / 1e6))
print("zip MB: %.1f" % (os.path.getsize(OUT) / 1e6))
print("OUT:", OUT)
