[CmdletBinding()]
param(
    [string]$Server = "nicemd@davtor1",
    [string]$Image = "ghcr.io/nicemd/sverigeklattraren",
    [string]$AppDirectory = "~/migrated-compose/sverigeklattraren",
    [string]$Branch = "main",
    [int]$LocalBindPort = 3086,
    [string]$ServiceName = "sverigeklattraren",
    [int]$FallbackHttpsPort = 8443,
    [switch]$Public,
    [switch]$Confirmed
)

$ErrorActionPreference = "Stop"
if ($Server -notmatch '^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$') { throw "Ogiltigt SSH-mål." }
if ($Branch -notmatch '^[a-zA-Z0-9._/-]+$') { throw "Ogiltigt branch-namn." }
if ($ServiceName -notmatch '^[a-z0-9-]+$') { throw "Ogiltigt Tailscale service-namn." }
if ($Image -notmatch '^ghcr\.io/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$') { throw "Image ska vara ett GHCR-repository utan tagg." }
if ($AppDirectory -notmatch '^~/[a-zA-Z0-9._/-]+$') { throw "Ogiltig appkatalog." }
if ($FallbackHttpsPort -lt 1024 -or $FallbackHttpsPort -gt 65535 -or $FallbackHttpsPort -eq 443) { throw "Ogiltig HTTPS-reservport." }

$repoRoot = $PSScriptRoot
$secretFile = Join-Path $repoRoot ".env.local"
if (-not (Test-Path -LiteralPath $secretFile)) { throw ".env.local saknas." }
$keyLine = Get-Content -LiteralPath $secretFile | Where-Object { $_ -match '^OPENAI_API_KEY=\S+' } | Select-Object -First 1
if (-not $keyLine) { throw "OPENAI_API_KEY saknas i .env.local." }

$currentBranch = (git -C $repoRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne $Branch) { throw "Checka ut $Branch före deploy." }
if (git -C $repoRoot status --porcelain) { throw "Arbetskopian måste vara ren före deploy." }
$gitSha = (git -C $repoRoot rev-parse --short=12 HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $gitSha) { throw "Kunde inte läsa Git-versionen." }
$imageRef = "${Image}:$gitSha"
$latestRef = "${Image}:latest"

$tailscaleStatusJson = ssh -o ConnectTimeout=10 $Server "tailscale status --self --json"
if ($LASTEXITCODE -ne 0) { throw "Kunde inte kontrollera Tailscale på $Server." }
try { $tailscaleStatus = $tailscaleStatusJson | ConvertFrom-Json } catch { throw "Tailscale returnerade ogiltig status-JSON." }
$requiredCapability = "services/$ServiceName"
$useService = $tailscaleStatus.Self.Capabilities -contains $requiredCapability
if ($useService) {
    $publicUrl = "https://$ServiceName.tail026a3a.ts.net/"
    $tailscaleServeCommand = "sudo tailscale serve --yes --bg --service=svc:$ServiceName --https=443 http://127.0.0.1:$LocalBindPort"
} else {
    $publicUrl = "https://davtor1.tail026a3a.ts.net:$FallbackHttpsPort/"
    $funnelStatus = (ssh $Server "sudo tailscale funnel status") -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte kontrollera befintlig Tailscale Funnel-status." }
    $funnelAlreadyEnabled = $funnelStatus -match ([regex]::Escape("https://davtor1.tail026a3a.ts.net:$FallbackHttpsPort") + ' \(Funnel on\)')
    $tailscaleServeCommand = if ($Public -or $funnelAlreadyEnabled) {
        "sudo tailscale funnel --yes --bg --https=$FallbackHttpsPort http://127.0.0.1:$LocalBindPort"
    } else {
        "sudo tailscale serve --yes --bg --https=$FallbackHttpsPort http://127.0.0.1:$LocalBindPort"
    }
    $serveStatus = (ssh $Server "sudo tailscale serve status --json") -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte kontrollera befintliga Tailscale Serve-portar." }
    if ($serveStatus -match ('"' + $FallbackHttpsPort + '"') -and $serveStatus -notmatch ('127\.0\.0\.1:' + $LocalBindPort)) {
        throw "Tailscale HTTPS-port $FallbackHttpsPort används redan av en annan tjänst."
    }
    if ($Public -or $funnelAlreadyEnabled) {
        Write-Warning "davtor1 saknar $requiredCapability. Bevarar publik Tailscale Funnel på $publicUrl."
    } else {
        Write-Warning "davtor1 saknar $requiredCapability. Publicerar privat via värdens MagicDNS på $publicUrl i stället."
    }
}

if (-not $Confirmed) {
    $answer = Read-Host "Detta bygger och pushar $imageRef samt ändrar Docker/Tailscale på $Server. Skriv DEPLOY för att fortsätta"
    if ($answer -cne "DEPLOY") { Write-Host "Avbrutet utan fjärrändringar."; exit 0 }
}

