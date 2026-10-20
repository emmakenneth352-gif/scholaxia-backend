Scholaxia — Local Site (the one that runs exactly like the local test server)
=============================================================================

WHAT THIS IS
------------
This is the full working local site: the FastAPI backend (app/), the
website pages (website/, static/app/, static/admin/) and the local test
server that seeds sample CBT papers, so the CBT exam feature works
exactly as it does when tested locally.

The earlier cPanel zip contained ONLY the static HTML/CSS/JS. On static
hosting there is no backend, so pages had nothing to load data from.
That is why it did not look like your local site.

HOW TO RUN (Windows)
--------------------
1. Double-click  START-LOCAL-SITE.bat
   - First run: it creates a virtual environment and installs
     dependencies (needs internet, a few minutes; requires Python 3.11+
     from python.org with "Add to PATH" ticked).
   - It then opens the site in your browser automatically.
2. Everyday use: just double-click the same .bat again; it skips
   straight to starting.

ADDRESSES
---------
  Main site:   http://127.0.0.1:8000/
  Create acct: http://127.0.0.1:8000/app/auth.html
  School demo: http://127.0.0.1:8000/school/divine-light/
  Admin UI:    http://127.0.0.1:8000/admin/

DEMO LOGINS
-----------
  Demo school admin: admin@divine-light.example.com / Admin1234!
  Platform admin:    admin@scholaxiatest.com / AdminPass123!  (for /admin/)

SIGNUP / OTP
------------
  The local server runs in DEBUG mode, so the signup screen shows the
  OTP code automatically - no email needed.

NOTES
-----
  - The database is a fresh SQLite file created every launch
    (local_dev.db), so registered users and CBT attempts reset when you
    restart. Just re-register and test again.
  - The app installers (website/downloads, static/app/downloads, ~170MB
    of .exe installers) were left OUT of this zip so it stays small.
    Copy those folders in if you need the "Download App" links to work.
  - Do NOT host this on plain static hosting (cPanel/File Manager or
    Netlify) expecting it to work - it needs a Python server. It is for
    running on a Windows PC, exactly like the local testing setup.
