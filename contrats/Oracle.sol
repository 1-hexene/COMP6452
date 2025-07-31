// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract SimpleOracle {
    mapping(string => AggregatorV3Interface) private priceFeeds;
    address public owner;

    string constant ETH = "ETH";
    string constant AUD = "AUD";

    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    modifier onlySupportedCurrency(string memory currency) {
        require(priceFeeds[currency] != AggregatorV3Interface(address(0)), "Unsupported currency");
        _;
    }


    constructor() {
        owner = msg.sender;
        priceFeeds[ETH] = AggregatorV3Interface(0x694AA1769357215DE4FAC081bf1f309aDC325306); // ETH/USD
        priceFeeds[AUD] = AggregatorV3Interface(0xB0C712f98daE15264c8E26132BCC91C40aD4d5F9); // AUD/USD
    }

    function updatePriceFeed(string memory currency, address feedAddress) public onlyOwner {
        require(feedAddress != address(0), "Invalid feed address");
        priceFeeds[currency] = AggregatorV3Interface(feedAddress);
    }

    function getPrice(string memory currency) public onlySupportedCurrency(currency) view returns (int256) {
        AggregatorV3Interface feed = priceFeeds[currency];
        require(address(feed) != address(0), "Unsupported currency");
        (, int256 price, , , ) = feed.latestRoundData();
        return price;
    }

    function convert(
        uint256 amount,
        string memory fromCurrency,
        string memory toCurrency
    ) public onlySupportedCurrency(fromCurrency) onlySupportedCurrency(toCurrency) view returns (uint256) {
        int256 fromPrice = getPrice(fromCurrency);
        int256 toPrice = getPrice(toCurrency);

        require(fromPrice > 0 && toPrice > 0, "Invalid price");

        uint256 result = (amount * uint256(fromPrice) * 1e10) / uint256(toPrice);
        return result;
    }
}