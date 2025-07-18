import express from "express";
import multer from "multer";
import * as fs from "fs";
import path from "path";
import dotenv from "dotenv";
import pinataSDK from '@pinata/sdk';
import { ethers } from "ethers";

dotenv.config();
const app = express();
app.use(express.json());

//--- Pinata相关 ---
const pinata = new pinataSDK({
    pinataApiKey: process.env.PINATA_API_KEY,
    pinataSecretApiKey: process.env.PINATA_API_SECRET,
});
const upload = multer({ dest: 'uploads/' });

//--- ethers与合约实例 ---
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
import ipRegistryABI from "./abi/IPRegistry.json" assert { type: "json" };
import licenseManagerABI from "./abi/LicenseManager.json" assert { type: "json" };
import oracleABI from "./abi/SimpleOracle.json" assert { type: "json" };
const ipRegistry = new ethers.Contract(process.env.IPREGISTRY_ADDRESS, ipRegistryABI, wallet);
const licenseManager = new ethers.Contract(process.env.LICENSEMANAGER_ADDRESS, licenseManagerABI, wallet);
const oracle = new ethers.Contract(process.env.ORACLE_ADDRESS, oracleABI, wallet);

//--- 1. 上传文件到IPFS（Pinata）---
app.post("/api/ipfs/upload", upload.single("file"), async (req, res) => {
    try {
        const { originalname, path: tempPath } = req.file;
        const readableStream = fs.createReadStream(tempPath);
        const options = {
            pinataMetadata: { name: originalname }
        };
        const { IpfsHash } = await pinata.pinFileToIPFS(readableStream, options);
        fs.unlinkSync(tempPath);
        res.json({ cid: IpfsHash, url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

//--- 2. 上链注册作品(NFT+元数据) ---
app.post("/api/ip/register", async (req, res) => {
    try {
        const { author, filename, description, cid, licenseType, location, isCommercial } = req.body;
        const timestamp = Math.floor(Date.now()/1000);
        const tx = await ipRegistry.registerIP(
            author, filename, timestamp, description, cid, licenseType, location, isCommercial === "true"
        );
        const receipt = await tx.wait();
        res.json({ txHash: receipt.transactionHash });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

//--- 3. 创建/授权作品 ---
app.post("/api/license/create", async (req, res) => {
    try {
        const { licensor, licensee, price, scope, terms, cid, transferable, beginDate, endDate } = req.body;
        const tx = await licenseManager.createLicense(
            licensor, licensee,
            ethers.parseEther(price), // 以太币金额
            scope, terms, cid,
            transferable === "true", Number(beginDate), Number(endDate)
        );
        const receipt = await tx.wait();
        res.json({ txHash: receipt.transactionHash });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

//--- 4. 查询账户对作品授权有效性 ---
app.get("/api/license/validate", async (req, res) => {
    try {
        const { user, cid } = req.query;
        const valid = await licenseManager.hasValidLicense(user, cid);
        res.json({ valid });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

//--- 5. Oracle合约查询价格 ---
app.get("/api/oracle/price", async (req, res) => {
    try {
        const { currency } = req.query;
        const price = await oracle.getPrice(currency); // 返回int256
        res.json({ price: price.toString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running at <http://localhost>:${PORT}`);
});
