// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./mocks/FHECompat.sol";
import "./interfaces/IFHEOracleBridge.sol";

/**
 * @title MockConsumer
 * @notice Demo consumer contract for Wave 2 evaluation.
 *
 * Shows how any DeFi protocol integrates with FHEOracleBridge:
 *   1. This contract is whitelisted in AccessRegistry.
 *   2. It pulls euint128 price from the oracle.
 *   3. It performs comparisons in FHE — no plaintext price ever exposed.
 *
 * Demo scenarios:
 *   - isPriceAbove(threshold)     → liquidation trigger check
 *   - isPriceBelow(threshold)     → buy signal check
 *   - isWithinBand(lower, upper)  → range check for AMM
 */
contract MockConsumer {

    IFHEOracleBridge public oracle;
    address public owner;

    uint256 public constant ETH_USD_FEED = 1;
    uint256 public constant BTC_USD_FEED = 2;

    event LiquidationTriggered(address indexed position, uint256 feedId);
    event PriceCheckPassed(uint256 feedId, string checkType);

    modifier onlyOwner() {
        require(msg.sender == owner, "Consumer: not owner");
        _;
    }

    constructor(address _oracle) {
        oracle = IFHEOracleBridge(_oracle);
        owner = msg.sender;
    }

    /**
     * @notice Check if the current encrypted price is above a threshold.
     *         Entirely in FHE — threshold and price never plaintext on-chain.
     *
     * @param feedId     Feed to check
     * @param threshold  Threshold value for local tests and demo integration
     * @return           True if price > threshold
     */
    function isPriceAbove(uint256 feedId, uint256 threshold) external view returns (bool) {
        euint128 currentPrice = oracle.getEncryptedPrice(feedId);
        euint128 encThreshold = FHE.asEuint128(threshold);
        ebool result = FHE.gt(currentPrice, encThreshold);
        return FHE.decrypt(result);
    }

    /**
     * @notice Check if price is below threshold (e.g. buy signal).
     */
    function isPriceBelow(uint256 feedId, uint256 threshold) external view returns (bool) {
        euint128 currentPrice = oracle.getEncryptedPrice(feedId);
        euint128 encThreshold = FHE.asEuint128(threshold);
        ebool result = FHE.lt(currentPrice, encThreshold);
        return FHE.decrypt(result);
    }

    /**
     * @notice Check if price is within a band [lower, upper].
     *         Used for AMM range orders and structured products.
     */
    function isWithinBand(
        uint256 feedId,
        uint256 lower,
        uint256 upper
    ) external view returns (bool) {
        euint128 price    = oracle.getEncryptedPrice(feedId);
        euint128 encLower = FHE.asEuint128(lower);
        euint128 encUpper = FHE.asEuint128(upper);
        ebool aboveLower  = FHE.gt(price, encLower);
        ebool belowUpper  = FHE.lt(price, encUpper);
        ebool inRange     = FHE.and(aboveLower, belowUpper);
        return FHE.decrypt(inRange);
    }

    /**
     * @notice Simulate a liquidation check.
     *         price < liquidationPrice → trigger liquidation.
     *
     * @param position         The position address being checked.
     * @param liquidationPrice Threshold below which we liquidate.
     */
    function checkLiquidation(
        address position,
        uint256 feedId,
        uint256 liquidationPrice
    ) external returns (bool shouldLiquidate) {
        euint128 currentPrice = oracle.getEncryptedPrice(feedId);
        euint128 encLiqPrice  = FHE.asEuint128(liquidationPrice);
        ebool result          = FHE.lt(currentPrice, encLiqPrice);
        shouldLiquidate       = FHE.decrypt(result);

        if (shouldLiquidate) {
            emit LiquidationTriggered(position, feedId);
        }
    }

    function updateOracle(address newOracle) external onlyOwner {
        oracle = IFHEOracleBridge(newOracle);
    }
}
