[CmdletBinding()]
param([string] $Origin = '')
$ErrorActionPreference = 'Stop'
if ($Origin) {
    $address = [uri] $Origin
    if (-not $address.IsAbsoluteUri -or
        ($address.Scheme -ne 'https' -and -not ($address.Scheme -eq 'http' -and $address.IsLoopback)) -or
        $address.UserInfo -or $address.Query -or $address.Fragment -or $address.AbsolutePath -ne '/' -or
        $Origin.Contains("\") -or $Origin.Contains("`r") -or $Origin.Contains("`n")) {
        throw 'Indica el origen HTTPS del aula, sin ruta. HTTP se admite para loopback.'
    }
    $Origin = $address.GetLeftPart([UriPartial]::Authority)
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$destination = Join-Path $PSScriptRoot 'dist'
[void][IO.Directory]::CreateDirectory($destination)
$attempt = [Guid]::NewGuid().ToString('N')
$temporaryOrigin = Join-Path $destination ($attempt + '.origin')
$temporaryExe = Join-Path $destination ($attempt + '.exe')
try {
    [IO.File]::WriteAllText($temporaryOrigin, $Origin)
    & $compiler /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /warnaserror+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/resource:$temporaryOrigin,Logika.origin" "/out:$temporaryExe" (Join-Path $PSScriptRoot 'LogikaSetup.cs')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar LogikaSetup.exe.' }
    $finalExe = Join-Path $destination 'LogikaSetup.exe'
    [IO.File]::Copy($temporaryExe, $finalExe, $true)
    Write-Output $finalExe
} finally {
    [IO.File]::Delete($temporaryOrigin)
    [IO.File]::Delete($temporaryExe)
}
