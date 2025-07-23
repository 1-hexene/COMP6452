#!/bin/bash

# --------------
# 配置
# --------------

HOST="http://localhost:3001"
FILE="./testfile.jpg"  # 本地测试文件路径

# 钱包地址（必须为合法以太坊地址）
LICENSOR="0x8829bACc3AA3cB48f149143746BE49C62cA0bE0B"
LICENSEE="0x871f1B7B495E9C8500272699eA5423Ef1Dfe73Cb"

PRICE="0.01"
SCOPE="web"
TERMS="non-exclusive, 1 year"
TRANSFERABLE="true"
BEGIN_DATE=$(date +%s)
END_DATE=$((BEGIN_DATE + 31536000))  # 一年后
CURRENCY="ETH"

# 颜色输出函数
print_success() {
    echo -e "\033[32m✅ $1\033[0m"
}

print_error() {
    echo -e "\033[31m❌ $1\033[0m"
}

print_warning() {
    echo -e "\033[33m⚠️  $1\033[0m"
}

print_info() {
    echo -e "\033[34mℹ️  $1\033[0m"
}

# JSON 解析函数
extract_json_value() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -oP "(?<=\"$key\":\")[^\"]*" | head -1
}

extract_json_boolean() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -oP "(?<=\"$key\":)[^,}]*" | head -1
}

# --------------
# 上传文件到 IPFS
# --------------
echo "📤 上传文件到 IPFS..."

# 检查文件是否存在
if [ ! -f "$FILE" ]; then
    print_error "文件不存在: $FILE"
    exit 1
fi

UPLOAD_RESPONSE=$(curl -s -X POST "$HOST/api/ipfs/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@$FILE")

echo "响应: $UPLOAD_RESPONSE"

# 检查上传是否成功
if echo "$UPLOAD_RESPONSE" | grep -q "error"; then
    ERROR_MSG=$(extract_json_value "$UPLOAD_RESPONSE" "error")
    print_error "上传失败: $ERROR_MSG"
    exit 1
fi

CID=$(extract_json_value "$UPLOAD_RESPONSE" "cid")
if [ -z "$CID" ]; then
    print_error "上传失败，未获取到 CID"
    exit 1
fi

print_success "成功获取 CID: $CID"
IPFS_URL=$(extract_json_value "$UPLOAD_RESPONSE" "url")
print_info "IPFS URL: $IPFS_URL"

# --------------
# 注册作品（上链）
# --------------
echo
echo "📝 注册作品上链..."

REGISTER_RESPONSE=$(curl -s -X POST "$HOST/api/ip/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"author\": \"$LICENSOR\",
    \"filename\": \"testfile.png\",
    \"description\": \"Test NFT description\",
    \"cid\": \"$CID\",
    \"licenseType\": \"CC-BY\",
    \"location\": \"Earth\",
    \"isCommercial\": \"true\"
  }")

echo "响应: $REGISTER_RESPONSE"

# 检查注册是否成功
if echo "$REGISTER_RESPONSE" | grep -q "error"; then
    ERROR_MSG=$(extract_json_value "$REGISTER_RESPONSE" "error")
    print_error "作品注册失败: $ERROR_MSG"
    exit 1
fi

TX_HASH=$(extract_json_value "$REGISTER_RESPONSE" "txHash")
STATUS=$(extract_json_value "$REGISTER_RESPONSE" "status")
BLOCK_NUMBER=$(extract_json_value "$REGISTER_RESPONSE" "blockNumber")
GAS_USED=$(extract_json_value "$REGISTER_RESPONSE" "gasUsed")

if [ -z "$TX_HASH" ]; then
    print_error "作品注册失败，未获取到交易哈希"
    exit 1
fi

print_success "注册成功！"
print_info "交易哈希: $TX_HASH"
print_info "状态: $STATUS"

if [ -n "$BLOCK_NUMBER" ]; then
    print_info "区块号: $BLOCK_NUMBER"
fi

if [ -n "$GAS_USED" ]; then
    print_info "Gas 使用量: $GAS_USED"
fi

# 如果是 timeout 状态，提供区块浏览器链接
if [ "$STATUS" = "timeout" ]; then
    EXPLORER_URL=$(extract_json_value "$REGISTER_RESPONSE" "explorerUrl")
    print_warning "交易确认超时，但可能仍会成功"
    print_info "请在区块浏览器中查看: $EXPLORER_URL"
