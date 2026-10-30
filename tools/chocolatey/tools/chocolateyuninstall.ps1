$ErrorActionPreference = 'Stop'

# The installer is per user, so its uninstall key is under HKCU.
[array]$keys = Get-UninstallRegistryKey -SoftwareName 'GG Stats*'
foreach ($key in $keys) {
  $file = $key.UninstallString -replace '^"([^"]+)".*$', '$1'
  Uninstall-ChocolateyPackage -PackageName $env:ChocolateyPackageName `
    -FileType 'exe' `
    -File $file `
    -SilentArgs '/currentuser /S'
}
