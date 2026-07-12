@echo off
title YT Playlist Downloader
color 0A

echo.
echo  ==========================================
echo    YT Playlist Downloader - Wird gestartet
echo  ==========================================
echo.

:: Prüfe ob Python installiert ist
python --version >nul 2>&1
if errorlevel 1 (
    echo  [FEHLER] Python ist nicht installiert!
    echo.
    echo  Bitte installiere Python von: https://python.org/downloads
    echo  Wichtig: Haken bei "Add Python to PATH" setzen!
    echo.
    pause
    start https://python.org/downloads
    exit /b 1
)

echo  [OK] Python gefunden
echo.

:: Pakete installieren falls nötig
echo  Überprüfe Abhängigkeiten...
pip show flask >nul 2>&1
if errorlevel 1 (
    echo  Installiere Flask...
    pip install flask flask-cors yt-dlp --quiet
)
pip show yt-dlp >nul 2>&1
if errorlevel 1 (
    echo  Installiere yt-dlp...
    pip install yt-dlp --quiet
)

echo  [OK] Alle Pakete bereit
echo.

:: Starte Server im Hintergrund und öffne Browser
echo  Starte Server...
start /B python "%~dp0server.py"

:: Kurz warten bis Server hochgefahren ist
timeout /t 2 /nobreak >nul

:: Browser öffnen
echo  Öffne Browser...
start http://localhost:5757

echo.
echo  ==========================================
echo    App läuft! Browser sollte sich öffnen.
echo    Dieses Fenster NICHT schließen!
echo    Zum Beenden: Fenster schließen
echo  ==========================================
echo.

:: Warte bis Benutzer schließt
python "%~dp0server.py"
