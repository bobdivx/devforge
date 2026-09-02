# Deploye la cle SSH Windows vers Demeter (une fois le mot de passe SSH fonctionne).
# Usage:
#   $env:DEMETER_SSH_PASSWORD='...'
#   .\scripts\demeter-bootstrap\install-ssh-key-windows.ps1
param(
    [string]$HostName = "10.1.0.88",
    [string]$User = "bobdivx",
    [string]$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519_demeter.pub"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $KeyPath)) {
    Write-Error "Cle publique introuvable : $KeyPath. Generer avec ssh-keygen -f $KeyPath"
}
$pub = (Get-Content $KeyPath -Raw).Trim()
$password = $env:DEMETER_SSH_PASSWORD
if (-not $password) {
    Write-Error "Definir DEMETER_SSH_PASSWORD pour la premiere installation."
}

$py = @"
import paramiko, sys
host, user, password, pubkey = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, username=user, password=password, timeout=30)
cmd = (
    'umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; '
    'chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; '
    f'grep -qF "{pubkey}" ~/.ssh/authorized_keys || echo "{pubkey}" >> ~/.ssh/authorized_keys; '
    'echo KEY_OK'
)
_, o, e = c.exec_command(cmd)
out = o.read().decode(); err = e.read().decode()
print(out, err)
c.close()
if 'KEY_OK' not in out:
    sys.exit(1)
"@

py -3 -c $py $HostName $User $password $pub
Write-Host "OK — tester : ssh demeter hostname" -ForegroundColor Green
