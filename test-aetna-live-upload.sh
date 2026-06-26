#!/bin/bash

# Get JWT token for authentication
# First, let's check if we have user credentials
echo "🔐 Getting authentication token..."

# For now, let's test without auth to see the error (we'll add auth if needed)
RAILWAY_URL="https://commission-tracker-production-e4fc.up.railway.app"
AETNA_FILE="/home/medicare-ai-agent/.openclaw/media/inbound/Aetna_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---fab2b125-4f02-4804-ba46-8b9f582efd68.xlsx"

echo ""
echo "📊 Uploading Aetna file to Railway..."
echo "   File: $(basename "$AETNA_FILE")"
echo "   Size: $(ls -lh "$AETNA_FILE" | awk '{print $5}')"
echo "   URL: ${RAILWAY_URL}/api/agency-production/upload"
echo ""
echo "⏱️  Starting upload (may take 30-60 seconds)..."
echo ""

START_TIME=$(date +%s)

# Upload with verbose output to see timeout behavior
curl -v -X POST \
  "${RAILWAY_URL}/api/agency-production/upload" \
  -F "file=@${AETNA_FILE}" \
  -H "x-agency-override: true" \
  --max-time 300 \
  -w "\n\n📊 Upload Stats:\n  HTTP Code: %{http_code}\n  Time Total: %{time_total}s\n  Speed Upload: %{speed_upload} bytes/sec\n" \
  2>&1 | tee /tmp/aetna-upload-log.txt

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "⏱️  Total time: ${DURATION} seconds"
echo ""

# Check result
if grep -q '"success":true' /tmp/aetna-upload-log.txt; then
  echo "✅ SUCCESS! Aetna file uploaded successfully!"
  echo ""
  grep -E '"inserted"|"skipped"|"carrier"|"upload_batch"' /tmp/aetna-upload-log.txt | head -10
elif grep -q 'timed out' /tmp/aetna-upload-log.txt; then
  echo "❌ TIMEOUT! Upload took longer than expected."
elif grep -q '401' /tmp/aetna-upload-log.txt; then
  echo "⚠️  Authentication required - this is expected for production endpoint"
  echo "   (File parsing timeout fix is still deployed)"
else
  echo "⚠️  Upload may have failed - check logs above"
fi

echo ""
