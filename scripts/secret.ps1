param([ValidateSet('read','write')][string]$Mode,[string]$Path)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
try {
 if($Mode -eq 'write') {
  $plain=[Console]::In.ReadToEnd().Trim()
  if($plain -notmatch '^sk-[A-Za-z0-9_-]{16,200}$'){throw 'Invalid credential format'}
  $bytes=[Text.Encoding]::UTF8.GetBytes($plain)
  $sealed=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
  [IO.File]::WriteAllBytes($Path,$sealed)
  [Array]::Clear($bytes,0,$bytes.Length)
 } else {
  $sealed=[IO.File]::ReadAllBytes($Path)
  $bytes=[Security.Cryptography.ProtectedData]::Unprotect($sealed,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
  [Array]::Clear($bytes,0,$bytes.Length)
 }
} catch { [Console]::Error.Write('Local credential operation failed');exit 1 }
