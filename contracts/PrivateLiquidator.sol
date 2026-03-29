// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/contracts/FHE.sol";
import "./interfaces/IFHEOracleBridge.sol";

/**
 * @title PrivateLiquidator
 * @notice Wave 4 deliverable — real consumer that integrates with FHEOracleBridge.
 *
 * Manages collateralised positions and liquidates them when the encrypted oracle
 * price falls below an encrypted liquidation threshold — zero plaintext exposure.
 */
contract PrivateLiquidator {

    IFHEOracleBridge public oracle;
    address public owner;

    struct Position {
        address  owner;
        uint256  collateral;           // ETH collateral in wei
        euint128 encLiquidationPrice;  // FHE-encrypted liquidation threshold
        uint256  feedId;
        bool     active;
        uint256  createdAt;
    }

    mapping(uint256 => Position) public positions;
    uint256 public positionCount;

    event PositionOpened(uint256 indexed positionId, address indexed owner, uint256 collateral);
    event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 collateral);
    event PositionClosed(uint256 indexed positionId, address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Liquidator: not owner");
        _;
    }

    constructor(address _oracle) {
        oracle = IFHEOracleBridge(_oracle);
        owner = msg.sender;
    }

    /**
     * @notice Open a collateralised position with a private liquidation threshold.
     *
     * @param feedId              Price feed to monitor (e.g. 1 = ETH/USD).
     * @param encLiquidationPrice Encrypted threshold passed as inEuint128 from CoFHE SDK.
     */
    function openPosition(
        uint256 feedId,
        inEuint128 calldata encLiquidationPrice
    ) external payable returns (uint256 positionId) {
        require(msg.value > 0, "Liquidator: must provide collateral");

        positionCount++;
        positionId = positionCount;

        positions[positionId] = Position({
            owner:               msg.sender,
            collateral:          msg.value,
            encLiquidationPrice: FHE.asEuint128(encLiquidationPrice),
            feedId:              feedId,
            active:              true,
            createdAt:           block.timestamp
        });

        emit PositionOpened(positionId, msg.sender, msg.value);
    }

    /**
     * @notice Check if a position should be liquidated.
     *         Returns true if current oracle price < position's liquidation price.
     *         Comparison happens entirely in FHE — no price revealed.
     */
    function isLiquidatable(uint256 positionId) public view returns (bool) {
        Position storage pos = positions[positionId];
        require(pos.active, "Liquidator: position not active");

        euint128 currentPrice = oracle.getEncryptedPrice(pos.feedId);
        // Liquidate if liquidationPx > currentPrice (price fell below threshold)
        ebool result = FHE.gt(pos.encLiquidationPrice, currentPrice);
        return FHE.decrypt(result);
    }

    /**
     * @notice Liquidate an undercollateralised position.
     *         Anyone can call — incentivised by a 5% reward.
     */
    function liquidate(uint256 positionId) external {
        require(isLiquidatable(positionId), "Liquidator: not liquidatable");

        Position storage pos = positions[positionId];
        uint256 collateral = pos.collateral;
        pos.active = false;
        pos.collateral = 0;

        uint256 liquidatorReward = collateral * 5 / 100;
        uint256 remainder        = collateral - liquidatorReward;

        (bool ok1,) = msg.sender.call{value: liquidatorReward}("");
        require(ok1, "Liquidator: reward transfer failed");

        (bool ok2,) = owner.call{value: remainder}("");
        require(ok2, "Liquidator: remainder transfer failed");

        emit PositionLiquidated(positionId, msg.sender, collateral);
    }

    /**
     * @notice Close a healthy position and reclaim collateral.
     */
    function closePosition(uint256 positionId) external {
        Position storage pos = positions[positionId];
        require(pos.owner == msg.sender, "Liquidator: not position owner");
        require(pos.active, "Liquidator: already closed");

        uint256 collateral = pos.collateral;
        pos.active = false;
        pos.collateral = 0;

        (bool ok,) = msg.sender.call{value: collateral}("");
        require(ok, "Liquidator: refund failed");

        emit PositionClosed(positionId, msg.sender);
    }

    function updateOracle(address newOracle) external onlyOwner {
        oracle = IFHEOracleBridge(newOracle);
    }

    receive() external payable {}
}
