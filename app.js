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
import ipRegistryABI from "./abi/IPRegistry.json" with { type: "json" };
import licenseManagerABI from "./abi/LicenseManager.json" with { type: "json" };
import oracleABI from "./abi/SimpleOracle.json" with { type: "json" };
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
        
        if (!ethers.isAddress(author)) {
            throw new Error(`Invalid author address: ${author}`);
        }
        
        console.log('Registering IP with params:', {
            author, filename, description, cid, licenseType, location, isCommercial
        });
        
        const timestamp = Math.floor(Date.now()/1000).toString();
        
        const gasEstimate = await ipRegistry.registerIP.estimateGas(
            author, filename, timestamp, description, cid, licenseType, location, isCommercial === "true"
        );
        console.log('Gas estimate:', gasEstimate.toString());
        
        const tx = await ipRegistry.registerIP(
            author, filename, timestamp, description, cid, licenseType, location, isCommercial === "true",
            { gasLimit: gasEstimate * 120n / 100n }
        );
        
        console.log('Transaction sent:', tx.hash);
        
        // 手动轮询交易状态
        async function waitForTransaction(txHash, maxAttempts = 60, interval = 5000) {
            for (let i = 0; i < maxAttempts; i++) {
                try {
                    console.log(`Checking transaction status, attempt ${i + 1}/${maxAttempts}`);
                    
                    const receipt = await provider.getTransactionReceipt(txHash);
                    
                    if (receipt) {
                        console.log('Transaction confirmed!');
                        console.log('Block number:', receipt.blockNumber);
                        console.log('Gas used:', receipt.gasUsed.toString());
                        console.log('Transaction hash:', receipt.hash);
                        console.log('Status:', receipt.status === 1 ? 'Success' : 'Failed');
                        return receipt;
                    }
                    
                    // 检查交易是否还在 mempool 中
                    const txDetails = await provider.getTransaction(txHash);
                    if (!txDetails) {
                        throw new Error('Transaction not found');
                    }
                    
                    console.log(`Transaction ${txHash} is still pending...`);
                } catch (error) {
                    console.log(`Error checking transaction: ${error.message}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, interval));
            }
            
            return null; // 超时
        }
        
        const receipt = await waitForTransaction(tx.hash);
        
        if (receipt) {
            if (receipt.status === 1) {
                res.json({ 
                    txHash: receipt.hash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString(),
                    status: 'success'
                });
            } else {
                res.status(500).json({ 
                    error: 'Transaction failed',
                    txHash: receipt.hash
                });
            }
        } else {
            // 超时但交易可能仍然成功
            res.json({ 
                txHash: tx.hash,
                status: 'timeout',
                message: 'Transaction confirmation timeout. Please check the blockchain explorer.',
                explorerUrl: `https://sepolia.etherscan.io/tx/${tx.hash}`
            });
        }
        
    } catch (e) {
        console.error('Registration error:', e);
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
        res.json({ txHash: receipt.hash });
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

// 在服务器启动时添加网络检查
async function checkNetwork() {
    try {
        const network = await provider.getNetwork();
        console.log('Connected to network:', network.name, 'Chain ID:', network.chainId);
        
        const balance = await provider.getBalance(wallet.address);
        console.log('Wallet balance:', ethers.formatEther(balance), 'ETH');
        
        // 检查合约是否存在
        const code = await provider.getCode(process.env.IPREGISTRY_ADDRESS);
        if (code === '0x') {
            console.error('Contract not found at address:', process.env.IPREGISTRY_ADDRESS);
        } else {
            console.log('Contract found, code length:', code.length);
        }
    } catch (error) {
        console.error('Network check failed:', error);
    }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
    console.log(`Server running at <http://localhost>:${PORT}`);
    await checkNetwork();
});
