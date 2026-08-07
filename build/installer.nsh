; Removes the camera registration on uninstall.
;
; Without this a dead "Meme Cam" device would stay in the camera list, pointing
; at a DLL that no longer exists.
;
; The app registers a copy kept in the user data folder, not the one inside the
; install directory, and the file name carries the app version - so we have to
; walk the folder instead of unregistering one fixed name. The folder name comes
; from app.getName(), which is the package.json "name" field ("meme-cam").
;
; ASCII only on purpose: NSIS reads .nsh as ANSI, non-ASCII bytes can break it.

; During an update the installer runs the previous uninstaller first. Removing
; the camera there would silently break it on every update, so only do this on a
; real uninstall.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    StrCpy $R0 "$APPDATA\meme-cam\driver"
    FindFirst $R1 $R2 "$R0\memecam-filter*.dll"
    unreg_loop:
      StrCmp $R2 "" unreg_done
      ExecWait '"$SYSDIR\regsvr32.exe" /s /u "$R0\$R2"'
      FindNext $R1 $R2
      Goto unreg_loop
    unreg_done:
    FindClose $R1
    RMDir /r "$R0"
  ${endIf}
!macroend
