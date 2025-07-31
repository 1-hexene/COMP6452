
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
      title: 'Blockchain API',
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
const ScopeEnum = {
  Display: 0,
  Print: 1,
  CommercialWeb: 2,
  NFTRemix: 3,
  SocialMedia: 4,
  ResaleRights: 5
};

const python_process_path = process.env.PYTHON_PATH;
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

function parseEventFromReceipt(receipt, contractInterface, eventName) {
    for (const log of receipt.logs) {
        try {
            const parsed = contractInterface.parseLog(log);
            if (parsed && parsed.name === eventName) {
                return parsed.args;
            }
        } catch (e) {
            console.error(`Failed to parse log: ${log.topics} - ${e.message}`);
        }
    }
    return null;
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
        const similarList = await querySimilarImages(tempPath, 5, 0.6); 
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
 *     responses:
 *       200:
 *         description: Registration result
 */
app.post("/api/ip/register", async (req, res) => {
    try {
        const { author, filename, description, cid, licenseType, location } = req.body;
        
        if (!ethers.isAddress(author)) {
            throw new Error(`Invalid author address: ${author}`);
        }
        
        console.log('Registering IP with params:', {
            author, filename, description, cid, licenseType, location
        });
        
        const timestamp = Math.floor(Date.now()/1000).toString();
        
        const gasEstimate = await ipRegistry.registerIP.estimateGas(
            author, filename, timestamp, description, cid, licenseType, location
        );
        console.log('Gas estimate:', gasEstimate.toString());
        
        const tx = await ipRegistry.registerIP(
            author, filename, timestamp, description, cid, licenseType, location,
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
                const eventArgs = parseEventFromReceipt(receipt, ipRegistry.interface, 'LicenseCreated');
                const tokenId = eventArgs ? eventArgs.licenseId.toString() : null;
                res.json({ 
                    txHash: receipt.hash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString(),
                    status: 'success',
                    url: 'https://sepolia.etherscan.io/tx/' + receipt.hash,
                    tokenId: tokenId
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

async function convertWeitoAUD(weiPrice) {
    const fx_rate = await oracle.convert(1, "ETH", "AUD");
    if (fx_rate === 0n) {
        throw new Error("ETH price is zero, cannot convert wei to AUD");
    }
    return weiPrice * BigInt(fx_rate) / BigInt(1e18);
}


async function isValidScope(tokenId, scope) {
    try {
        if (!(scope in ScopeEnum)) {
            return res.status(400).json({ error: "Invalid scope" });
        }
        const terms = await licenseManager.getLicenseTerms(Number(tokenId), ScopeEnum[scope]);
        const price = await convertWeitoAUD(terms.price);
        console.log(`License terms for token ${tokenId} and scope ${scope}:`, terms);
        return {
            tokenId: Number(tokenId),
            scope: terms.scope,
            price: ethers.formatEther(terms.price),
            duration: terms.duration.toString(),
            transferable: terms.transferable,
            legalTerms: terms.legalTerms,
            priceInAud: price.toString()
        };
    } catch (e) {
        console.error("Error checking license terms:", e);
        return {};
    }
}
/**
 * @swagger
 * /api/license/terms:
 *   post:
 *     summary: Set terms for a license
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               owner:
 *                 type: string
 *               tokenId:
 *                 type: integer
 *               scope:
 *                 type: string
 *               price:
 *                 type: string
 *               duration:
 *                 type: integer
 *               transferable:
 *                 type: boolean
 *               legalTerms:
 *                 type: string
 *     responses:
 *       200:
 *         description: License terms set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 txHash:
 *                   type: string
 */
app.post("/api/license/terms", async (req, res) => {
    const { owner, tokenId, scope, price, duration, transferable, legalTerms } = req.body;
    console.log("tokenId = ",tokenId);
    console.log("scope = ", scope);
    if (!tokenId || !scope) {
        return res.status(400).json({ error: "tokenId and scope are required" });
    }
    if (!(scope in ScopeEnum)) {
        return res.status(400).json({ error: "Invalid scope" });
    }
    const tx = await licenseManager.setLicenseTerms(
        owner, tokenId, ScopeEnum[scope], price, duration, transferable, legalTerms
    )
    res.json({ txHash: tx.hash });
});



/**
 * @swagger
 * /api/license/terms:
 *   get:
 *     summary: Retrieve terms for a specific license
 *     parameters:
 *       - in: query
 *         name: tokenId
 *         schema:
 *           type: integer
 *         required: true
 *         description: The ID of the token
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *         required: true
 *         description: The scope of the license
 *     responses:
 *       200:
 *         description: License terms retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tokenId:
 *                   type: integer
 *                 scope:
 *                   type: string
 *                 price:
 *                   type: string
 *                 duration:
 *                   type: integer
 *                 transferable:
 *                   type: boolean
 *                 legalTerms:
 *                   type: string
 *                 priceInAud:
 *                   type: string
 *       400:
 *         description: Invalid scope or parameters
 *       404:
 *         description: License terms not found
 *       500:
 *         description: Server error
 */
app.get("/api/license/terms", async (req, res) => {
    const { tokenId, scope } = req.query;
    if (!tokenId || !scope) {
        return res.status(400).json({ error: "tokenId and scope are required" });
    }
    if (!(scope in ScopeEnum)) {
        return res.status(400).json({ error: "Invalid scope" });
    }
    const terms = await isValidScope(tokenId, scope);
    if (Object.keys(terms).length === 0) {
        return res.status(404).json({ error: "License Terms not found" });
    }
    res.json(terms);
});
/**
 * @swagger
 * /api/license/purchase:
 *   post:
 *     summary: Purchase a license for a specific work
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tokenId:
 *                 type: integer
 *               scope:
 *                 type: string
 *               owner:
 *                 type: string
 *               buyer:
 *                 type: string
 *     responses:
 *       200:
 *         description: License purchase result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 txHash:
 *                   type: string
 */
app.post("/api/license/purchase", async (req, res) => {
    try {
        const { tokenId, scope, owner, buyer } = req.body;
        if (!ethers.isAddress(owner)) return res.status(400).json({ error: "Invalid owner address" });
        if (!ethers.isAddress(buyer)) return res.status(400).json({ error: "Invalid buyer address" });
        if (!(scope in ScopeEnum)) return res.status(400).json({ error: "Invalid scope" });
        const terms = await isValidScope(tokenId, scope);
        if (Object.keys(terms).length === 0) {
            return res.status(404).json({ error: "License Terms not for sale" });
        }
        const price = terms.price;
        if (price === 0n) return res.status(400).json({ error: "not for sale" });
        const tx = await licenseManager.purchaseLicense(
            tokenId, ScopeEnum[scope], owner, buyer
        );
        const receipt = await tx.wait();
        const args = parseEventFromReceipt(receipt, licenseManager.interface, 'LicensePurchased');
        if (!args) {
            return res.status(500).json({ error: "Purchase event not found in transaction receipt" });
        }
        const licenseId = args.licenseId.toString();
        res.json({ txHash: tx.hash, licenseId, tokenId: args.tokenId.toString(), price: price.toString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



/**
 * @swagger
 * /api/license/validate:
 *   get:
 *     summary: Validate if a user has a valid license for a specific token and scope
 *     parameters:
 *       - in: query
 *         name: user
 *         schema:
 *           type: string
 *         required: true
 *         description: The address of the user
 *       - in: query
 *         name: tokenId
 *         schema:
 *           type: integer
 *         required: true
 *         description: The ID of the token
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *         required: true
 *         description: The scope of the license
 *     responses:
 *       200:
 *         description: Validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *       400:
 *         description: Invalid scope or parameters
 *       500:
 *         description: Server error
 */
app.get("/api/license/validate", async (req, res) => {
    try {
        const { user, tokenId, scope } = req.query;
        if (!(scope in ScopeEnum)) return res.status(400).json({ error: "Invalid scope" });
        const valid = await licenseManager.hasValidLicense(user, tokenId, ScopeEnum[scope]);
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
 *         description: Price in the specified currency
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

/**
 * @swagger
 * /api/license/transfer:
 *   post:
 *     summary: Transfer a license to a new licensee
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               licenseId:
 *                 type: string
 *                 description: The ID of the license to transfer
 *               newLicensee:
 *                 type: string
 *                 description: The address of the new licensee
 *               oldLicensee:
 *                 type: string
 *                 description: The address of the old licensee
 *     responses:
 *       200:
 *         description: License transferred successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 txHash:
 *                   type: string
 *                 oldLicenseId:
 *                   type: string
 *                 newLicensee:
 *                   type: string
 *       400:
 *         description: Invalid new licensee address
 *       500:
 *         description: Server error
 */
app.post('/api/license/transfer', async (req, res) => {
    try {
        const { licenseId, newLicensee, oldLicensee } = req.body;
        if (!ethers.isAddress(newLicensee)) return res.status(400).json({ error: 'Invalid new licensee address' });
        const tx = await licenseManager.transferLicense(licenseId, newLicensee, oldLicensee);
        const receipt = await tx.wait();
        const args = parseEventFromReceipt(receipt, licenseManager.interface, 'LicenseTransferred');
        if (!args) {
            return res.status(500).json({ error: 'Transfer event not found in transaction receipt' });
        }
        res.json({ txHash: tx.hash, newLicenseId: args.newLicenseId.toString(), oldLicenseId: licenseId });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * @swagger
 * /api/license/revoke:
 *   post:
 *     summary: Revoke a license
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               licenseId:
 *                 type: string
 *                 description: The ID of the license to revoke
 *     responses:
 *       200:
 *         description: License revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 txHash:
 *                   type: string
 *       500:
 *         description: Server error
 */
app.post('/api/license/revoke', async (req, res) => {
    try {
        const { licenseId } = req.body;
        const tx = await licenseManager.revokeLicense(licenseId);
        await tx.wait();
        res.json({ txHash: tx.hash });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


/**
 * @swagger
 * /api/license/history:
 *   get:
 *     summary: Get the transfer history of a license
 *     parameters:
 *       - in: query
 *         name: licenseId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the license to retrieve history for
 *     responses:
 *       200:
 *         description: Transfer history of the license
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 history:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       from:
 *                         type: string
 *                       to:
 *                         type: string
 *                       timestamp:
 *                         type: integer
 */
app.get('/api/license/history', async (req, res) => {
    try {
        const { licenseId } = req.query;
        const history = await licenseManager.getTransferHistory(licenseId);
        console.log('Transfer history for license:', licenseId, history);
        // Convert history to a more serializable format
        // History is a array of bigint, so we need to convert it to a more readable format
        if (history.length === 0) {
            return res.json({ history: [] });
        }
        // return a list of int, i.e. [1,2,3]
        // Convert to [1, 2,3] format
        console.log('Transfer history:', history);
        const formattedHistory = history.map((item) => {
            return item.toString();
        });
        
        res.json({ history: formattedHistory });
    } catch (e) {
        res.status(200).json({ history: [] });
    }
});


/**
 * @swagger
 * /api/license/{id}:
 *   get:
 *     summary: Retrieve details of a specific license by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the license to retrieve
 *     responses:
 *       200:
 *         description: Details of the license
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 licensor:
 *                   type: string
 *                 licensee:
 *                   type: string
 *                 price:
 *                   type: string
 *                 metadataCID:
 *                   type: string
 *                 isActive:
 *                   type: boolean
 *                 transferable:
 *                   type: boolean
 *       404:
 *         description: License not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
app.get('/api/license/:id', async (req, res) => {
    try {
        const license = await licenseManager.getLicense(req.params.id);
        if (!license) {
            return res.status(404).json({ error: 'License not found' });
        }
        console.log('License details:', license);
        console.log('License scope:', license.scope);
        const scope_str = Object.keys(ScopeEnum).find(key => Number(ScopeEnum[key]) === Number(license.scope));
        if (!scope_str) {
            return res.status(404).json({ error: 'Scope not found for license' });
        }
        console.log('License scope:', scope_str);
        res.json({
            id: license.tokenId.toString(),
            licensor: license.licensor,
            licensee: license.licensee,
            scope: scope_str,
            beginTimestamp: license.beginTimestamp.toString(),
            endTimestamp: license.endTimestamp.toString(),
            isActive: license.isActive,
        });
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