param([Parameter(Mandatory=$true)][string]$InputDocx, [Parameter(Mandatory=$true)][string]$OutputPdf)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $InputDocx).Path
$target = [IO.Path]::GetFullPath($OutputPdf)
if (-not $source.EndsWith('.docx') -or -not $target.EndsWith('.pdf')) { throw 'Use DOCX input and PDF output.' }
$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $document = $word.Documents.Open($source, $false, $true)
  $document.ExportAsFixedFormat($target, 17)
  Write-Output 'Rendered the isolated DOCX using installed Microsoft Word.'
} finally {
  if ($document) { $document.Close(0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($word) { $word.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
}
