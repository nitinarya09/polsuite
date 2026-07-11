@echo off
title IFMS POL & VLC Data Linker
echo Starting VLC Linker...
if exist "%~dp0IFMS_POL_VLC_Linker.exe" (
    "%~dp0IFMS_POL_VLC_Linker.exe"
) else (
    py "%~dp0link_vlc_polars.py"
)
pause
