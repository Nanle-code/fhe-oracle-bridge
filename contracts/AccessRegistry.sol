// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AccessRegistry
 * @notice Controls which consumer contracts can pull encrypted prices
 *         from the FHEOracleBridge. Only whitelisted addresses receive
 *         euint256 values — everyone else gets reverted.
 *
 * Wave 1-2 deliverable: deploy this, whitelist MockConsumer, prove
 *                        non-whitelisted callers are rejected.
 */
contract AccessRegistry {
    address public owner;

    mapping(address => bool) private whitelisted;
    mapping(address => string) public consumerLabels;

    address[] private consumerList;

    event ConsumerWhitelisted(address indexed consumer, string label);
    event ConsumerRevoked(address indexed consumer);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "AccessRegistry: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Add a consumer contract to the whitelist.
     * @param consumer  Address of the consuming contract.
     * @param label     Human-readable label for tracking (e.g. "PrivateLiquidator v1").
     */
    function whitelist(address consumer, string calldata label) external onlyOwner {
        require(consumer != address(0), "AccessRegistry: zero address");
        if (!whitelisted[consumer]) {
            consumerList.push(consumer);
        }
        whitelisted[consumer] = true;
        consumerLabels[consumer] = label;
        emit ConsumerWhitelisted(consumer, label);
    }

    /**
     * @notice Remove a consumer from the whitelist.
     */
    function revoke(address consumer) external onlyOwner {
        whitelisted[consumer] = false;
        emit ConsumerRevoked(consumer);
    }

    /**
     * @notice Check if an address is whitelisted. Called by FHEOracleBridge.
     */
    function isWhitelisted(address consumer) external view returns (bool) {
        return whitelisted[consumer];
    }

    /**
     * @notice Return all consumers ever whitelisted (active or revoked).
     */
    function allConsumers() external view returns (address[] memory) {
        return consumerList;
    }

    /**
     * @notice Transfer ownership to a new address.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AccessRegistry: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