fi

# 如果交易还在等待确认，给用户一些时间
if [ "$STATUS" = "timeout" ] || [ "$STATUS" = "submitted" ]; then
    print_info "等待 30 秒让交易有更多时间确认..."
    sleep 30
fi

# --------------
# 创建授权许可
# --------------
echo
echo "📜 创建授权许可..."

LICENSE_RESPONSE=$(curl -s -X POST "$HOST/api/license/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"licensor\": \"$LICENSOR\",
    \"licensee\": \"$LICENSEE\",
    \"price\": \"$PRICE\",
    \"scope\": \"$SCOPE\",
    \"terms\": \"$TERMS\",
    \"cid\": \"$CID\",
    \"transferable\": \"$TRANSFERABLE\",
    \"beginDate\": $BEGIN_DATE,
    \"endDate\": $END_DATE
  }")

echo "响应: $LICENSE_RESPONSE"

# 检查许可创建是否成功
if echo "$LICENSE_RESPONSE" | grep -q "error"; then
    ERROR_MSG=$(extract_json_value "$LICENSE_RESPONSE" "error")
    print_error "创建许可失败: $ERROR_MSG"
else
    LICENSE_TX_HASH=$(extract_json_value "$LICENSE_RESPONSE" "txHash")
    LICENSE_STATUS=$(extract_json_value "$LICENSE_RESPONSE" "status")
    
    if [ -n "$LICENSE_TX_HASH" ]; then
        print_success "许可创建成功！"
        print_info "许可交易哈希: $LICENSE_TX_HASH"
        print_info "许可状态: $LICENSE_STATUS"
    else
        print_warning "许可响应格式异常"
    fi
fi

# --------------
# 验证许可有效性
# --------------
echo
echo "🔍 验证授权许可..."

VALIDATE_RESPONSE=$(curl -s "$HOST/api/license/validate?user=$LICENSEE&cid=$CID")
echo "响应: $VALIDATE_RESPONSE"

# 解析验证结果
if echo "$VALIDATE_RESPONSE" | grep -q "error"; then
    ERROR_MSG=$(extract_json_value "$VALIDATE_RESPONSE" "error")
    print_error "验证许可失败: $ERROR_MSG"
else
    VALID=$(extract_json_boolean "$VALIDATE_RESPONSE" "valid")
    if [ "$VALID" = "true" ]; then
        print_success "许可验证通过！用户 $LICENSEE 对作品 $CID 拥有有效许可"
    else
        print_warning "许可验证失败！用户 $LICENSEE 对作品 $CID 没有有效许可"
    fi
fi

# --------------
# 查询币价（Oracle）
# --------------
echo
echo "💰 查询币价（$CURRENCY）..."

ORACLE_RESPONSE=$(curl -s "$HOST/api/oracle/price?currency=$CURRENCY")
echo "响应: $ORACLE_RESPONSE"

# 解析币价结果
if echo "$ORACLE_RESPONSE" | grep -q "error"; then
    ERROR_MSG=$(extract_json_value "$ORACLE_RESPONSE" "error")
    print_error "查询币价失败: $ERROR_MSG"
else
    PRICE_VALUE=$(extract_json_value "$ORACLE_RESPONSE" "price")
    if [ -n "$PRICE_VALUE" ]; then
        print_success "当前 $CURRENCY 价格: $PRICE_VALUE"
    else
        print_warning "未能获取到价格信息"
    fi
fi

# --------------
# 总结
# --------------
echo
echo "=================== 测试总结 ==================="
print_info "IPFS CID: $CID"
print_info "注册交易: $TX_HASH"
if [ -n "$LICENSE_TX_HASH" ]; then
    print_info "许可交易: $LICENSE_TX_HASH"
fi
print_info "区块浏览器链接:"
print_info "  注册交易: https://sepolia.etherscan.io/tx/$TX_HASH"
if [ -n "$LICENSE_TX_HASH" ]; then
    print_info "  许可交易: https://sepolia.etherscan.io/tx/$LICENSE_TX_HASH"
fi
print_success "所有步骤已完成！"