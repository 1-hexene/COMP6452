
import express from "express";
import multer from "multer";
import * as fs from "fs";
import path from "path";
import dotenv from "dotenv";
import pinataSDK from '@pinata/sdk';
import { ethers } from "ethers";
import { spawn } from 'child_process';

// swagger相关
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());


const __filename = fileURLToPath(import.meta.url);
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'IPFS/Checker/Blockchain API',
      version: '1.0.0',
      description: 'API documentation for IPFS upload, image similarity, and blockchain registration.'
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local server' }
    ]
  },
  apis: [__filename],
};
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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

const python_process_path = "/home/shilong/miniconda3/envs/comp6733/bin/python";
const cidmap_path = "cidmap.json"
async function insertImageToDB(imgPath, threshold = 0.85) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn(python_process_path, ['checker.py', imgPath, '--insert', '--insert_threshold', threshold.toString()]);
        let stdout = '';
        let stderr = '';
        pythonProcess.stdout.on('data', (data) => { stdout += data; });
        pythonProcess.stderr.on('data', (data) => { stderr += data; });
        pythonProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    reject(new Error('Failed to parse checker output: ' + stdout));
                }
            } else {
                reject(new Error(stderr || 'Python process exited with code ' + code));
            }
        });
    });
}

function mapImgIdToCid(img_id, cid) {
    const cidMapPath = cidmap_path;
    let cidMap = {};
    if (fs.existsSync(cidMapPath)) {
        try {
            cidMap = JSON.parse(fs.readFileSync(cidMapPath, "utf-8"));
        } catch {}
    }
    cidMap[img_id] = cid;
    fs.writeFileSync(cidMapPath, JSON.stringify(cidMap, null, 2), "utf-8");
}

async function querySimilarImages(imgPath, n = 5, threshold = 0.7) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn(python_process_path, [
            'checker.py', imgPath, '--query', '--query_n', n.toString(), '--query_threshold', threshold.toString()
        ]);
        let stdout = '';
        let stderr = '';
        pythonProcess.stdout.on('data', (data) => { stdout += data; });
        pythonProcess.stderr.on('data', (data) => { stderr += data; });
        pythonProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result.results || []);
                } catch (e) {
                    reject(new Error('Failed to parse checker output: ' + stdout));
                }
            } else {
                reject(new Error(stderr || 'Python process exited with code ' + code));
            }
        });
    });
}

/**
 * @swagger
 * /api/ipfs/upload:
 *   post:
 *     summary: Upload an image to IPFS and check for duplicates
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Upload result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cid:
 *                   type: string
 *                 url:
 *                   type: string
 *                 duplicated:
 *                   type: boolean
 *                 img_id:
 *                   type: integer
 *                 similarity:
 *                   type: number
 */
app.post("/api/ipfs/upload", upload.single("file"), async (req, res) => {
    try {
        const { originalname, path: tempPath } = req.file;

        const similarList = await querySimilarImages(tempPath, 1, 0.95);
        if (similarList && similarList.length > 0 && similarList[0].similarity >= 0.95) {
            fs.unlinkSync(tempPath);
            return res.json({ duplicated: true, cid: similarList[0].cid, similarity: similarList[0].similarity,
                url: `https://gateway.pinata.cloud/ipfs/${similarList[0].cid}`
             });
        }

        const insertResult = await insertImageToDB(tempPath, 0.85);
        if (!insertResult || insertResult.status !== 'inserted') {
            fs.unlinkSync(tempPath);
            // If existing image is found, return its details, if cid is "Unknown CID",
            return res.json({ duplicated: true, cid: similarList[0].existing_img_cid, 
                similarity: similarList[0].similarity
            });
        }
        const img_id = insertResult.img_id;

        const readableStream = fs.createReadStream(tempPath);
        const options = {
            pinataMetadata: { name: originalname }
        };
        const { IpfsHash } = await pinata.pinFileToIPFS(readableStream, options);

        mapImgIdToCid(img_id, IpfsHash);

        fs.unlinkSync(tempPath);
        console.log({ cid: IpfsHash, url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}`, duplicated: false });

        res.json({ cid: IpfsHash, url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}`, duplicated: false });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * @swagger
 * /api/ipfs/similar:
 *   post:
 *     summary: Query similar images from IPFS
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: List of similar images
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       cid:
 *                         type: string
 *                       similarity:
 *                         type: number
 */
app.post("/api/ipfs/similar", upload.single("file"), async (req, res) => {
    try {
        const { path: tempPath } = req.file;
        const similarList = await querySimilarImages(tempPath, 5, 0); 
        fs.unlinkSync(tempPath);
        const results = (similarList || []).map(item => ({
            cid: item.cid,
            similarity: item.similarity,
            url: `https://gateway.pinata.cloud/ipfs/${item.cid}`
        }));
        res.json({ results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * @swagger
 * /api/ip/register:
 *   post:
 *     summary: Register intellectual property on the blockchain
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               author:
 *                 type: string
 *               filename:
 *                 type: string
 *               description:
 *                 type: string
 *               cid:
 *                 type: string
 *               licenseType:
 *                 type: string
 *               location:
 *                 type: string
 *               isCommercial:
 *                 type: string
 *     responses:
 *       200:
 *         description: Registration result
 */
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

/**
 * @swagger
 * /api/license/create:
 *   post:
 *     summary: Create a new license for an intellectual property
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               licensor:
 *                 type: string
 *               licensee:
 *                 type: string
 *               price:
 *                 type: string
 *               scope:
 *                 type: string
 *               terms:
 *                 type: string
 *               cid:
 *                 type: string
 *               transferable:
 *                 type: string
 *               beginDate:
 *                 type: integer
 *               endDate:
 *                 type: integer
 *     responses:
 *       200:
 *         description: License creation result
 */
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

/**
 * @swagger
 * /api/license/validate:
 *   get:
 *     summary: Query the validity of a user's license for a work
 *     parameters:
 *       - in: query
 *         name: user
 *         schema:
 *           type: string
 *       - in: query
 *         name: cid
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: License validity result
 */
app.get("/api/license/validate", async (req, res) => {
    try {
        const { user, cid } = req.query;
        const valid = await licenseManager.hasValidLicense(user, cid);
        res.json({ valid });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * @swagger
 * /api/oracle/price:
 *   get:
 *     summary: Get the price of a work in a specific currency
 *     parameters:
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 价格结果
 */
app.get("/api/oracle/price", async (req, res) => {
    try {
        const { currency } = req.query;
        const price = await oracle.getPrice(currency); // 返回int256
        res.json({ price: price.toString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function checkNetwork() {
    try {
        const network = await provider.getNetwork();
        console.log('Connected to network:', network.name, 'Chain ID:', network.chainId);
        
        const balance = await provider.getBalance(wallet.address);
        console.log('Wallet balance:', ethers.formatEther(balance), 'ETH');
        
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
    console.log('Checking network...');
    await checkNetwork();
    console.log('Network check completed.');
    console.log('API documentation available at http://localhost:3001/api-docs');
});
