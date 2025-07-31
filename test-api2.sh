#!/bin/bash

HOST="http://localhost:3001"
FILE="./images/nvidia.png"

LICENSOR="0x075C0Be6312CDF3f9173E1cCb57fe02BF36A011E"
LICENSEE="0x871f1B7B495E9C8500272699eA5423Ef1Dfe73Cb"
SCOPE="CommercialWeb"
PRICE="10000000000000000" # 0.01 ETH in wei
DURATION=31536000
TRANSFERABLE=true
LEGAL_TERMS="Standard_commercial_web_use"

# Output functions
print_success() { echo -e "\033[32m✅ $1\033[0m"; }
print_error()   { echo -e "\033[31m❌ $1\033[0m"; }
print_info()    { echo -e "\033[34mℹ️  $1\033[0m"; }
extract_json_value() { echo "$1" | grep -oP "(?<=\"$2\":\")[^\"]*" | head -1; }

# ------------------------
# Upload file to IPFS
# ------------------------
print_info "Uploading file to IPFS..."
if [ ! -f "$FILE" ]; then
    print_error "File does not exist: $FILE"
    exit 1
fi

UPLOAD_RESPONSE=$(curl -s -X POST "$HOST/api/ipfs/upload" -F "file=@$FILE")
CID=$(extract_json_value "$UPLOAD_RESPONSE" "cid")

if [ -z "$CID" ]; then
    print_error "Upload failed: $UPLOAD_RESPONSE"
    exit 1
fi
print_success "Upload successful, CID: $CID"

# ------------------------
# Register work
# ------------------------
print_info "Registering work on chain..."
REGISTER_RESPONSE=$(curl -s -X POST "$HOST/api/ip/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"author\": \"$LICENSOR\",
    \"filename\": \"testfile.jpg\",
    \"description\": \"Test image registration\",
    \"cid\": \"$CID\",
    \"licenseType\": \"CC-BY\",
    \"location\": \"Earth\"
}")

TX_HASH=$(extract_json_value "$REGISTER_RESPONSE" "txHash")
TOKEN_ID=$(extract_json_value "$REGISTER_RESPONSE" "tokenId")
STATUS=$(extract_json_value "$REGISTER_RESPONSE" "status")

if [ -z "$TX_HASH" ]; then
    print_error "Registration failed: $REGISTER_RESPONSE"
    exit 1
fi
print_success "Registration successful, transaction hash: $TX_HASH"
print_info "Token ID: $TOKEN_ID"

print_info "Sleep 10s to let blockchain become stable"
sleep 10

# ------------------------
# Set license terms
# ------------------------
print_info "Setting license terms..."
TERMS_RESPONSE=$(curl -s -X POST "$HOST/api/license/terms" \
  -H "Content-Type: application/json" \
  -d "{
    \"owner\": \"$LICENSOR\",
    \"tokenId\": $TOKEN_ID,
    \"scope\": \"$SCOPE\",
    \"price\": \"$PRICE\",
    \"duration\": $DURATION,
    \"transferable\": $TRANSFERABLE,
    \"legalTerms\": \"$LEGAL_TERMS\"
}")

TX_TERMS_HASH=$(extract_json_value "$TERMS_RESPONSE" "txHash")
if [ -z "$TX_TERMS_HASH" ]; then
    print_error "Failed to set license terms: $TERMS_RESPONSE"
    exit 1
fi
print_success "License terms set successfully: $TX_TERMS_HASH"

print_info "Sleep 10s to let blockchain become stable"
sleep 10

# ------------------------
# Purchase license
# ------------------------
print_info "Purchasing license..."
PURCHASE_RESPONSE=$(curl -s -X POST "$HOST/api/license/purchase" \
  -H "Content-Type: application/json" \
  -d "{
    \"tokenId\": $TOKEN_ID,
    \"scope\": \"$SCOPE\",
    \"owner\": \"$LICENSOR\",
    \"buyer\": \"$LICENSEE\"
}")
PURCHASE_TX_HASH=$(extract_json_value "$PURCHASE_RESPONSE" "txHash")
LICENSE_ID=$(extract_json_value "$PURCHASE_RESPONSE" "licenseId")

print_info "Purchase TX Hash: $PURCHASE_TX_HASH"

if [ -z "$PURCHASE_TX_HASH" ]; then
    print_error "Failed to purchase license: $PURCHASE_RESPONSE"
    exit 1
fi
print_success "License purchased successfully: $PURCHASE_TX_HASH"
print_info "License ID: $LICENSE_ID"

# ------------------------
# Verify license validity
# ------------------------
print_info "Verifying license validity..."
VALIDATE_RESPONSE=$(curl -s "$HOST/api/license/validate?user=$LICENSEE&tokenId=$TOKEN_ID&scope=$SCOPE")
VALID=$(echo "$VALIDATE_RESPONSE" | grep -oP '(?<="valid":)[^,}]*')

if [ "$VALID" = "true" ]; then
    print_success "License verification successful: $LICENSEE has $SCOPE license for tokenId=$TOKEN_ID"
else
    print_error "License verification failed: $VALIDATE_RESPONSE"
fi

# ------------------------
# Query ETH price
# ------------------------
print_info "Querying ETH price (AUD)..."
ORACLE_RESPONSE=$(curl -s "$HOST/api/oracle/price?currency=AUD")
AUD_PRICE=$(extract_json_value "$ORACLE_RESPONSE" "price")
if [ -n "$AUD_PRICE" ]; then
    print_success "1 ETH ≈ $AUD_PRICE AUD"
else
    print_error "Failed to get price: $ORACLE_RESPONSE"
fi

# ------------------------
# Completed
# ------------------------
echo
print_success "All tests completed!"
print_info "CID: $CID"
print_info "Token ID: $TOKEN_ID"
print_info "License ID: $LICENSE_ID"
print_info "Registration transaction: https://sepolia.etherscan.io/tx/$TX_HASH"
print_info "Terms transaction: https://sepolia.etherscan.io/tx/$TX_TERMS_HASH"
print_info "Purchase transaction: https://sepolia.etherscan.io/tx/$PURCHASE_TX_HASH"