# ============================================================================
#  Vizitik - local development on Windows
# ============================================================================
#  The Ubuntu scripts (setup-server.sh, update.sh) stay exactly as they are;
#  this is the Windows twin of setup-local.sh + run-dev.sh, so a checkout on a
#  Windows machine can be installed and started without Git Bash.
#
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-windows.ps1
#        first run: .env + install + prisma, then starts everything
#        (placeholder secrets get random values; the local MySQL is found and the
#         database is created automatically - XAMPP is detected in C:\xampp and D:\xampp)
#
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-windows.ps1 -SetupOnly
#        install and prepare, do not start anything
#
#    ... -MysqlRootPassword '<pass>'     only if your MySQL root is not empty
#
#  Starts: API :3000 · admin panel :3001 · PWA :5173 (proxying /api)
#  Stop with Ctrl+C. The legacy PHP site is not started here - run it by hand.
# ============================================================================
param(
    [switch]$SetupOnly,
    [string]$MysqlRootPassword = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Fail([string]$Message) {
    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

# UTF-8 without BOM: a BOM in front of the first key is enough to break dotenv
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-EnvFile([string]$Path, [string[]]$Lines) {
    [System.IO.File]::WriteAllLines($Path, $Lines, $Utf8NoBom)
}
function New-RandomSecret([int]$Length, [string]$Alphabet) {
    -join ((1..$Length) | ForEach-Object { $Alphabet.ToCharArray() | Get-Random })
}

# ---- prerequisites ---------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node 22+ is required and was not found on PATH (https://nodejs.org)."
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { Fail "Node 22+ is required (found $(node -v))." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm was not found on PATH." }

# ---- backend/.env ----------------------------------------------------------
$envPath = Join-Path $Root 'backend\.env'
$examplePath = Join-Path $Root 'backend\.env.example'
if (-not (Test-Path $envPath)) {
    Copy-Item $examplePath $envPath
    $lines = Get-Content $envPath | ForEach-Object {
        $_ -replace '^NODE_ENV=production', 'NODE_ENV=development' `
           -replace '^BIND_HOST="127\.0\.0\.1"', 'BIND_HOST="0.0.0.0"' `
           -replace '^JWT_SECRET="PASTE_A_LONG_RANDOM_SECRET"', "JWT_SECRET=`"$(New-RandomSecret 48 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789')`"" `
           -replace '^ADMIN_TOKEN=""', "ADMIN_TOKEN=`"$(New-RandomSecret 64 '0123456789abcdef')`""
    }
    Write-EnvFile $envPath ([string[]]$lines)
    Fail "Created backend\.env. Set DATABASE_URL in it (MySQL must already be running), then run this again."
}

function Read-Env([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') {
            $map[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    $map
}
$cfg = Read-Env $envPath

# fill the random secrets the way setup-local.sh does; never invent credentials
$toFix = @()
if (-not $cfg['JWT_SECRET'] -or $cfg['JWT_SECRET'] -like '*PASTE_A_*') { $toFix += 'JWT_SECRET' }
if (-not $cfg['ADMIN_TOKEN'] -or $cfg['ADMIN_TOKEN'] -like '*CHANGE_ME*') { $toFix += 'ADMIN_TOKEN' }
if ($toFix.Count) {
    $lines = Get-Content $envPath | ForEach-Object {
        $line = $_
        if ($toFix -contains 'JWT_SECRET' -and $line -match '^\s*JWT_SECRET\s*=') {
            "JWT_SECRET=`"$(New-RandomSecret 48 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789')`""
        } elseif ($toFix -contains 'ADMIN_TOKEN' -and $line -match '^\s*ADMIN_TOKEN\s*=') {
            "ADMIN_TOKEN=`"$(New-RandomSecret 64 '0123456789abcdef')`""
        } else { $line }
    }
    Write-EnvFile $envPath ([string[]]$lines)
    $cfg = Read-Env $envPath
    Write-Host "Filled $($toFix -join ' and ') in backend\.env (they were still placeholders)."
}

# ---- local MySQL (XAMPP) ---------------------------------------------------
# If DATABASE_URL is still the placeholder, find the local MySQL, create the
# database with utf8mb4 (Persian text is stored correctly that way) and write
# the URL back into backend/.env - no hand editing.
$dbUrl = $cfg['DATABASE_URL']
if (-not $dbUrl -or $dbUrl -like '*CHANGE_ME*') {
    $dbName = 'vizitik_db'
    if ($cfg['DB_NAME'] -match '^[A-Za-z0-9_]+$') { $dbName = $cfg['DB_NAME'] }

    $mySql = $null
    foreach ($candidate in @('C:\xampp\mysql\bin\mysql.exe', 'D:\xampp\mysql\bin\mysql.exe')) {
        if (Test-Path $candidate) { $mySql = $candidate; break }
    }
    if (-not $mySql) {
        $onPath = Get-Command mysql -ErrorAction SilentlyContinue
        if ($onPath) { $mySql = $onPath.Source }
    }

    if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
        Fail "MySQL is not answering on 127.0.0.1:3306.`nStart it from the XAMPP Control Panel (MySQL -> Start), then run this again."
    }
    if (-not $mySql) {
        Fail "mysql.exe was not found (looked in C:\xampp\mysql\bin, D:\xampp\mysql\bin and PATH).`nInstall XAMPP there, or add its mysql\bin to PATH, then run this again."
    }

    Write-Host "Creating database $dbName on the local MySQL ($mySql) with utf8mb4..."
    $sql = "CREATE DATABASE IF NOT EXISTS $dbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; ALTER DATABASE $dbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    if ($MysqlRootPassword) {
        & $mySql -h 127.0.0.1 -u root "-p$MysqlRootPassword" -e $sql
    } else {
        & $mySql -h 127.0.0.1 -u root -e $sql
    }
    if ($LASTEXITCODE -ne 0) {
        Fail "Could not create the database as MySQL root.`nIf your root has a password, rerun with:  -MysqlRootPassword '<password>'"
    }

    $pass = $MysqlRootPassword
    if ($pass -match '["\r\n]') { Fail 'The MySQL password cannot contain a double quote; edit DATABASE_URL in backend\.env by hand.' }
    $auth = if ($pass) { 'root:' + [uri]::EscapeDataString($pass) } else { 'root' }
    $url = "mysql://$auth@127.0.0.1:3306/$dbName"
    $lines = Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*DATABASE_URL\s*=') { "DATABASE_URL=`"$url`"" }
        elseif ($_ -match '^\s*DB_NAME\s*=') { "DB_NAME=`"$dbName`"" }
        elseif ($_ -match '^\s*DB_USER\s*=') { 'DB_USER="root"' }
        elseif ($_ -match '^\s*DB_PASS\s*=') { "DB_PASS=`"$pass`"" }
        elseif ($_ -match '^\s*DB_HOST\s*=') { 'DB_HOST="127.0.0.1"' }
        else { $_ }
    }
    Write-EnvFile $envPath ([string[]]$lines)
    $cfg = Read-Env $envPath
    Write-Host "DATABASE_URL now points at the local MySQL database '$dbName' (utf8mb4)."
}

$dbUrl = $cfg['DATABASE_URL']
if (-not $dbUrl -or $dbUrl -like '*CHANGE_ME*') {
    Fail "DATABASE_URL in backend\.env is still the placeholder. Set it to your MySQL, e.g.`n  DATABASE_URL=`"mysql://root@127.0.0.1:3306/vizitik_db`"`nthen run this again."
}

if (-not $cfg['BALE_BOT_TOKEN']) {
    Write-Host "WARNING: BALE_BOT_TOKEN is empty in backend\.env - the Bale bot stays silent and" -ForegroundColor Yellow
    Write-Host "         no OTP code can be delivered. Fill it from @BaleChatBotBot before testing signups." -ForegroundColor Yellow
}

# ---- install and prepare ---------------------------------------------------
$toInstall = @('backend', 'frontend-app') | Where-Object { -not (Test-Path (Join-Path $Root "$_\node_modules")) }
foreach ($pkg in $toInstall) {
    Write-Host "Installing $pkg (npm ci)..."
    Push-Location (Join-Path $Root $pkg)
    npm ci --include=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npm ci failed in $pkg." }
    Pop-Location
}

Push-Location (Join-Path $Root 'backend')
# backend\.env is the source of truth: a DATABASE_URL exported in the Windows
# environment must not silently point prisma at some other database
$env:DATABASE_URL = $null
npx prisma generate
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "prisma generate failed." }
# the tables come first: the backend cannot start without them
npx prisma db push --skip-generate
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Fail "prisma db push failed - is MySQL running and is DATABASE_URL correct?"
}
Pop-Location

if ($SetupOnly) {
    Write-Host "Setup complete. Start everything with:"
    Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-windows.ps1"
    exit 0
}

# ---- start -----------------------------------------------------------------
$env:NODE_ENV = 'development'
$env:HOST = '0.0.0.0'
$env:BIND_HOST = '0.0.0.0'
$port = if ($cfg['PORT']) { $cfg['PORT'] } else { '3000' }
$adminPort = if ($cfg['ADMIN_PORT']) { $cfg['ADMIN_PORT'] } else { '3001' }
# Vite proxies /api to the backend, so the PWA talks to a same-origin API
$env:DEV_API_TARGET = "http://127.0.0.1:$port"

$busy = @()
foreach ($p in @($port, $adminPort, '5173')) {
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue) { $busy += $p }
}
if ($busy.Count) {
    Write-Host ""
    Write-Host "WARNING: already answering on port(s): $($busy -join ', ')" -ForegroundColor Yellow
    Write-Host "         An older run is still alive - stop it first, or this run will not own those ports." -ForegroundColor Yellow
}

