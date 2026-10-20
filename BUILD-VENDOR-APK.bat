@echo off
cd /d "%~dp0"
echo Building Scholaxia Vendor App...
flutter build apk --release --flavor vendor -t lib/vendor_main.dart
echo.
echo Vendor APK: build\app\outputs\flutter-apk\app-vendor-release.apk