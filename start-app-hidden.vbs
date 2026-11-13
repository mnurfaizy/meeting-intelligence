' Starts Meeting Intelligence (http://localhost:3000) in the background, with no window,
' so it cannot be closed by accident. Output goes to logs\app.log. Stop it with stop-app.cmd.
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(folder & "\logs") Then fso.CreateFolder(folder & "\logs")
CreateObject("WScript.Shell").Run "cmd /c """"" & folder & "\start-app.cmd"" >> """ & folder & "\logs\app.log"" 2>&1""", 0, False
