# COMP6452 后端

## 基础信息

* **Base URL**: `http://localhost:3001`
* **Content-Type**: `application/json`（除文件上传）

---

## 1. 上传文件到 IPFS

**POST** `/api/ipfs/upload`

将文件上传至 IPFS（通过 Pinata），返回 CID 和访问 URL。

### 请求 (multipart/form-data)

| 字段     | 类型     | 描述     |
| ------ | ------ | ------ |
| `file` | `File` | 要上传的文件 |

### 响应

```json
{
  "cid": "Qm...",
  "url": "https://gateway.pinata.cloud/ipfs/Qm..."
}
```

---

## 2. 注册作品信息（上链）

**POST** `/api/ip/register`

向 IPRegistry 合约注册一个作品，包括 CID、描述、作者信息等。

### 请求体（application/json）

| 字段             | 类型                               | 描述       |
| -------------- | -------------------------------- | -------- |
| `author`       | `string`                         | 作者地址     |
| `filename`     | `string`                         | 文件名      |
| `description`  | `string`                         | 作品描述     |
| `cid`          | `string`                         | IPFS CID |
| `licenseType`  | `string`                         | 许可证类型    |
| `location`     | `string`                         | 地理位置或来源地 |
| `isCommercial` | `string` (`"true"` or `"false"`) | 是否商用     |

### 响应

```json
{
  "txHash": "0x..."
}
```

---

## 3. 创建/授权许可（License）

**POST** `/api/license/create`

在 LicenseManager 合约中创建一份许可协议。

### 请求体（application/json）

| 字段             | 类型                               | 描述             |
| -------------- | -------------------------------- | -------------- |
| `licensor`     | `string`                         | 授权人地址          |
| `licensee`     | `string`                         | 被授权人地址         |
| `price`        | `string`                         | 授权价格（以 ETH 表示） |
| `scope`        | `string`                         | 授权范围           |
| `terms`        | `string`                         | 其他条款           |
| `cid`          | `string`                         | 关联内容的 IPFS CID |
| `transferable` | `string` (`"true"` or `"false"`) | 是否可转让          |
| `beginDate`    | `number` (Unix 时间戳)              | 生效时间           |
| `endDate`      | `number` (Unix 时间戳)              | 结束时间           |

### 响应

```json
{
  "txHash": "0x1145141919810"
}
```

---

## 4. 查询授权有效性

**GET** `/api/license/validate`

检查某用户对某 CID 的授权是否有效。

### 查询参数

| 参数     | 类型       | 描述       |
| ------ | -------- | -------- |
| `user` | `string` | 用户地址     |
| `cid`  | `string` | IPFS CID |

### 响应

```json
{
  "valid": true
}
```

---

## 5. 查询 Oracle 价格

**GET** `/api/oracle/price`

从 Oracle 合约中查询某种货币价格。

### 查询参数

| 参数         | 类型       | 描述                     |
| ---------- | -------- | ---------------------- |
| `currency` | `string` | 货币符号（如 `ETH`, `USD` 等） |

### 响应

```json
{
  "price": "114514"
}
```

---

## 💡 环境变量（`.env`）

| 变量名                      | 描述                  |
| ------------------------ | ------------------- |
| `PORT`                   | 服务监听端口              |
| `PINATA_API_KEY`         | Pinata API Key      |
| `PINATA_API_SECRET`      | Pinata Secret Key   |
| `RPC_URL`                | 区块链节点 RPC           |
| `PRIVATE_KEY`            | 钱包私钥                |
| `IPREGISTRY_ADDRESS`     | IPRegistry 合约地址     |
| `LICENSEMANAGER_ADDRESS` | LicenseManager 合约地址 |
| `ORACLE_ADDRESS`         | Oracle 合约地址         |

