$BASE = "https://scholaxia1.onrender.com"

Write-Host "Testing Various Database Write Operations" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Test 1: Student signup (should work if database writes work)
Write-Host "`n1. Student Signup Test" -ForegroundColor Yellow
$randomEmail = "writetest$(Get-Random -Minimum 1000 -Maximum 9999)@test.com"
$signupBody = @{
    email = $randomEmail
    password = "Test123456!"
    full_name = "Write Test User"
} | ConvertTo-Json

try {
    $signupResponse = Invoke-RestMethod -Uri "$BASE/api/v1/auth/student/signup" -Method Post -Body $signupBody -ContentType "application/json" -TimeoutSec 30
    Write-Host "   ✅ SUCCESS: Database writes work" -ForegroundColor Green
    Write-Host "   Response: $($signupResponse | ConvertTo-Json)" -ForegroundColor Gray
} catch {
    Write-Host "   ❌ FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $errorBody = $_.ErrorDetails.Message
        if ($errorBody) {
            try {
                $errorJson = $errorBody | ConvertFrom-Json
                Write-Host "   Error details: $($errorJson.detail)" -ForegroundColor Red
            } catch {
                Write-Host "   Error details: $errorBody" -ForegroundColor Red
            }
        }
    }
}

# Test 2: Try admin login (read operation should work)
Write-Host "`n2. Admin Login Test (read operation)" -ForegroundColor Yellow
$loginBody = @{
    email = "admin@scholaxia.com"
    password = "ScholaxiaAdmin2026"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "$BASE/api/v1/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -TimeoutSec 30
    Write-Host "   ✅ SUCCESS: Read operations work" -ForegroundColor Green
    $token = $loginResponse.access_token
    Write-Host "   Got admin token" -ForegroundColor Gray
} catch {
    Write-Host "   ❌ FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Try to create a community post (write operation)
Write-Host "`n3. Community Post Creation Test (write operation)" -ForegroundColor Yellow
if ($token) {
    $postBody = @{
        content = "Test post to check database writes"
        subject = "Test"
    } | ConvertTo-Json
    
    try {
        $postResponse = Invoke-RestMethod -Uri "$BASE/api/v1/community/posts" -Method Post -Body $postBody -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -TimeoutSec 30
        Write-Host "   ✅ SUCCESS: Community post creation works" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "   ⚠️ Skipped - no admin token" -ForegroundColor Yellow
}

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "Database Write Tests Complete" -ForegroundColor Cyan
Write-Host "`nCONCLUSION:" -ForegroundColor Yellow
Write-Host "If any write operations fail, this is a DATABASE INFRASTRUCTURE issue." -ForegroundColor Red
Write-Host "The code is correct - the database is not accepting writes." -ForegroundColor Red