docker build -t $imageRef -t $latestRef $repoRoot
if ($LASTEXITCODE -ne 0) { throw "Docker-bygget misslyckades." }
docker push $imageRef
if ($LASTEXITCODE -ne 0) { throw "Push av versionsimagen till GHCR misslyckades." }
docker push $latestRef
if ($LASTEXITCODE -ne 0) { throw "Push till GHCR misslyckades." }

$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("sverigeklattraren-deploy-" + [guid]::NewGuid().ToString("N"))
$resolvedTemp = [IO.Path]::GetFullPath($tempDirectory)
New-Item -ItemType Directory -Path $resolvedTemp | Out-Null
try {
    $remoteEnv = Join-Path $resolvedTemp ".env"
    $envText = @(
        $keyLine
        "OPENAI_EDITORIAL_MODEL=gpt-5-mini"
        "AUTO_PUBLISH_THRESHOLD=0.97"
        "GITHUB_REPOSITORY=nicemd/Sverigeklattraren"
        "GITHUB_PROPOSAL_KEY_PATH=/run/secrets/github-proposal-key"
        "GHCR_IMAGE=$imageRef"
        "LOCAL_BIND_PORT=$LocalBindPort"
        "PUBLIC_BASE_URL=$($publicUrl.TrimEnd('/'))"
    ) -join "`n"
    [IO.File]::WriteAllText($remoteEnv, $envText + "`n", [Text.UTF8Encoding]::new($false))

    ssh $Server "mkdir -p $AppDirectory && cd $AppDirectory && if [ -f .env ]; then cp -f .env .env.previous && chmod 600 .env.previous; fi && if [ -f docker-compose.yml ]; then cp -f docker-compose.yml docker-compose.yml.previous; fi"
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte skapa appkatalogen." }
    scp (Join-Path $repoRoot "docker-compose.yml") "${Server}:${AppDirectory}/docker-compose.yml"
    scp $remoteEnv "${Server}:${AppDirectory}/.env"
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte kopiera deployfiler." }
    ssh $Server "chmod 600 $AppDirectory/.env"
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte skydda fjärrens miljöfil." }

    $repositoryCommand = "if [ ! -d $AppDirectory/repository/.git ]; then git clone https://github.com/nicemd/Sverigeklattraren.git $AppDirectory/repository; fi && cd $AppDirectory/repository && git remote set-url origin https://github.com/nicemd/Sverigeklattraren.git && git fetch origin $Branch && git checkout $Branch && git pull --ff-only origin $Branch"
    ssh $Server $repositoryCommand
    if ($LASTEXITCODE -ne 0) { throw "Kunde inte uppdatera innehållsrepot på servern." }

    # One-time compatibility migration from the former product deployment.
    $legacyAppDirectory = "~/migrated-compose/sverigeforaren"
    $legacyWasRunning = $false
    if ($AppDirectory -ne $legacyAppDirectory) {
        $legacyProbe = (ssh $Server "if [ -f $legacyAppDirectory/docker-compose.yml ] && cd $legacyAppDirectory && [ -n `"`$(sudo docker-compose ps -q 2>/dev/null)`" ]; then echo running; else echo stopped; fi") -join "`n"
        $legacyWasRunning = $legacyProbe.Trim() -eq "running"
        if ($legacyWasRunning) {
            ssh -t $Server "cd $legacyAppDirectory && sudo docker-compose down"
            if ($LASTEXITCODE -ne 0) { throw "Kunde inte stoppa den äldre Sverigeföraren-deployen inför migreringen." }
        }
    }
    $deployCommand = 'cd {0} && sudo docker-compose pull && sudo docker-compose up -d --force-recreate --no-build && for i in $(seq 1 30); do curl --fail --silent http://127.0.0.1:{1}/ >/dev/null && break; if [ "$i" -eq 30 ]; then exit 1; fi; sleep 2; done && {2} && sudo tailscale serve status --json && tailscale status --self --json && sudo docker-compose ps' -f $AppDirectory, $LocalBindPort, $tailscaleServeCommand
    ssh -t $Server $deployCommand
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Fjärrdeploy misslyckades. Försöker återställa föregående compose-konfiguration."
        $rollbackCommand = 'cd {0} && if [ -f .env.previous ] && [ -f docker-compose.yml.previous ]; then cp -f .env.previous .env && cp -f docker-compose.yml.previous docker-compose.yml && chmod 600 .env && sudo docker-compose pull && sudo docker-compose up -d --force-recreate --no-build; fi' -f $AppDirectory
        ssh -t $Server $rollbackCommand
        if ($legacyWasRunning) { ssh -t $Server "cd $legacyAppDirectory && sudo docker-compose up -d" }
        throw "Fjärrdeploy eller verifiering misslyckades; rollback har försökts."
    }

    $response = Invoke-WebRequest -UseBasicParsing -Uri $publicUrl -TimeoutSec 20
    if ($response.StatusCode -ne 200) { throw "Tailscale-adressen svarade inte med HTTP 200." }

    Write-Host "Publicerad privat på $publicUrl från Git $gitSha"
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
