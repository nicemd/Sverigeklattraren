[CmdletBinding()]
param(
    [string]$Server = "nicemd@davtor1",
    [string]$Image = "ghcr.io/nicemd/sverigeforaren:latest",
    [string]$AppDirectory = "~/migrated-compose/sverigeforaren",
    [string]$Branch = "codex/wiki-2026",
    [int]$LocalBindPort = 3086,
    [string]$ServiceName = "sverigeforaren"
)

$ErrorActionPreference = "Stop"
if ($Server -notmatch '^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$') { throw "Ogiltigt SSH-mål." }
if ($Branch -notmatch '^[a-zA-Z0-9._/-]+$') { throw "Ogiltigt branch-namn." }
if ($ServiceName -notmatch '^[a-z0-9-]+$') { throw "Ogiltigt Tailscale service-namn." }

$repoRoot = $PSScriptRoot
$secretFile = Join-Path $repoRoot ".env.local"
if (-not (Test-Path -LiteralPath $secretFile)) { throw ".env.local saknas." }
$keyLine = Get-Content -LiteralPath $secretFile | Where-Object { $_ -match '^OPENAI_API_KEY=\S+' } | Select-Object -First 1
if (-not $keyLine) { throw "OPENAI_API_KEY saknas i .env.local." }

$answer = Read-Host "Detta bygger och pushar $Image samt ändrar Docker/Tailscale på $Server. Skriv DEPLOY för att fortsätta"
if ($answer -cne "DEPLOY") { Write-Host "Avbrutet utan fjärrändringar."; exit 0 }

docker build -t $Image $repoRoot
if ($LASTEXITCODE -ne 0) { throw "Docker-bygget misslyckades." }
docker push $Image
if ($LASTEXITCODE -ne 0) { throw "Push till GHCR misslyckades." }

$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("sverigeforaren-deploy-" + [guid]::NewGuid().ToString("N"))
$resolvedTemp = [IO.Path]::GetFullPath($tempDirectory)
New-Item -ItemType Directory -Path $resolvedTemp | Out-Null
try {
    $remoteEnv = Join-Path $resolvedTemp ".env"
    $envText = @(
        $keyLine
        "OPENAI_EDITORIAL_MODEL=gpt-5.6"
        "AUTO_PUBLISH_THRESHOLD=0.97"
        "GHCR_IMAGE=$Image"
        "LOCAL_BIND_PORT=$LocalBindPort"
        "PUBLIC_BASE_URL=https://$ServiceName.tail026a3a.ts.net"
    ) -join "`n"
    [IO.File]::WriteAllText($remoteEnv, $envText + "`n", [Text.UTF8Encoding]::new($false))

    ssh $Server "mkdir -p $AppDirectory"
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte skapa appkatalogen." }
    scp (Join-Path $repoRoot "docker-compose.yml") "${Server}:${AppDirectory}/docker-compose.yml"
    scp $remoteEnv "${Server}:${AppDirectory}/.env"
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte kopiera deployfiler." }

    $repositoryCommand = "if [ ! -d $AppDirectory/repository/.git ]; then git clone git@github.com:nicemd/Sverigeforaren.git $AppDirectory/repository; fi && cd $AppDirectory/repository && git fetch origin $Branch && git checkout $Branch && git pull --ff-only origin $Branch"
    ssh $Server $repositoryCommand
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte uppdatera innehållsrepot på servern." }

    $deployCommand = "cd $AppDirectory && sudo docker-compose pull && sudo docker-compose up -d --force-recreate --no-build && curl --fail --silent --show-error http://127.0.0.1:$LocalBindPort/ >/dev/null && sudo tailscale serve --bg --service=svc:$ServiceName --https=443 http://127.0.0.1:$LocalBindPort && sudo docker-compose ps"
    ssh -t $Server $deployCommand
    if ($LASTEXITCODE -ne 0) { throw "Fjärrdeploy eller verifiering misslyckades." }

    Write-Host "Publicerad privat på https://$ServiceName.tail026a3a.ts.net/"
}
finally {
    if (Test-Path -LiteralPath $resolvedTemp) {
        $validatedTemp = [IO.Path]::GetFullPath($resolvedTemp)
        $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($validatedTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $validatedTemp -Recurse -Force
        }
    }
}
