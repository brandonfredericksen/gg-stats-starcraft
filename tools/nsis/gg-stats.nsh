; Installer additions for GG Stats, included from gg-stats.yml.

!include "${PROJECT_DIR}\tools\nsis\check-app-running.nsh"
!include "${PROJECT_DIR}\tools\nsis\vc-redist.nsh"

; A one-click installer otherwise names its folder after the package (gg-stats-app). Installs that
; already have a folder, or pass /D=, keep theirs.
!macro preInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\GG Stats"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro ensureVcRedist
  ; Builds before the app id became app.ggstats registered .rep files under the old one.
  DeleteRegKey HKCU "Software\Classes\io.github.brandonfredericksen.ggstats"
  DeleteRegValue HKCU "Software\Classes\.rep\OpenWithProgids" "io.github.brandonfredericksen.ggstats"
!macroend

; The app registers itself as a program that can open .rep files (see app/file-association.ts).
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\${APP_ID}"
  DeleteRegValue HKCU "Software\Classes\.rep\OpenWithProgids" "${APP_ID}"
!macroend
