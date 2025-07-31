#!/bin/bash

HOST="http://localhost:3001"
FILE="./testfile.jpg"

LICENSOR="0x8829bACc3AA3cB48f149143746BE49C62cA0bE0B"
BUYER="0x871f1B7B495E9C8500272699eA5423Ef1Dfe73Cb"

SCOPE="CommercialWeb"
LICENSE_TYPE="CC-BY"
PRICE="10000000000000000"  # 0.01 ETH in wei
DURATION=31536000  # 1 year
TRANSFERABLE=true
TERMS="non-exclusive"
CURRENCY="AUD"

print_success() { echo -e "\033[32m✅ $1\033[0m"; }
print_error()   { echo -e "\033[31m❌ $1\033[0m"; }
print_info()    { echo -e "\033[34mℹ️  $1\033[0m"; }

extract_json_value() {
    echo "$1" | grep -oP "(?<=\"$2\":\")[^\"]*"
}

extract_json_number() {
    echo "$1" | grep -oP "(?<=\"$2\":)[0-9]+"
}

# ------------------------
# 1. 上传文件到 IPFS
# ------------------------
print_info "上传文件到 IPFS..."
UPLOAD_RESPONSE=$(curl -s -X POST "$HOST/api/ipfs/upload" \
  -F "file=@$FILE")

CID=$(extract_json_value "$UPLOAD_RESPONSE" "cid")
if [ -z "$CID" ]; then
    print_error "上传失败: $UPLOAD_RESPONSE"
    exit 1
fi
print_success "文件上传成功，CID: $CID"

# ------------------------
# 2. 注册作品
# ------------------------
print_info "注册作品上链..."
REGISTER_RESPONSE=$(curl -s -X POST "$HOST/api/ip/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"author\": \"$LICENSOR\",
    \"filename\": \"testfile.jpg\",
    \"description\": \"Test upload\",
    \"cid\": \"$CID\",
    \"licenseType\": \"$LICENSE_TYPE\",
    \"location\": \"Earth\"
  }")

TX_HASH=$(extract_json_value "$REGISTER_RESPONSE" "txHash")
TOKEN_ID=$(extract_json_value "$REGISTER_RESPONSE" "tokenId")

if [ -z "$TX_HASH" ]; then
    print_error "作品注册失败: $REGISTER_RESPONSE"
    exit 1
fi
print_success "注册成功，交易哈希: $TX_HASH, TokenID: $TOKEN_ID"

# ------------------------
# 3. 设置授权条款
# ------------------------
print_info "设置授权条款..."

TERMS_RESPONSE=$(curl -s -X POST "$HOST/api/license/terms" \
  -H "Content-Type: application/json" \
  -d "{
    \"owner\": \"$LICENSOR\",
    \"tokenId\": $TOKEN_ID,
    \"scope\": \"$SCOPE\",
    \"price\": \"$PRICE\",
    \"duration\": $DURATION,
    \"transferable\": $TRANSFERABLE,
    \"legalTerms\": \"$TERMS\"
  }")

if echo "$TERMS_RESPONSE" | grep -q "error"; then
    print_error "设置授权条款失败: $TERMS_RESPONSE"
    exit 1
fi

print_success "授权条款设置成功"

# ------------------------
# 4. 购买授权
# ------------------------
print_info "购买授权许可..."

PURCHASE_RESPONSE=$(curl -s -X POST "$HOST/api/license/purchase" \
  -H "Content-Type: application/json" \
  -d "{
    \"tokenId\": $TOKEN_ID,
    \"scope\": \"$SCOPE\",
    \"owner\": \"$LICENSOR\",
    \"buyer\": \"$BUYER\"
  }")

LICENSE_TX=$(extract_json_value "$PURCHASE_RESPONSE" "txHash")
if [ -z "$LICENSE_TX" ]; then
    print_error "购买失败: $PURCHASE_RESPONSE"
    exit 1
fi
print_success "购买成功，交易哈希: $LICENSE_TX"

# ------------------------
# 5. 验证授权许可
# ------------------------
print_info "验证授权许可..."

VALIDATE_RESPONSE=$(curl -s "$HOST/api/license/validate?user=$BUYER&tokenId=$TOKEN_ID&scope=$SCOPE")
VALID=$(echo "$VALIDATE_RESPONSE" | grep -oP '"valid":\s*\K(true|false)')

if [ "$VALID" = "true" ]; then
    print_success "验证成功，$BUYER 对 Token $TOKEN_ID 在 $SCOPE 拥有授权"
else
    print_error "验证失败，用户无有效授权"
fi

# ------------------------
# 6. 查询币价
# ------------------------
print_info "查询 $CURRENCY 价格..."
ORACLE_RESPONSE=$(curl -s "$HOST/api/oracle/price?currency=$CURRENCY")
PRICE_IN_AUD=$(extract_json_value "$ORACLE_RESPONSE" "price")
print_success "$CURRENCY 当前价格: $PRICE_IN_AUD"

# ------------------------
# 总结
# ------------------------
echo
echo "========== 测试总结 =========="
print_info "CID: $CID"
print_info "TokenID: $TOKEN_ID"
print_info "注册交易: https://sepolia.etherscan.io/tx/$TX_HASH"
print_info "许可交易: https://sepolia.etherscan.io/tx/$LICENSE_TX"
print_success "所有步骤执行完毕 🎉"
