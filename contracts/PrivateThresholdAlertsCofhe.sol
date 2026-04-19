// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IFHEOracleBridgeCofhe.sol";

/// @title PrivateThresholdAlertsCofhe
/// @notice Encrypted price vs encrypted threshold → single boolean (via async decrypt). Spot and X never appear in plaintext on-chain.
/// @dev Contract must be whitelisted on `AccessRegistry` like other oracle consumers. Flow: `subscribe` → `prepareThresholdCheck` → keeper `decryptForTx` → `completeThresholdAlert` → `ThresholdAlert` emits plaintext bool only.
contract PrivateThresholdAlertsCofhe {
    IFHEOracleBridgeCofhe public immutable oracle;

    /// @dev Below: fire when spot < threshold (e.g. “ETH below X”). Above: fire when spot > threshold.
    enum CompareMode {
        Below,
        Above
    }

    struct Subscription {
        address subscriber;
        uint256 feedId;
        euint128 encThreshold;
        CompareMode mode;
        bool active;
    }

    struct Pending {
        uint256 ctHash;
        uint256 requestedAt;
    }

    mapping(uint256 => Subscription) public subscriptions;
    mapping(uint256 => Pending) public pendingCheck;
    uint256 public subscriptionCount;

    event SubscriptionCreated(
        uint256 indexed subId,
        address indexed subscriber,
        uint256 indexed feedId,
        CompareMode mode
    );
    event SubscriptionClosed(uint256 indexed subId, address indexed subscriber);
    /// @notice Encrypted predicate ready; keeper learns only the bool after threshold decrypt — not price nor X.
    event ThresholdCheckPrepared(
        uint256 indexed subId,
        uint256 indexed feedId,
        uint256 ctHash,
        address indexed requestedBy
    );
    /// @notice Plaintext result after `completeThresholdAlert`; this is the only public value tied to the comparison.
    event ThresholdAlert(uint256 indexed subId, uint256 indexed feedId, bool triggered);

    constructor(address _oracle) {
        oracle = IFHEOracleBridgeCofhe(_oracle);
    }

    /// @param encThreshold Client-encrypted level X (same8-decimal fixed point as oracle prices).
    function subscribe(
        uint256 feedId,
        InEuint128 calldata encThreshold,
        CompareMode mode
    ) external returns (uint256 subId) {
        subscriptionCount++;
        subId = subscriptionCount;

        euint128 t = FHE.asEuint128(encThreshold);
        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            feedId: feedId,
            encThreshold: t,
            mode: mode,
            active: true
        });

        FHE.allowThis(t);
        FHE.allow(t, msg.sender);

        emit SubscriptionCreated(subId, msg.sender, feedId, mode);
    }

    function unsubscribe(uint256 subId) external {
        Subscription storage s = subscriptions[subId];
        require(s.subscriber == msg.sender, "Alerts: not subscriber");
        require(s.active, "Alerts: inactive");
        s.active = false;
        delete pendingCheck[subId];
        emit SubscriptionClosed(subId, msg.sender);
    }

    /// @notice Pulls current encrypted feed, compares to stored encrypted threshold, emits predicate handle for keeper decrypt.
    function prepareThresholdCheck(uint256 subId) external {
        Subscription storage s = subscriptions[subId];
        require(s.active, "Alerts: inactive");

        euint128 price = oracle.getEncryptedPrice(s.feedId);
        ebool hit;
        if (s.mode == CompareMode.Below) {
            hit = FHE.lt(price, s.encThreshold);
        } else {
            hit = FHE.gt(price, s.encThreshold);
        }

        uint256 h = uint256(ebool.unwrap(hit));
        FHE.allowGlobal(hit);
        FHE.allowThis(hit);

        pendingCheck[subId] = Pending({ ctHash: h, requestedAt: block.timestamp });
        emit ThresholdCheckPrepared(subId, s.feedId, h, msg.sender);
    }

    /// @notice Publishes CoFHE decrypt result for the prepared predicate, then emits `ThresholdAlert` (bool only).
    function completeThresholdAlert(uint256 subId, bool triggered, bytes calldata decryptionProof) external {
        Subscription storage s = subscriptions[subId];
        require(s.active, "Alerts: inactive");

        Pending memory p = pendingCheck[subId];
        require(p.ctHash != 0, "Alerts: no pending check");

        ebool handle = ebool.wrap(bytes32(p.ctHash));
        FHE.publishDecryptResult(handle, triggered, decryptionProof);

        delete pendingCheck[subId];

        emit ThresholdAlert(subId, s.feedId, triggered);
    }
}
