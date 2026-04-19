// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/contracts/FHE.sol";

interface IFHEOracleBridgeFhenix {
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
