// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IFHEOracleBridgeCofhe.sol";

contract MockConsumerCofhe {
    IFHEOracleBridgeCofhe public oracle;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Consumer: not owner");
        _;
    }

    constructor(address _oracle) {
        oracle = IFHEOracleBridgeCofhe(_oracle);
        owner = msg.sender;
    }

    function isPriceAbove(uint256 feedId, InEuint128 calldata threshold) external returns (ebool) {
        euint128 currentPrice = oracle.getEncryptedPrice(feedId);
        euint128 encThreshold = FHE.asEuint128(threshold);
        return FHE.gt(currentPrice, encThreshold);
    }

    function isPriceBelow(uint256 feedId, InEuint128 calldata threshold) external returns (ebool) {
        euint128 currentPrice = oracle.getEncryptedPrice(feedId);
        euint128 encThreshold = FHE.asEuint128(threshold);
        return FHE.lt(currentPrice, encThreshold);
    }

    function isWithinBand(uint256 feedId, InEuint128 calldata lower, InEuint128 calldata upper) external returns (ebool) {
        euint128 price = oracle.getEncryptedPrice(feedId);
        euint128 encLower = FHE.asEuint128(lower);
        euint128 encUpper = FHE.asEuint128(upper);
        ebool aboveLower = FHE.gt(price, encLower);
        ebool belowUpper = FHE.lt(price, encUpper);
        return FHE.and(aboveLower, belowUpper);
    }

    function updateOracle(address newOracle) external onlyOwner {
        oracle = IFHEOracleBridgeCofhe(newOracle);
    }
}

