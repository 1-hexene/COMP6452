pragma solidity ^0.8.0;

contract IPLiceseManager {
    struct Licese {
        address licensor;
        address licensee;
        uint256 price; 
        string scope;
        string terms;
        string metadataCID;
        bool transferable; 
        uint256 createdAt; 
        uint256 beginDate;
        uint256 endDate;
        bool isActive;
        uint256 transferedFrom;
        uint256 transferedTo;
    }

    address public manager; 
    mapping(uint256 => Licese) public licenses;
    mapping(address => uint256[]) public licensesByAddress;
    mapping(address => uint256[]) public licensorsByAddress;
    mapping (string => uint256[]) cidToLicenses; 
    uint256 public licenseId = 1;

    constructor() {
        manager = msg.sender; 
    }
    function createLicense (
        address _licensor,
        address _licensee, 
        uint256 _price,
        string memory _scope,
        string memory _terms,
        string memory _metadataCID,
        bool _transferable,
        uint256 _beginDate,
        uint256 _endDate
    ) public onlyManager returns (uint256) {
        require(_beginDate < _endDate, "Begin date must be before end date");
        require(_price > 0, "Price must be greater than zero");
        require(_licensor != address(0) && _licensee != address(0), "Licensor and Licensee must be valid addresses");
        bool isActive = (_beginDate <= block.timestamp && block.timestamp <= _endDate);
        Licese memory newLicense = Licese({
            licensor: _licensor,
            licensee: _licensee,
            price: _price,
            scope: _scope,
            terms: _terms,
            metadataCID: _metadataCID,
            transferable: _transferable,
            createdAt: block.timestamp,
            beginDate: _beginDate,
            endDate: _endDate,
            isActive: isActive,
            transferedFrom: 0,
            transferedTo: 0
        });
        licenses[licenseId] = newLicense;
        licensesByAddress[_licensee].push(licenseId);
        licensorsByAddress[_licensor].push(licenseId);
        cidToLicenses[_metadataCID].push(licenseId);
        licenseId++;
        return licenseId - 1; // Return the ID of the newly created license
        
    }

    function transferLicense(uint256 _licenseId, address _newLicensee) 
    public onlyManager onlyLicensee(_licenseId) onlyTransferable(_licenseId) onlyBeforeEndDate(_licenseId) returns (uint256)   {
        require(_newLicensee != address(0), "New licensee must be a valid address");
        // Create a new license for the new licensee, transferedFrom is set to the current license id 
        Licese storage license = licenses[_licenseId];
        Licese memory newLicense = Licese({
            licensor: license.licensor,
            licensee: _newLicensee,
            price: license.price,
            scope: license.scope,
            terms: license.terms,
            metadataCID: license.metadataCID,
            transferable: license.transferable,
            createdAt: block.timestamp,     
            beginDate: license.beginDate,
            endDate: license.endDate,
            isActive: license.isActive,
            transferedFrom: _licenseId,
            transferedTo: 0
        });
        uint256 newLicenseId = licenseId++;
        licenses[newLicenseId] = newLicense;
        licensesByAddress[_newLicensee].push(newLicenseId);
        licensorsByAddress[license.licensor].push(newLicenseId);
        license.isActive = false; 
        license.transferedTo = newLicenseId; 
        return newLicenseId; 

    }

    function revokeLicense(uint256 _licenseId) 
    public onlyManager onlyLicensor(_licenseId) returns (bool) {
        Licese storage license = licenses[_licenseId];
        require(license.isActive, "License is not active");
        license.isActive = false;
        return true;
    }

    function getLicense(uint256 _licenseId) public view returns (Licese memory) {
        return licenses[_licenseId];
    }

    function getLicensesByLicensee(address _licensee) public view returns (uint256[] memory) {
        return licensesByAddress[_licensee];
    }

    function getLicensesByLicensor(address _licensor) public view returns (uint256[] memory) {
        return licensorsByAddress[_licensor];
    }

    function getLicensesByCID(string memory _cid) public view returns (uint256[] memory) {
        return cidToLicenses[_cid];
    }
    function getAllLicensesId() public view returns (uint256[] memory) {
        uint256[] memory allLicenses = new uint256[](licenseId - 1);
        for (uint256 i = 1; i < licenseId; i++) {
            allLicenses[i - 1] = i;
        }
        return allLicenses;
    }

    function getActiveLicenses() public view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < licenseId; i++) {
            if (licenses[i].isActive) {
                count++;
            }
        }
        uint256[] memory activeLicenses = new uint256[](count);
        count = 0;
        for (uint256 i = 1; i < licenseId; i++) {
            if (licenses[i].isActive) {
                activeLicenses[count] = i;
                count++;
            }
        }
        return activeLicenses;
    }

    // function getActiveLicensesBy
    function getActiveLicensesBylicensee(address _address) public view returns (uint256[] memory) {
        uint256[] memory allLicenses = licensesByAddress[_address];
        uint256 count = 0;
        for (uint256 i = 0; i < allLicenses.length; i++) {
            if (licenses[allLicenses[i]].isActive) {
                count++;
            }
        }
        uint256[] memory activeLicenses = new uint256[](count);
        count = 0;
        for (uint256 i = 0; i < allLicenses.length; i++) {
            if (licenses[allLicenses[i]].isActive) {
                activeLicenses[count] = allLicenses[i];
                count++;
            }
        }
        return activeLicenses;
    }

    function getTransferHistory(uint256 _licenseId) public view returns (uint256[] memory) {

        if (licenses[_licenseId].transferedTo == 0 && licenses[_licenseId].transferedFrom == 0) {
            return new uint256[](0); // No transfer history if license is not active
        }
        Licese storage license = licenses[_licenseId];
        uint256 beforeCount = 0;
        uint256 currentId = _licenseId;
        while (currentId != 0 && licenses[currentId].transferedFrom != 0) {
            beforeCount++;
            currentId = licenses[currentId].transferedFrom;
        }
        uint256 originalId = currentId; // This is the original license
        uint256 afterCount = 0;
        currentId = _licenseId;
        while (currentId != 0 && licenses[currentId].transferedTo != 0) {
            afterCount++;
            currentId = licenses[currentId].transferedTo;
        }
        uint256[] memory history = new uint256[](beforeCount + afterCount + 1);
        currentId = originalId;
        for (uint256 i = 0; i < beforeCount; i++) {
            history[i] = currentId;
            currentId = licenses[currentId].transferedFrom;
        }
        history[beforeCount] = _licenseId; 
        currentId = licenses[_licenseId].transferedTo;
        for (uint256 i = beforeCount + 1; i < history.length; i++) {
            history[i] = currentId;
            currentId = licenses[currentId].transferedTo;
        }

        return history;
    }

    function isValidLicense(uint256 _licenseId) public view returns (bool) {
        return licenses[_licenseId].isActive && block.timestamp >= licenses[_licenseId].beginDate && block.timestamp <= licenses[_licenseId].endDate;
    }

    function hasValidLicense(address people, string memory cid) public view returns (bool) {
        uint256[] memory licenseIds = cidToLicenses[cid];
        for (uint256 i = 0; i < licenseIds.length; i++) {
            if (licenses[licenseIds[i]].licensee == people && isValidLicense(licenseIds[i])) {
                return true;
            }
        }
        // or people is any licensor of the license of that cid 
        for (uint256 i = 0; i < licenseIds.length; i++) {
            if (licenses[licenseIds[i]].licensor == people && isValidLicense(licenseIds[i])) {
                return true;
            }
        }
        return false;
    }

    function clearLicenses() public onlyManager {
        for (uint256 i = 1; i < licenseId; i++) {
            delete licenses[i];
        }
        licenseId = 1;
        for (uint256 i = 0; i < licensesByAddress[msg.sender].length; i++) {
            delete licensesByAddress[msg.sender][i];
        }
        for (uint256 i = 0; i < licensorsByAddress[msg.sender].length; i++) {
            delete licensorsByAddress[msg.sender][i];
        }
    }


    modifier onlyManager() {
        require(msg.sender == manager, "Only manager can call this function");
        _;
    }

    modifier onlyActiveLicenses(uint256 licenseId) {
        require(licenses[licenseId].isActive, "License is not active");
        _;
    }

    modifier onlyLicensor(uint256 licenseId) {
        require(licenses[licenseId].licensor == msg.sender, "Only licensor can call this function");
        _;
    }
    modifier onlyLicensee(uint256 licenseId) {
        require(licenses[licenseId].licensee == msg.sender, "Only licensee can call this function");
        _;
    }

    modifier onlyTransferable(uint256 licenseId) {
        require(licenses[licenseId].transferable, "License is not transferable");
        _;
    }

    modifier onlyBeforeEndDate(uint256 licenseId) {
        require(block.timestamp < licenses[licenseId].endDate, "License has expired");
        _;
    }
    modifier onlyAfterBeginDate(uint256 licenseId) {
        require(block.timestamp >= licenses[licenseId].beginDate, "License has not started yet");
        _;
    }


}