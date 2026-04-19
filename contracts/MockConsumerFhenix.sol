// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/contracts/FHE.sol";
import "./interfaces/IFHEOracleBridgeFhenix.sol";

contract MockConsumerFhenix {
    IFHEOracleBridgeFhenix public oracle;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Consumer: not owner");
        _;
    }

    constructor(address _oracle) {
        oracle = IFHEOracleBridgeFhenix(_oracle);
        owner = msg.sender;
    }

    function isPriceAbove(uint256 feedId, inEuint128 calldata threshold) external view returns (bool) {
        euint128 currentPrice = oracle.getEncryptedPrice(feedId);
        euint128 encThreshold = FHE.asEuint128(threshold);
        ebool result = FHE.gt(currentPrice, encThreshold);
        return FHE.decrypt(result);
    }

    function isPriceBelow(uint256 feedId, inEuint128 calldata threshold) external view returns (bool) {
        euint128 currentPrice = oracle.getEncryptedPrice(feedId);
        euint128 encThreshold = FHE.asEuint128(threshold);
        ebool result = FHE.lt(currentPrice, encThreshold);
        return FHE.decrypt(result);
    }

    function isWithinBand(
        uint256 feedId,
        inEuint128 calldata lower,
        inEuint128 calldata upper
    ) external view returns (bool) {
        euint128 price = oracle.getEncryptedPrice(feedId);
        euint128 encLower = FHE.asEuint128(lower);
        euint128 encUpper = FHE.asEuint128(upper);
        ebool aboveLower = FHE.gt(price, encLower);
        ebool belowUpper = FHE.lt(price, encUpper);
        ebool inRange = FHE.and(aboveLower, belowUpper);
        return FHE.decrypt(inRange);
    }

    function checkLiquidation(
        address position,
        uint256 feedId,
        inEuint128 calldata liquidationPrice
    ) external returns (bool shouldLiquidate) {
        euint128 currentPrice = oracle.getEncryptedPrice(feedId);
        euint128 encLiqPrice = FHE.asEuint128(liquidationPrice);
        ebool result = FHE.lt(currentPrice, encLiqPrice);
        shouldLiquidate = FHE.decrypt(result);

        if (shouldLiquidate) {
            emit LiquidationTriggered(position, feedId);
        }
    }

    event LiquidationTriggered(address indexed position, uint256 feedId);

    function updateOracle(address newOracle) external onlyOwner {
        oracle = IFHEOracleBridgeFhenix(newOracle);
    }
}
