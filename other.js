
/**
 * @swagger
 * /api/license/all:
 *   get:
 *     summary: Retrieve all licenses with details
 *     responses:
 *       200:
 *         description: List of all licenses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 licenses:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       licensor:
 *                         type: string
 *                       licensee:
 *                         type: string
 *                       priceEth:
 *                         type: string
 *                       priceAUD:
 *                         type: number
 *                       cid:
 *                         type: string
 *                       active:
 *                         type: boolean
 *                       transferable:
 *                         type: boolean
 */
app.get('/api/license/all', async (req, res) => {
    try {
        const licenseIds = await licenseManager.getAllLicensesId();
        const audRate = await oracle.getPrice('AUD'); // 假设返回 1 ETH = N AUD
        const licenses = await Promise.all(
            licenseIds.map(async (id) => {
                const l = await licenseManager.getLicense(id);
                const priceAUD = ethers.formatEther(l.price) * parseFloat(audRate.toString());
                return {
                    id,
                    licensor: l.licensor,
                    licensee: l.licensee,
                    priceEth: ethers.formatEther(l.price),
                    priceAUD,
                    cid: l.metadataCID,
                    active: l.isActive,
                    transferable: l.transferable
                };
            })
        );
        res.json({ licenses });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



/**
 * @swagger
 * /api/list/uploads:
 *   get:
 *     summary: List uploaded images for a specific address
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         required: true
 *         description: The address to filter uploads
 *     responses:
 *       200:
 *         description: List of uploaded images
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uploads:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       imgId:
 *                         type: string
 *                       cid:
 *                         type: string
 */
app.get('/api/ipfs/list', (req, res) => {
    const { address } = req.query;
    const cidMap = fs.existsSync(cidmap_path) ? JSON.parse(fs.readFileSync(cidmap_path)) : {};
    const uploads = Object.entries(cidMap)
        .filter(([_, cid]) => cid.startsWith(address.slice(2, 8)))
        .map(([imgId, cid]) => ({ imgId, cid }));
    res.json({ uploads });
});



/**
 * @swagger
 * /api/works/list:
 *   get:
 *     summary: Retrieve a list of all works with details
 *     responses:
 *       200:
 *         description: List of all works
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 works:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       author:
 *                         type: string
 *                       filename:
 *                         type: string
 *                       description:
 *                         type: string
 *                       cid:
 *                         type: string
 *                       licenseType:
 *                         type: string
 *                       location:
 *                         type: string
 *                       isCommercial:
 *                         type: boolean
 */
app.get('/api/works/list', async (req, res) => {
    try {
        const works = await ipRegistry.getAllWorks();
        const worksDetails = await Promise.all(works.map(async (work) => {
            const details = await ipRegistry.getUserWorks(work);
            return {
                id: work,
                ...details
            };
        }));
        res.json({ works: worksDetails });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


/**
 * @swagger
 * /api/works/{id}:
 *   get:
 *     summary: Retrieve details of a specific work by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the work to retrieve
 *     responses:
 *       200:
 *         description: Details of the work
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 author:
 *                   type: string
 *                 filename:
 *                   type: string
 *                 description:
 *                   type: string
 *                 cid:
 *                   type: string
 *                 licenseType:
 *                   type: string
 *                 location:
 *                   type: string
 *                 isCommercial:
 *                   type: boolean
 *       404:
 *         description: Work not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
app.get('/api/works/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const workDetails = await ipRegistry.getIPData(id);
        if (!workDetails) {
            return res.status(404).json({ error: 'Work not found' });
        }
        res.json({ id, ...workDetails });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        res.json(license);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * @swagger
 * /api/license/user/{address}:
 *   get:
 *     summary: Retrieve all licenses associated with a specific user
 *     parameters:
 *       - in: path
 *         name: address
 *         schema:
 *           type: string
 *         required: true
 *         description: The address of the user
 *     responses:
 *       200:
 *         description: List of licenses associated with the user
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   licensor:
 *                     type: string
 *                   licensee:
 *                     type: string
 *                   price:
 *                     type: string
 *                   metadataCID:
 *                     type: string
 *                   isActive:
 *                     type: boolean
 *                   transferable:
 *                     type: boolean
 *       500:
 *         description: Server error
 */
app.get('/api/license/user/:address', async (req, res) => {
    try {
        const licenses = await licenseManager.getLicensesByLicensee(req.params.address);
        res.json(licenses);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * @swagger
 * /api/license/token/{tokenId}:
 *   get:
 *     summary: Retrieve all licenses associated with a specific token ID
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the token to retrieve licenses for
 *     responses:
 *       200:
 *         description: List of licenses associated with the token ID
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   licensor:
 *                     type: string
 *                   licensee:
 *                     type: string
 *                   price:
 *                     type: string
 *                   metadataCID:
 *                     type: string
 *                   isActive:
 *                     type: boolean
 *                   transferable:
 *                     type: boolean
 *       500:
 *         description: Server error
 */
app.get('/api/license/token/:tokenId', async (req, res) => {
    try {
        const licenses = await licenseManager.getLicensesByTokenId(req.params.tokenId);
        res.json(licenses);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});