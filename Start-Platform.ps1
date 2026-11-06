[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$settings=Get-Content -LiteralPath (Join-Path $taskRoot 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$localSettingsPath=Join-Path $taskRoot 'settings.local.json'
if(Test-Path -LiteralPath $localSettingsPath){$localSettings=Get-Content -LiteralPath $localSettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json;foreach($property in $localSettings.PSObject.Properties){$settings | Add-Member -MemberType NoteProperty -Name $property.Name -Value $property.Value -Force}}
if(-not [IO.Path]::IsPathRooted($settings.outputDir)){$settings.outputDir=Join-Path $taskRoot $settings.outputDir}
$address='http://127.0.0.1:'+$settings.port
$nodePath=(Get-Command node.exe -ErrorAction SilentlyContinue).Source
if(-not $nodePath){throw 'Node.js 22.13 or later is required.'}
$already=$false
try{$state=Invoke-RestMethod -Uri ($address+'/api/state') -TimeoutSec 3;$already=$state.version -eq '0.1.0'}catch{}
if(-not $already){
 New-Item -ItemType Directory -Path $settings.outputDir -Force | Out-Null
 $stdout=Join-Path $settings.outputDir 'server.stdout.log';$stderr=Join-Path $settings.outputDir 'server.stderr.log'
 Start-Process -FilePath $nodePath -ArgumentList @('"'+(Join-Path $taskRoot 'src\server.mjs')+'"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
 for($attempt=0;$attempt -lt 20;$attempt++){
  Start-Sleep -Milliseconds 500
  try{$state=Invoke-RestMethod -Uri ($address+'/api/state') -TimeoutSec 2;if($state.version -eq '0.1.0'){$already=$true;break}}catch{}
 }
 if(-not $already){throw ('Server did not become ready. See '+$stderr)}
}
Write-Host ('KnowFlow is ready: '+$address)
if(-not $NoBrowser){Start-Process $address}
