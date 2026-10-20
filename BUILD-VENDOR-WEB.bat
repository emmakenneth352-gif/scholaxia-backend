@echo off
cd /d "%~dp0"
echo Building Scholaxia Vendor Web App...
flutter build web --release -t lib/vendor_main.dart --base-href / --output build\vendor-web
echo.
echo Vendor web build: build\vendor-web