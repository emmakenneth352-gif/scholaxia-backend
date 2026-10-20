@echo off
title Build Scholaxia Android AAB
cd /d "%~dp0"

echo.
echo Building Scholaxia release AAB...
echo.

set "FLUTTER_ROOT=C:\Users\EMMA\flutter_sdk"
set "PATH=%FLUTTER_ROOT%\bin;%PATH%"
set "GRADLE_USER_HOME=D:\tmp\gradle-home"
set "ANDROID_HOME=D:\Android"
set "ANDROID_SDK_ROOT=D:\Android"
set "TEMP=D:\tmp"
set "TMP=D:\tmp"
set "PUB_CACHE=%LOCALAPPDATA%\Pub\Cache"

if not exist "%FLUTTER_ROOT%\bin\flutter.bat" (
  echo Flutter not found at %FLUTTER_ROOT%
  echo BUILD_EXIT=1
  exit /b 1
)

if not exist "D:\tmp" mkdir "D:\tmp"
if not exist "%GRADLE_USER_HOME%" mkdir "%GRADLE_USER_HOME%"

echo Flutter : %FLUTTER_ROOT%
echo Gradle  : %GRADLE_USER_HOME%
echo SDK     : %ANDROID_HOME%
echo.

call flutter pub get
if errorlevel 1 goto :fail

call flutter build appbundle --release
if errorlevel 1 goto :fail

echo.
echo Done! AAB:
echo   build\app\outputs\bundle\release\app-release.aab
echo BUILD_EXIT=0
pause
exit /b 0

:fail
echo AAB build failed.
echo BUILD_EXIT=1
pause
exit /b 1
