#!/bin/bash

BASE="https://scholaxia1.onrender.com"

echo "Testing Student Name Update API"
echo "================================"

# 1. Login to get token
echo "1. Login to get student token"
TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"chidi@test.com","password":"Student123!"}' | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo "   ❌ Failed to get token. Trying admin login..."
    TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
      -H "Content-Type: application/json" \
      -d '{"email":"admin@scholaxia.com","password":"ScholaxiaAdmin2026"}' | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$TOKEN" ]; then
        echo "   ❌ Cannot get any token. Aborting test."
        exit 1
    fi
    echo "   ⚠️ Using admin token (endpoint may require student role)"
fi

echo "   ✅ Token obtained: ${TOKEN:0:20}..."

# 2. Get current profile
echo ""
echo "2. Get current student profile"
curl -s -X GET "$BASE/api/v1/students/me" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# 3. Update name via PATCH
echo ""
echo "3. Update name via PATCH"
TEST_NAME="Test Student Updated"
RESPONSE=$(curl -s -X PATCH "$BASE/api/v1/students/me" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"full_name\":\"$TEST_NAME\"}")

echo "   Response: $RESPONSE"
echo "$RESPONSE" | jq '.'

# 4. Verify the change persisted
echo ""
echo "4. Verify name persisted"
curl -s -X GET "$BASE/api/v1/students/me" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

echo ""
echo "================================"
echo "Test Complete"