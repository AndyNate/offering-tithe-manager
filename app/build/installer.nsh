; Custom assistant wizard first page.
; - No previous install  -> simple welcome, Next proceeds to a normal install.
; - Previous install     -> version-aware Update / Repair / Uninstall page.

!ifndef BUILD_UNINSTALLER

  !include "LogicLib.nsh"
  !include "nsDialogs.nsh"

  Var /GLOBAL maDialog
  Var /GLOBAL maHeading
  Var /GLOBAL maUpdateRadio
  Var /GLOBAL maRepairRadio
  Var /GLOBAL maUninstallRadio
  Var /GLOBAL maInstalledVersion
  Var /GLOBAL maInstalledDir
  Var /GLOBAL maHasInstall
  Var /GLOBAL maCompare

  !macro customWelcomePage
    ; Compares two dotted numeric version strings ($0, $1).
    ; Result in $R0: 1 if $0 > $1, 0 if equal, -1 if $0 < $1.
    Function maCompareVersions
      StrCpy $R0 "0"
      StrCpy $R5 "0" ; cursor in $0
      StrCpy $R6 "0" ; cursor in $1
      StrCpy $R7 "0" ; $0 exhausted
      StrCpy $R8 "0" ; $1 exhausted
      ${Do}
        StrCpy $R1 ""
        ${Do}
          StrCpy $R2 $0 1 $R5
          IntOp $R5 $R5 + 1
          ${If} $R2 == "."
            ${Break}
          ${ElseIf} $R2 == ""
            StrCpy $R7 "1"
            ${Break}
          ${Else}
            StrCpy $R1 "$R1$R2"
          ${EndIf}
        ${Loop}
        StrCpy $R3 ""
        ${Do}
          StrCpy $R4 $1 1 $R6
          IntOp $R6 $R6 + 1
          ${If} $R4 == "."
            ${Break}
          ${ElseIf} $R4 == ""
            StrCpy $R8 "1"
            ${Break}
          ${Else}
            StrCpy $R3 "$R3$R4"
          ${EndIf}
        ${Loop}
        ${If} $R1 == ""
          StrCpy $R1 "0"
        ${EndIf}
        ${If} $R3 == ""
          StrCpy $R3 "0"
        ${EndIf}
        IntOp $R2 $R1 - $R3
        ${If} $R2 > 0
          StrCpy $R0 "1"
          ${Break}
        ${ElseIf} $R2 < 0
          StrCpy $R0 "-1"
          ${Break}
        ${EndIf}
        ${If} $R7 == "1"
        ${AndIf} $R8 == "1"
          ${Break}
        ${EndIf}
      ${Loop}
    FunctionEnd

    Function maPageCreate
      ; The elevated helper instance re-runs the wizard from the start, so the page
      ; was already shown in the outer instance. Skip it there.
      ${If} ${UAC_IsInnerInstance}
        Abort
      ${EndIf}

      StrCpy $maHasInstall "0"
      StrCpy $maInstalledVersion ""
      StrCpy $maInstalledDir ""

      ReadRegStr $maInstalledVersion HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
      ${If} $maInstalledVersion != ""
        StrCpy $maHasInstall "1"
        ReadRegStr $maInstalledDir HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
      ${Else}
        ReadRegStr $maInstalledVersion HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
        ${If} $maInstalledVersion != ""
          StrCpy $maHasInstall "1"
          ReadRegStr $maInstalledDir HKLM "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
        ${EndIf}
      ${EndIf}

      StrCpy $maCompare "0"
      ${If} $maHasInstall == "1"
        StrCpy $0 "${VERSION}"
        StrCpy $1 $maInstalledVersion
        Call maCompareVersions
        StrCpy $maCompare $R0
      ${EndIf}

      nsDialogs::Create 1018
      Pop $maDialog
      ${If} $maDialog == error
        Abort
      ${EndIf}

      ${If} $maHasInstall != "1"
        !insertmacro MUI_HEADER_TEXT "Welcome" "Setup ${DoubleAmpersand}"
        ${NSD_CreateLabel} 0u 0u 100% 40u "Welcome to the ${DoubleAmpersand} Setup Wizard.$\r$\nVersion ${VERSION} will be installed on your computer.$\r$\nClick Next to continue."
        Pop $maHeading
      ${Else}
        !insertmacro MUI_HEADER_TEXT "Program Maintenance" "Choose what to do with the installed copy"
        ${If} $maCompare == "1"
          ${NSD_CreateLabel} 0u 0u 100% 40u "${DoubleAmpersand} is already installed.$\r$\nInstalled version: $maInstalledVersion$\r$\nA newer version (${VERSION}) is available."
          Pop $maHeading
        ${Else}
          ${If} $maCompare == "-1"
            ${NSD_CreateLabel} 0u 0u 100% 40u "${DoubleAmpersand} is already installed.$\r$\nInstalled version: $maInstalledVersion$\r$\nThis installer (${VERSION}) is older than the installed version."
            Pop $maHeading
          ${Else}
            ${NSD_CreateLabel} 0u 0u 100% 40u "${DoubleAmpersand} version $maInstalledVersion is already installed.$\r$\nYou can repair the installation or uninstall it.$\r$\nYour data is kept for any option you choose."
            Pop $maHeading
          ${EndIf}
        ${EndIf}

        ${If} $maCompare == "1"
          ${NSD_CreateRadioButton} 10u 48u 100% 12u "Update to version ${VERSION} (keeps your data)"
          Pop $maUpdateRadio
          ${NSD_CreateRadioButton} 10u 66u 100% 12u "Repair the installation (keeps your data)"
          Pop $maRepairRadio
        ${Else}
          ${NSD_CreateRadioButton} 10u 48u 100% 12u "Repair the installation (keeps your data)"
          Pop $maRepairRadio
        ${EndIf}
        ${NSD_CreateRadioButton} 10u 84u 100% 12u "Uninstall ${DoubleAmpersand}"
        Pop $maUninstallRadio

        ${If} $maUpdateRadio != 0
          SendMessage $maUpdateRadio ${BM_SETCHECK} ${BST_CHECKED} 0
        ${Else}
          SendMessage $maRepairRadio ${BM_SETCHECK} ${BST_CHECKED} 0
        ${EndIf}
      ${EndIf}

      nsDialogs::Show
    FunctionEnd

    Function maPageLeave
      ${If} $maHasInstall != "1"
        Return
      ${EndIf}

      ${If} $maUpdateRadio != 0
        SendMessage $maUpdateRadio ${BM_GETCHECK} 0 0 $1
        ${If} $1 == ${BST_CHECKED}
          Return
        ${EndIf}
      ${EndIf}

      ${If} $maRepairRadio != 0
        SendMessage $maRepairRadio ${BM_GETCHECK} 0 0 $1
        ${If} $1 == ${BST_CHECKED}
          Return
        ${EndIf}
      ${EndIf}

      ; Uninstall selected
      ${If} $maInstalledDir == ""
        MessageBox MB_ICONINFORMATION|MB_OK "The installation folder could not be determined. The wizard will continue with a regular installation instead."
        Return
      ${EndIf}
      IfFileExists "$maInstalledDir\${UNINSTALL_FILENAME}" 0 maUninstallerMissing
      ExecWait '"$maInstalledDir\${UNINSTALL_FILENAME}"'
      Quit

      maUninstallerMissing:
      MessageBox MB_ICONSTOP|MB_OK "The uninstaller was not found at:$\r$\n$maInstalledDir\${UNINSTALL_FILENAME}"
      Abort
    FunctionEnd

    Page custom maPageCreate maPageLeave
  !macroend

!endif