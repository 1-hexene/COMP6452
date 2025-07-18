# COMP6452 Backend

[👉 中文版](ReadmeCN.md)

## General Info

* **Base URL**: `http://localhost:3001`
* **Content-Type**: `application/json` (except file upload)

---

## 1. Upload File to IPFS

**POST** `/api/ipfs/upload`

Uploads a file to IPFS via Pinata and returns the CID and access URL.

### Request (multipart/form-data)

| Field  | Type   | Description        |
| ------ | ------ | ------------------ |
| `file` | `File` | The file to upload |

### Response

```json
{
  "cid": "Qm...",
  "url": "https://gateway.pinata.cloud/ipfs/Qm..."
}
```

---

## 2. Register IP (On-chain)

**POST** `/api/ip/register`

Registers a piece of intellectual property (IP) to the blockchain via the IPRegistry contract.

### Request Body (application/json)

| Field          | Type                             | Description                            |
| -------------- | -------------------------------- | -------------------------------------- |
| `author`       | `string`                         | Author's address                       |
| `filename`     | `string`                         | File name                              |
| `description`  | `string`                         | Description of the work                |
| `cid`          | `string`                         | IPFS CID                               |
| `licenseType`  | `string`                         | License type                           |
| `location`     | `string`                         | Location or origin                     |
| `isCommercial` | `string` (`"true"` or `"false"`) | Whether the work is for commercial use |

### Response

```json
{
  "txHash": "0x..."
}
```

---

## 3. Create/Grant License

**POST** `/api/license/create`

Creates a license agreement using the LicenseManager smart contract.

### Request Body (application/json)

| Field          | Type                             | Description                          |
| -------------- | -------------------------------- | ------------------------------------ |
| `licensor`     | `string`                         | Licensor's address                   |
| `licensee`     | `string`                         | Licensee's address                   |
| `price`        | `string`                         | Price in ETH                         |
| `scope`        | `string`                         | Scope of the license                 |
| `terms`        | `string`                         | Additional terms                     |
| `cid`          | `string`                         | IPFS CID associated with the content |
| `transferable` | `string` (`"true"` or `"false"`) | Whether the license is transferable  |
| `beginDate`    | `number` (Unix timestamp)        | License start date                   |
| `endDate`      | `number` (Unix timestamp)        | License end date                     |

### Response

```json
{
  "txHash": "0x..."
}
```

---

## 4. Validate License

**GET** `/api/license/validate`

Checks whether a user holds a valid license for a specific CID.

### Query Parameters

| Parameter | Type     | Description  |
| --------- | -------- | ------------ |
| `user`    | `string` | User address |
| `cid`     | `string` | IPFS CID     |

### Response

```json
{
  "valid": true
}
```

---

## 5. Query Oracle Price

**GET** `/api/oracle/price`

Fetches the price of a currency from the Oracle smart contract.

### Query Parameters

| Parameter  | Type     | Description                          |
| ---------- | -------- | ------------------------------------ |
| `currency` | `string` | Currency symbol (e.g., `ETH`, `USD`) |

### Response

```json
{
  "price": "123456789"
}
```

---

## 6. Environment Variables (`.env`)

| Variable Name            | Description                     |
| ------------------------ | ------------------------------- |
| `PORT`                   | Server listening port           |
| `PINATA_API_KEY`         | Pinata API Key                  |
| `PINATA_API_SECRET`      | Pinata Secret Key               |
| `RPC_URL`                | Blockchain RPC endpoint         |
| `PRIVATE_KEY`            | Wallet private key              |
| `IPREGISTRY_ADDRESS`     | IPRegistry contract address     |
| `LICENSEMANAGER_ADDRESS` | LicenseManager contract address |
| `ORACLE_ADDRESS`         | Oracle contract address         |

---

Would you like this documentation exported as a **Swagger/OpenAPI spec** or a **Postman collection**? I can generate either for you.
