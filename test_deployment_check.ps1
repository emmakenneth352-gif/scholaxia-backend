$BASE = "https://scholaxia1.onrender.com"

Write-Host "Checking if backend is deployed with latest changes" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. Check if the PATCH endpoint exists at all
Write-Host "`n1. Testing if PATCH endpoint exists" -ForegroundColor Yellow
try {
    $testResponse = Invoke-WebRequest -Uri "$BASE/api/v1/students/me" -Method Options -TimeoutSec 10
    Write-Host "   ✅ Endpoint exists" -ForegroundColor Green
    Write-Host "   Allowed methods: $($testResponse.Headers['Allow'])" -ForegroundColor Gray
} catch {
    Write-Host "   ❌ Endpoint test failed: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. Try a simple PATCH request (without auth) to see if we get 401 (which means endpoint exists)
Write-Host "`n2. Testing PATCH endpoint without auth (expecting 401)" -ForegroundColor Yellow
try {
    $testBody = @{ full_name = "Test" } | ConvertTo-Json
    $testResponse = Invoke-RestMethod -Uri "$BASE/api/v1/students/me" -Method Patch -Body $testBody -ContentType "application/json" -TimeoutSec 10 -ErrorAction Stop
    Write-Host "   ⚠️ Unexpected success (should be 401)" -ForegroundColor Yellow
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host "   ✅ Got expected 401 Unauthorized - endpoint exists" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Got unexpected error: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    }
}

# 3. Check database write permissions by trying to create a test user
Write-Host "`n3. Testing database write permissions via signup" -ForegroundColor Yellow
$randomEmail = "test$(Get-Random -Minimum 1000 -Maximum 9999)@test.com"
$signupBody = @{
    email = $randomEmail
    password = "Test123456!"
    full_name = "Database Write Test"
} | ConvertTo-Json

try {
    $signupResponse = Invoke-RestMethod -Uri "$BASE/api/v1/auth/student/signup" -Method Post -Body $signupBody -ContentType "application/json" -TimeoutSec 30
    Write-Host "   ✅ Signup successful - database writes work" -ForegroundColor Green
    Write-Host "   Response: $($signupResponse.message)" -ForegroundColor Gray
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 400) {
        $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host "   ⚠️ Got 400 (might be email already exists): $($errorBody.detail)" -ForegroundColor Yellow
    } else {
        Write-Host "   ❌ Signup failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 4. Check if there are any database connection issues
Write-Host "`n4. Testing database connectivity via simple query" -ForegroundColor Yellow
try {
    $healthResponse = Invoke-RestMethod -Uri "$BASE/health" -Method Get -TimeoutSec 10
    Write-Host "   ✅ Database connection: $($healthResponse.database)" -ForegroundColor Green
    Write-Host "   Database host: $($healthResponse.database_host)" -ForegroundColor Gray
} catch {
    Write-Host "   ❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "Deployment Check Complete" -ForegroundColor Cyan