param([Parameter(Mandatory=$true)][string]$InputDocx,[Parameter(Mandatory=$true)][string]$PidFile,[string]$TempRoot=[IO.Path]::GetTempPath())
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $InputDocx).Path
$pidTarget = Join-Path (Resolve-Path -LiteralPath (Split-Path -Parent $PidFile)).Path (Split-Path -Leaf $PidFile)
$verifiedTempRoot = (Resolve-Path -LiteralPath $TempRoot).Path.TrimEnd('\') + '\'
if (-not $source.StartsWith($verifiedTempRoot,[StringComparison]::OrdinalIgnoreCase) -or -not $source.EndsWith('.docx') -or [IO.Path]::GetDirectoryName($source) -ne [IO.Path]::GetDirectoryName($pidTarget)) { throw 'Only isolated temporary documents are supported.' }
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class StudyWordWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }'
$existing = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$word = $null
$document = $null
$owned = $false
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $probe = $word.Documents.Add()
  [uint32]$instanceId = 0
  [void][StudyWordWindow]::GetWindowThreadProcessId([IntPtr]$word.ActiveWindow.Hwnd,[ref]$instanceId)
  if ($instanceId -eq 0 -or $existing -contains [int]$instanceId) { throw 'No independent Word instance available.' }
  $owned = $true
  $probe.Close(0)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($probe)
  [IO.File]::WriteAllText($pidTarget,[string]$instanceId)
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $word.Options.UpdateLinksAtOpen = $false
  $document = $word.Documents.Open($source,$false,$false)
  $document.Fields.Update() | Out-Null
  for ($pass = 0; $pass -lt 2; $pass++) {
    $document.Repaginate()
    foreach ($toc in $document.TablesOfContents) { $toc.Update(); $toc.UpdatePageNumbers() }
  }
  $document.Save()
  Write-Output 'Updated native Word contents and page fields.'
} finally {
  if ($document) { $document.Close(0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($word) { if ($owned) { $word.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
}