$procs = @()
$procs += Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'start:dev' -WorkingDirectory (Join-Path $Root 'backend') -NoNewWindow -PassThru
$procs += Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory (Join-Path $Root 'admin') -NoNewWindow -PassThru
$procs += Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev', '--', '--host', '0.0.0.0' -WorkingDirectory (Join-Path $Root 'frontend-app') -NoNewWindow -PassThru

function Wait-Ready([string]$Url, [int]$Seconds) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -ge 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}
Wait-Ready "http://127.0.0.1:$port/api/health" 60 | Out-Null
Wait-Ready "http://127.0.0.1:$adminPort/" 30 | Out-Null
Wait-Ready "http://127.0.0.1:5173/" 30 | Out-Null

$lan = ''
try {
    $lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -First 1).IPAddress
} catch { }
if ($lan -is [array]) { $lan = $lan[0] }

$phoneBlock = if ($lan) {
    "`n  From a phone on the same Wi-Fi:`n    Visitor app       http://${lan}:5173`n    Admin panel       http://${lan}:$adminPort"
} else {
    "`n  Phone access: find this machine's IPv4 address (ipconfig) and open http://<that-ip>:5173"
}

Write-Host @"

======================================================================
  Vizitik is up
======================================================================
  API (backend)       http://localhost:$port             (check: /api/health)
  Admin panel (SQL)   http://localhost:$adminPort
  Visitor app (PWA)   http://localhost:5173             (/api -> :$port)
  Admin token         : select ADMIN_TOKEN backend\.env
  First account       : «ثبت‌نام ویزیتور جدید» in the app (the code goes to Bale)
$phoneBlock
  Stop everything     : Ctrl+C
======================================================================
"@

try {
    while ($true) {
        Start-Sleep -Seconds 5
        foreach ($p in $procs) {
            if ($p.HasExited) { Fail "a service stopped (exit $($p.ExitCode)) - check its output above." }
        }
    }
} finally {
    Write-Host ""
    Write-Host 'stopping dev servers...'
    foreach ($p in $procs) {
        if (-not $p.HasExited) {
            # taskkill through cmd: "2>$null" on a native command throws under $ErrorActionPreference='Stop'
            cmd /c "taskkill /T /F /PID $($p.Id) >nul 2>&1"
        }
    }
}
