@echo off
setlocal EnableExtensions

REM Change working directory to the location of this script
pushd "%~dp0"

echo [INFO] Working directory: %CD%

REM --- Check required tools ---
set MISSING=
where git.exe >nul 2>nul
if errorlevel 1 goto :missing_git
where npm.cmd >nul 2>nul
if errorlevel 1 goto :missing_npm
where firebase.cmd >nul 2>nul
if errorlevel 1 goto :missing_firebase
goto :after_tools_check

:missing_git
echo [ERROR] Required tool not found in PATH: git.exe
set MISSING=1
goto :after_tools_check

:missing_npm
echo [ERROR] Required tool not found in PATH: npm.cmd
set MISSING=1
goto :after_tools_check

:missing_firebase
echo [ERROR] Required tool not found in PATH: firebase.cmd
set MISSING=1
goto :after_tools_check

:after_tools_check
if defined MISSING goto :missing_tools
goto :after_tools

:missing_tools
echo [HINT] Install Git, Node.js npm, and Firebase CLI. Ensure they are available in PATH.
goto :fail

:after_tools

REM --- Verify Firebase config exists ---
if exist "firebase.json" goto :have_firebase
echo [ERROR] firebase.json not found in %CD%
echo        Please run this script from your project root containing firebase.json
goto :fail
:have_firebase

REM --- Capture release notes (one-line) from first arg or prompt ---
set "MSG=%~1"
if not defined MSG set /p MSG=Release notes - one line: 
if not defined MSG set "MSG=Release %DATE% %TIME%"

echo [STEP] Building production bundle...
call npm.cmd run build
if errorlevel 1 goto :fail

REM --- Git steps (skip if not a repo) ---
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 goto :nogitrepo
goto :gitrepo
:gitrepo
echo [STEP] Staging changes - git add -A
git add -A
if errorlevel 1 goto :fail

REM Commit only if there are staged changes
git diff --cached --quiet
if errorlevel 1 goto :do_commit
goto :no_commit

:do_commit
echo [STEP] Committing with message: "%MSG%"
git commit -m "%MSG%"
if errorlevel 1 goto :fail
echo [STEP] Pushing to current upstream...
git push
if errorlevel 1 goto :fail
goto :after_git

:no_commit
echo [INFO] No staged changes to commit. Skipping commit and push.

goto :after_git

:nogitrepo
echo [WARN] Not a Git repository. Skipping git add/commit/push.
goto :after_git

:after_git

echo [STEP] Deploying to Firebase Hosting - hosting only
call firebase.cmd deploy --only hosting
if errorlevel 1 goto :fail

echo.
echo [SUCCESS] Deploy complete. Visit your Hosting site shown above.
set EXITCODE=0
goto :end

:fail
set EXITCODE=1
echo.
echo [ERROR] One or more steps failed. See logs above.

:end
popd
endlocal & exit /b %EXITCODE%
