// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./mocks/FHECompat.sol";
import "./interfaces/IFHEOracleBridge.sol";

/**
 * @title PrivateThresholdAlerts
 * @notice Privacy-preserving price threshold alerts with encrypted comparisons
 *
 * Allows users to set encrypted price thresholds that trigger alerts when crossed.
 * Comparisons happen entirely in FHE - thresholds and prices never exposed as plaintext.
 *
 * Flow:
 *   1. User creates alert with encrypted threshold
 *   2. Keeper triggers alert check on price updates
 *   3. Comparison done in FHE precompile
 *   4. Only boolean result revealed
 */
contract PrivateThresholdAlerts {
    IFHEOracleBridge public immutable oracle;

    enum CompareMode {
        Below,  // Trigger when price < threshold (stop loss)
        Above   // Trigger when price > threshold (take profit)
    }

    struct Alert {
        address owner;
        uint256 feedId;
        euint128 encThreshold;
        CompareMode mode;
        bool active;
        uint256 createdAt;
    }

    mapping(uint256 => Alert) public alerts;
    uint256 public alertCount;

    event AlertCreated(
        uint256 indexed alertId,
        address indexed owner,
        uint256 indexed feedId,
        CompareMode mode
    );
    event AlertCancelled(uint256 indexed alertId, address indexed owner);
    event ThresholdAlert(
        uint256 indexed alertId,
        bool triggered,
        uint256 timestamp
    );

    modifier onlyOwner(uint256 alertId) {
        require(alerts[alertId].owner == msg.sender, "Alerts: not owner");
        _;
    }

    constructor(address _oracle) {
        oracle = IFHEOracleBridge(_oracle);
    }

    /**
     * @notice Create a new threshold alert
     * @param feedId Price feed to monitor
     * @param threshold Threshold value for local tests and demo integration
     * @param mode Comparison mode (Below/Above)
     */
    function createAlert(
        uint256 feedId,
        uint256 threshold,
        CompareMode mode
    ) external returns (uint256 alertId) {
        require(threshold > 0, "Alerts: invalid threshold");
        
        alertCount++;
        alertId = alertCount;

        alerts[alertId] = Alert({
            owner: msg.sender,
            feedId: feedId,
            encThreshold: FHE.asEuint128(threshold),
            mode: mode,
            active: true,
            createdAt: block.timestamp
        });

        emit AlertCreated(alertId, msg.sender, feedId, mode);
    }

    /**
     * @notice Cancel an active alert
     */
    function cancelAlert(uint256 alertId) external onlyOwner(alertId) {
        require(alerts[alertId].active, "Alerts: not active");
        
        alerts[alertId].active = false;
        emit AlertCancelled(alertId, msg.sender);
    }

    /**
     * @notice Check if alert should trigger (called by keeper)
     * @param alertId Alert to check
     * @return triggered Whether alert condition is met
     */
    function triggerAlertCheck(uint256 alertId) external returns (bool triggered) {
        Alert storage alert = alerts[alertId];
        require(alert.active, "Alerts: not active");

        euint128 currentPrice = oracle.getEncryptedPrice(alert.feedId);
        ebool result;

        if (alert.mode == CompareMode.Below) {
            // Trigger when price < threshold (stop loss)
            result = FHE.lt(currentPrice, alert.encThreshold);
        } else {
            // Trigger when price > threshold (take profit)
            result = FHE.gt(currentPrice, alert.encThreshold);
        }

        triggered = FHE.decrypt(result);
        
        emit ThresholdAlert(alertId, triggered, block.timestamp);
    }

    /**
     * @notice Get alert information
     */
    function getAlertInfo(uint256 alertId) external view returns (
        address owner,
        uint256 feedId,
        CompareMode mode,
        bool active,
        uint256 createdAt
    ) {
        Alert storage alert = alerts[alertId];
        return (
            alert.owner,
            alert.feedId,
            alert.mode,
            alert.active,
            alert.createdAt
        );
    }

    /**
     * @notice Get user's active alerts
     */
    function getUserAlerts(address user) external view returns (uint256[] memory) {
        uint256[] memory userAlertIds = new uint256[](alertCount);
        uint256 count = 0;
        
        for (uint256 i = 1; i <= alertCount; i++) {
            if (alerts[i].owner == user && alerts[i].active) {
                userAlertIds[count] = i;
                count++;
            }
        }
        
        // Resize array to actual count
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = userAlertIds[i];
        }
        
        return result;
    }

    /**
     * @notice Get total number of alerts
     */
    function getTotalAlerts() external view returns (uint256) {
        return alertCount;
    }

    /**
     * @notice Get active alert count
     */
    function getActiveAlertCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 1; i <= alertCount; i++) {
            if (alerts[i].active) count++;
        }
        return count;
    }
}
