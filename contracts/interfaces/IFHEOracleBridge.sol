// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/contracts/FHE.sol";

/**
 * @title IFHEOracleBridge
 * @notice Interface that consumer contracts use to pull encrypted prices.
 *
 * Prices are stored as euint128 (supports 8-decimal USD prices up to $34T).
 * Consumers only need this interface — they never import the full oracle.
 */
interface IFHEOracleBridge {
    function getEncryptedPrice(uint256 feedId) external view returns (euint128);
    function getFeedInfo(uint256 feedId) external view returns (
        string memory description,
        uint256 lastUpdated,
        uint256 roundId,
        uint256 ttl,
        uint8   minFeeders,
        bool    active,
        bool    isStale
    );
}
