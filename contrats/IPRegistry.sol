// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.9.3/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract IPRegistry is ERC721URIStorage {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIdCounter;

    address public manager;

    constructor() ERC721("IPRegistry", "IPR") {
        manager = msg.sender;
    }

    modifier onlyManager() {
        require(msg.sender == manager, "Only manager");
        _;
    }

    // 作品结构体
    struct IPData {
        string imageName;
        string timestamp;
        string description;
        string ipfsCID;
        string licenseType;
        string region;
        bool isCommercial;
    }

    mapping(uint => IPData) private ipRecords; // tokenId => 作品数据
    // 用户地址 => 他们拥有的 tokenId 列表
    mapping(address => uint[]) private _ownedTokens;

    // 注册作品并铸造 NFT
    function registerIP(
        address to,
        string memory imageName,
        string memory timestamp,
        string memory description,
        string memory ipfsCID,
        string memory licenseType,
        string memory region,
        bool isCommercial
    ) public onlyManager returns (uint) {
        uint tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();

        // 铸造 NFT
        _mint(to, tokenId);
        _setTokenURI(tokenId, ipfsCID); // 选填：将 CID 作为 metadata URI

        ipRecords[tokenId] = IPData(
            imageName,
            timestamp,
            description,
            ipfsCID,
            licenseType,
            region,
            isCommercial
        );
        _ownedTokens[to].push(tokenId); // ✅ 记录作品归属

        return tokenId;
    }

    // 查询某个 token 的作品信息
    function getIPData(uint tokenId) public view returns (
        string memory imageName,
        string memory timestamp,
        string memory description,
        string memory ipfsCID,
        string memory licenseType,
        string memory region,
        bool isCommercial
    ) {
        require(_exists(tokenId), "Token not exist");

        IPData memory data = ipRecords[tokenId];
        return (
            data.imageName,
            data.timestamp,
            data.description,
            data.ipfsCID,
            data.licenseType,
            data.region,
            data.isCommercial
        );
    }

    // 查询某用户拥有的作品 ID 列表
    function getUserWorks(address user) public view returns (uint[] memory) {
        return _ownedTokens[user];
    }

    function getUserWorkCount(address user) public view returns (uint) {
        return _ownedTokens[user].length;
    }

    
}