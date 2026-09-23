; Assistant d'installation DevForge (Inno Setup 6).
; Compilation : ISCC.exe /DAppVersion=2.0.0 /DStage=...\windows-stage /DOutputDir=...\dist devforge.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Stage
  #define Stage "staging"
#endif
#ifndef OutputDir
  #define OutputDir "output"
#endif

[Setup]
AppId={{7C4E9A2B-1D6F-4E83-9A15-6B0C8F2D4E71}
AppName=DevForge
AppVersion={#AppVersion}
AppVerName=DevForge {#AppVersion}
AppPublisher=DevForge
DefaultDirName={localappdata}\Programs\DevForge
DefaultGroupName=DevForge
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=DevForge-Setup-{#AppVersion}-x64
SetupIconFile={#Stage}\devforge.ico
UninstallDisplayIcon={app}\devforge.ico
UninstallDisplayName=DevForge
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0
VersionInfoVersion={#AppVersion}
VersionInfoCompany=DevForge
VersionInfoProductName=DevForge
VersionInfoDescription=DevForge
CloseApplications=yes
RestartApplications=no
UsePreviousTasks=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
french.WelcomeLabel2=Cet assistant installe DevForge sur ce PC.%n%nLe programme est copié dans ton dossier utilisateur. Tes données restent dans un sous-dossier data, à côté du programme. À la fin, le navigateur s’ouvre sur http://127.0.0.1:8000.%n%nDocker (Docker Desktop) sert à déployer les apps. Sans Docker, l’interface démarre quand même.
english.WelcomeLabel2=This wizard installs DevForge on this PC.%n%nThe program is copied into your user folder. Your data stays in a data folder next to the program. When it finishes, the browser opens http://127.0.0.1:8000.%n%nDocker Desktop is used to deploy apps. Without Docker, the interface still starts.

[CustomMessages]
french.DesktopIcon=Créer un raccourci sur le bureau
english.DesktopIcon=Create a desktop shortcut
french.Autostart=Lancer DevForge à l’ouverture de session (ouvre le navigateur)
english.Autostart=Start DevForge when Windows starts (opens the browser)
french.ExtraIcons=Raccourcis :
english.ExtraIcons=Shortcuts:
french.LaunchApp=Lancer DevForge
english.LaunchApp=Launch DevForge

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; GroupDescription: "{cm:ExtraIcons}"; Flags: checkedonce
Name: "autostart"; Description: "{cm:Autostart}"; GroupDescription: "{cm:ExtraIcons}"; Flags: unchecked

[Files]
Source: "{#Stage}\devforge-server.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\devforge.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\templates\*"; DestDir: "{app}\templates"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\DevForge"; Filename: "{app}\devforge-server.exe"; IconFilename: "{app}\devforge.ico"
Name: "{group}\Désinstaller DevForge"; Filename: "{uninstallexe}"
Name: "{autodesktop}\DevForge"; Filename: "{app}\devforge-server.exe"; IconFilename: "{app}\devforge.ico"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DevForge"; ValueData: """{app}\devforge-server.exe"""; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\devforge-server.exe"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\devforge-server.exe"; Flags: nowait skipifnotsilent
