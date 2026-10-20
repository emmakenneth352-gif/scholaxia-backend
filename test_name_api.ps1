$BASE = "https://scholaxia1.onrender.com"

Write-Host "Testing Student Name Update API" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. Login to get token
Write-Host "`n1. Login to get student token" -ForegroundColor Yellow
$loginBody = @{
    email = "chidi@test.com"
    password = "Student123!"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "$BASE/api/v1/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -TimeoutSec 30
    $TOKEN = $loginResponse.access_token
    Write-Host "   ✅ Student token obtained" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Student login failed, trying admin..." -ForegroundColor Red
    $adminBody = @{
        email = "admin@scholaxia.com"
        password = "ScholaxiaAdmin2026"
    } | ConvertTo-Json
    
    try {
        $adminResponse = Invoke-RestMethod -Uri "$BASE/api/v1/auth/login" -Method Post -Body $adminBody -ContentType "application/json" -TimeoutSec 30
        $TOKEN = $adminResponse.access_token
        Write-Host "   ⚠️ Using admin token (endpoint may require student role)" -ForegroundColor Yellow
    } catch {
        Write-Host "   ❌ Cannot get any token. Aborting test." -ForegroundColor Red
        exit 1
    }
}

if (-not $TOKEN) {
    Write-Host "   ❌ No token available" -ForegroundColor Red
    exit 1
}

Write-Host "   Token: $($TOKEN.Substring(0, 20))..." -ForegroundColor Gray

# 2. Get current profile
Write-Host "`n2. Get current student profile" -ForegroundColor Yellow
try {
    $headers = @{
        "Authorization" = "Bearer $TOKEN"
    }
    $profile = Invoke-RestMethod -Uri "$BASE/api/v1/students/me" -Method Get -Headers $headers -TimeoutSec 30
    Write-Host "   Current name: $($profile.full_name)" -ForegroundColor Cyan
    $profile | ConvertTo-Json -Depth 10
} catch {
    Write-Host "   ❌ Failed to get profile: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Update name via PATCH
Write-Host "`n3. Update name via PATCH" -ForegroundColor Yellow
$TEST_NAME = "Test Student Updated"
$updateBody = @{
    full_name = $TEST_NAME
} | ConvertTo-Json

try {
    $updateResponse = Invoke-RestMethod -Uri "$BASE/api/v1/students/me" -Method Patch -Body $updateBody -ContentType "application/json" -Headers $headers -TimeoutSec 30
    Write-Host "   ✅ Name update response:" -ForegroundColor Green
    $updateResponse | ConvertTo-Json -Depth 10
    
    if ($updateResponse.debug) {
        Write-Host "   Debug info:" -ForegroundColor Yellow
        $updateResponse.debug | ConvertTo-Json -Depth 10
    }
} catch {
    Write-Host "   ❌ Failed to update name: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $errorBody = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($errorBody)
        $errorText = $reader.ReadToEnd()
        Write-Host "   Error details: $errorText" -ForegroundColor Red
    }
}

# 4. Verify the change persisted
Write-Host "`n4. Verify name persisted" -ForegroundColor Yellow
try {
    $updatedProfile = Invoke-RestMethod -Uri "$BASE/api/v1/students/me" -Method Get -Headers $headers -TimeoutSec 30
    Write-Host "   Final name: $($updatedProfile.full_name)" -ForegroundColor Cyan
    Write-Host "   Final email: $($updatedProfile.email)" -ForegroundColor Cyan
    
    if ($updatedProfile.full_name -eq $TEST_NAME) {
        Write-Host "   ✅ Name update SUCCESSFUL and PERSISTED" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Name update FAILED. Expected '$TEST_NAME', got '$($updatedProfile.full_name)'" -ForegroundColor Red
    }
    
    $updatedProfile | ConvertTo-Json -Depth 10
} catch {
    Write-Host "   ❌ Failed to verify: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan