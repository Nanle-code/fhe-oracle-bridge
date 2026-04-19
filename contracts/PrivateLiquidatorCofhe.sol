// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IFHEOracleBridgeCofhe.sol";

contract PrivateLiquidatorCofhe {
    IFHEOracleBridgeCofhe public oracle;
    address public owner;

    struct Position {
        address owner;
        uint256 collateral;
        euint128 encLiquidationPrice;
        uint256 feedId;
        bool active;
        uint256 createdAt;
    }

    mapping(uint256 => Position) public positions;
    uint256 public positionCount;

    struct PendingLiquidation {
        uint256 ctHash;
        uint256 requestedAt;
    }

    /// @notice Latest prepared ebool (liquidation predicate) per position, awaiting threshold decrypt + publish.
    mapping(uint256 => PendingLiquidation) public pendingLiquidation;

    event PositionOpened(uint256 indexed positionId, address indexed owner, uint256 collateral);
    event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 collateral);
    event PositionClosed(uint256 indexed positionId, address indexed owner);
    /// @notice Emitted after `requestLiquidationCheck` computes the encrypted comparison. Off-chain keeper: decrypt (learns only this bool, not prices) then `completeLiquidation`.
    event LiquidationCheckPrepared(uint256 indexed positionId, uint256 ctHash, address indexed requestedBy);

    modifier onlyOwner() {
        require(msg.sender == owner, "Liquidator: not owner");
        _;
    }

    constructor(address _oracle) {
        oracle = IFHEOracleBridgeCofhe(_oracle);
        owner = msg.sender;
    }

    function openPosition(uint256 feedId, InEuint128 calldata encLiquidationPrice)
        external
        payable
        returns (uint256 positionId)
    {
        require(msg.value > 0, "Liquidator: must provide collateral");

        positionCount++;
        positionId = positionCount;

        euint128 liq = FHE.asEuint128(encLiquidationPrice);
        positions[positionId] = Position({
            owner: msg.sender,
            collateral: msg.value,
            encLiquidationPrice: liq,
            feedId: feedId,
            active: true,
            createdAt: block.timestamp
        });

        FHE.allowThis(liq);
        FHE.allow(liq, msg.sender);

        emit PositionOpened(positionId, msg.sender, msg.value);
    }

    function isLiquidatableEncrypted(uint256 positionId) public returns (ebool) {
        Position storage pos = positions[positionId];
        require(pos.active, "Liquidator: position not active");

        euint128 currentPrice = oracle.getEncryptedPrice(pos.feedId);
        return FHE.gt(pos.encLiquidationPrice, currentPrice);
    }

    /// @notice Computes encrypted (liqPrice > spot), grants global decrypt allowance for the predicate only, and emits `LiquidationCheckPrepared`.
    function requestLiquidationCheck(uint256 positionId) external {
        Position storage pos = positions[positionId];
        require(pos.active, "Liquidator: position not active");

        euint128 currentPrice = oracle.getEncryptedPrice(pos.feedId);
        ebool liq = FHE.gt(pos.encLiquidationPrice, currentPrice);
        uint256 h = uint256(ebool.unwrap(liq));
        FHE.allowGlobal(liq);
        FHE.allowThis(liq);

        pendingLiquidation[positionId] = PendingLiquidation({ ctHash: h, requestedAt: block.timestamp });
        emit LiquidationCheckPrepared(positionId, h, msg.sender);
    }

    /// @notice Publishes threshold-network decrypt result for the prepared predicate, then pays the liquidator if true.
    /// @dev The keeper learns only `isLiquidatable`, not spot or liquidation threshold — those stay FHE-handles until now (bool only).
    function completeLiquidation(uint256 positionId, bool isLiquidatable, bytes calldata decryptionProof) external {
        Position storage pos = positions[positionId];
        require(pos.active, "Liquidator: position not active");

        PendingLiquidation memory p = pendingLiquidation[positionId];
        require(p.ctHash != 0, "Liquidator: no pending check");

        ebool handle = ebool.wrap(bytes32(p.ctHash));
        FHE.publishDecryptResult(handle, isLiquidatable, decryptionProof);

        delete pendingLiquidation[positionId];

        if (!isLiquidatable) {
            return;
        }

        uint256 collateral = pos.collateral;
        pos.active = false;
        pos.collateral = 0;

        (bool ok,) = msg.sender.call{value: collateral}("");
        require(ok, "Liquidator: payout failed");

        emit PositionLiquidated(positionId, msg.sender, collateral);
    }

    /// @dev Kept for ABI compatibility; use `requestLiquidationCheck` + `completeLiquidation` on CoFHE.
    function liquidate(uint256) external pure {
        revert("Liquidator: use requestLiquidationCheck + keeper completeLiquidation");
    }

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
        oracle = IFHEOracleBridgeCofhe(newOracle);
    }

    receive() external payable {}
}

