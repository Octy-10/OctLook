; Shell integration, installed machine-wide (the installer runs elevated):
;  * octlook.exe --register-shell: Default apps entry, "Open with", context verb
;  * octlook_shell.dll (regsvr32):   Explorer thumbnail handler
; Explorer's thumbnail host keeps the DLL loaded: a loaded DLL can be
; renamed but not overwritten, so the old copy is moved aside and deleted on
; the next reboot.

!macro OCTLOOK_REGSVR32 ARGS
  Push $0
  ; A 32-bit installer must reach the 64-bit regsvr32 through Sysnative.
  StrCpy $0 "$WINDIR\Sysnative\regsvr32.exe"
  IfFileExists $0 +2 0
    StrCpy $0 "$SYSDIR\regsvr32.exe"
  ExecWait '"$0" /s ${ARGS} "$INSTDIR\octlook_shell.dll"'
  Pop $0
!macroend

!macro OCTLOOK_MOVE_ASIDE
  IfFileExists "$INSTDIR\octlook_shell.dll" 0 +4
    Delete "$INSTDIR\octlook_shell.dll.old"
    Rename "$INSTDIR\octlook_shell.dll" "$INSTDIR\octlook_shell.dll.old"
    Delete /REBOOTOK "$INSTDIR\octlook_shell.dll.old"
!macroend

; Explorer keeps serving cached thumbnails after a handler comes or goes.
; It holds thumbcache_*.db open, so they are deleted at the next restart;
; the deferred delete must not raise a "restart now" prompt, hence the
; reboot flag is restored to what it was.
!macro OCTLOOK_PURGE_THUMBNAILS
  Push $0
  Push $1
  StrCpy $1 0
  IfRebootFlag 0 +2
    StrCpy $1 1
  ; The elevated installer runs as the same user: %LOCALAPPDATA% is theirs.
  ExpandEnvStrings $0 "%LOCALAPPDATA%\Microsoft\Windows\Explorer"
  Delete /REBOOTOK "$0\thumbcache_*.db"
  StrCmp $1 1 +2
    SetRebootFlag false
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OCTLOOK_MOVE_ASIDE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-shell'
  !insertmacro OCTLOOK_REGSVR32 ""
  !insertmacro OCTLOOK_PURGE_THUMBNAILS
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The app's own "start with Windows" entry (Space preview), written per user.
  ; Updates run this uninstaller too (/UPDATE): they must keep it.
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OctLook"
  ${EndIf}
  !insertmacro OCTLOOK_REGSVR32 "/u"
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-shell'
  !insertmacro OCTLOOK_MOVE_ASIDE
  !insertmacro OCTLOOK_PURGE_THUMBNAILS
!macroend
