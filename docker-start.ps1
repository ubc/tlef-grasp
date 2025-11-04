# PowerShell script for GRASP Docker setup (Windows)

Write-Host "🐳 GRASP Docker Setup" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "Error: Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

# Check if .env file exists
if (!(Test-Path .env)) {
    Write-Host "No .env file found!" -ForegroundColor Yellow
    Write-Host "Creating .env from template..." -ForegroundColor Yellow
    Copy-Item env-docker.template .env
    Write-Host "Created .env file" -ForegroundColor Green
    Write-Host ""
    Write-Host "IMPORTANT: Please edit .env file with your actual values!" -ForegroundColor Yellow
    Write-Host "   Minimum required changes:"
    Write-Host "   - MONGO_INITDB_ROOT_PASSWORD"
    Write-Host "   - SESSION_SECRET"
    Write-Host ""
    Read-Host "Press Enter after editing .env file to continue"
}

# Check if certificate exists
if (!(Test-Path "./certs/cert.crt")) {
    Write-Host "SAML certificate not found at ./certs/cert.crt" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Attempting to extract from your custom SAML IdP..." -ForegroundColor Cyan
    
    try {
        docker exec docker-simple-saml-saml-idp-1 cat /var/www/simplesamlphp/cert/idp.crt > certs/cert.crt 2>$null
        Write-Host "Certificate extracted successfully!" -ForegroundColor Green
    } catch {
        Write-Host "Could not auto-extract certificate" -ForegroundColor Yellow
        Write-Host "   Please extract manually using:" -ForegroundColor Yellow
        Write-Host "   docker exec docker-simple-saml-saml-idp-1 cat /var/www/simplesamlphp/cert/idp.crt > certs/cert.crt" -ForegroundColor White
        Write-Host ""
    }
}

# Check if custom SAML IdP is running
Write-Host "📡 Checking if your custom SAML IdP is running..." -ForegroundColor Cyan
$idpRunning = docker ps --format "{{.Names}}" | Select-String -Pattern "saml-idp"

if (!$idpRunning) {
    Write-Host "Custom SAML IdP not detected!" -ForegroundColor Yellow
    Write-Host ""
    $startIdp = Read-Host "Do you want to start it now? [Y/n]"
    
    if ($startIdp -ne "n" -and $startIdp -ne "N") {
        $idpPath = "C:\Users\ovo\Documents\GitHub\docker-simple-saml"
        
        if (Test-Path $idpPath) {
            Write-Host "Starting custom SAML IdP..." -ForegroundColor Cyan
            Push-Location $idpPath
            docker-compose up -d
            Pop-Location
            
            Write-Host "Custom IdP started" -ForegroundColor Green
            Write-Host "   Waiting for IdP to be ready..." -ForegroundColor Cyan
            Start-Sleep -Seconds 5
        } else {
            Write-Host "Custom IdP path not found: $idpPath" -ForegroundColor Red
            Write-Host "   Please start your IdP manually before continuing." -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Host "Please start your SAML IdP manually and run this script again." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "Custom SAML IdP is running" -ForegroundColor Green
}

Write-Host ""
Write-Host "   Starting GRASP services..." -ForegroundColor Green
Write-Host "   Services starting:" -ForegroundColor Cyan
Write-Host "   - MongoDB (port 27017)" -ForegroundColor White
Write-Host "   - Mongo Express (port 8081)" -ForegroundColor White
Write-Host "   - GRASP App (port 8070)" -ForegroundColor White
Write-Host ""

# Start services
docker-compose up --build -d

# Wait a moment for health checks
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "📊 Container Status:" -ForegroundColor Cyan
docker-compose ps

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "GRASP is ready!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host " Access your services:" -ForegroundColor Cyan
Write-Host "   - GRASP App:    http://localhost:8070" -ForegroundColor White
Write-Host "   - SAML IdP:     http://localhost:8080/simplesaml" -ForegroundColor White
Write-Host "   - MongoDB UI:   http://localhost:8081" -ForegroundColor White
Write-Host ""
Write-Host "Test Login:" -ForegroundColor Cyan
Write-Host "   - Instructor:   user1 / user1pass" -ForegroundColor White
Write-Host "   - Student:      user2 / user2pass" -ForegroundColor White
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "   - View logs:    docker-compose logs -f grasp-app" -ForegroundColor White
Write-Host "   - Stop:         docker-compose down" -ForegroundColor White
Write-Host "   - Restart:      docker-compose restart grasp-app" -ForegroundColor White
Write-Host ""
