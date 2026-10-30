$ErrorActionPreference = 'Stop'

# chocolatey.yml fills in the url and checksum of the release's installer.
Install-ChocolateyPackage -PackageName $env:ChocolateyPackageName `
  -FileType 'exe' `
  -Url64bit '__URL__' `
  -Checksum64 '__CHECKSUM__' `
  -ChecksumType64 'sha256' `
  -SilentArgs '/S'
