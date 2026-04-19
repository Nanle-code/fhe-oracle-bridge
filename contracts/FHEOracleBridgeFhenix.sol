// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AccessRegistry.sol";
import "./interfaces/IFHEOracleBridgeFhenix.sol";
import "./libraries/MedianLibFhenix.sol";
import "@fhenixprotocol/contracts/FHE.sol";

contract FHEOracleBridgeFhenix is IFHEOracleBridgeFhenix {
    address public owner;
    AccessRegistry public immutable registry;

    uint256 public constant DEFAULT_TTL = 1 hours;
    uint256 public constant MIN_STAKE = 0.01 ether;

    struct Feed {
        euint128 encryptedPrice;
        uint256  lastUpdated;
        uint256  roundId;
        uint256  ttl;
        uint8    minFeeders;
        bool     active;
        string   description;
    }

    struct FeederSubmission {
        euint128 price;
        bool     submitted;
    }

    mapping(uint256 => Feed) private feeds;
    mapping(address => bool) public feeders;
    mapping(address => uint256) public feederStake;
    mapping(uint256 => mapping(uint256 => address[])) private roundFeeders;
    mapping(uint256 => mapping(uint256 => mapping(address => FeederSubmission))) private submissions;

    uint256 public feedCount;

    event FeedCreated(uint256 indexed feedId, string description);
    event FeedUpdated(uint256 indexed feedId, uint256 roundId, uint256 feederCount);
    event FeederAdded(address indexed feeder);
    event FeederRemoved(address indexed feeder);
    event FeederSlashed(address indexed feeder, uint256 amount);
    event PriceSubmitted(uint256 indexed feedId, address indexed feeder, uint256 roundId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Oracle: not owner");
        _;
    }

    modifier onlyFeeder() {
        require(feeders[msg.sender], "Oracle: not authorised feeder");
        require(feederStake[msg.sender] >= MIN_STAKE, "Oracle: insufficient stake");
        _;
    }

    modifier onlyWhitelisted() {
        require(registry.isWhitelisted(msg.sender), "Oracle: consumer not whitelisted");
        _;
    }

    modifier feedExists(uint256 feedId) {
        require(feedId > 0 && feedId <= feedCount, "Oracle: feed does not exist");
        require(feeds[feedId].active, "Oracle: feed paused");
        _;
    }

    constructor(address _registry) {
        owner = msg.sender;
        registry = AccessRegistry(_registry);
    }

    function createFeed(
        string calldata description,
        uint256 ttl,
        uint8 minFeeders
    ) external onlyOwner returns (uint256 feedId) {
        feedCount++;
        feedId = feedCount;
        Feed storage feed = feeds[feedId];
        feed.lastUpdated = 0;
        feed.roundId = 0;
        feed.ttl = ttl == 0 ? DEFAULT_TTL : ttl;
        feed.minFeeders = minFeeders == 0 ? 1 : minFeeders;
        feed.active = true;
        feed.description = description;
        emit FeedCreated(feedId, description);
    }

    function pauseFeed(uint256 feedId) external onlyOwner {
        feeds[feedId].active = false;
    }

    function resumeFeed(uint256 feedId) external onlyOwner {
        feeds[feedId].active = true;
    }

    function addFeeder(address feeder) external onlyOwner {
        feeders[feeder] = true;
        emit FeederAdded(feeder);
    }

    function removeFeeder(address feeder) external onlyOwner {
        feeders[feeder] = false;
        emit FeederRemoved(feeder);
    }

    function stake() external payable {
        require(feeders[msg.sender], "Oracle: not a registered feeder");
        require(msg.value > 0, "Oracle: zero stake");
        feederStake[msg.sender] += msg.value;
    }

    function slash(address feeder, uint256 amount) external onlyOwner {
        uint256 available = feederStake[feeder];
        uint256 slashAmt = amount > available ? available : amount;
        feederStake[feeder] -= slashAmt;
        (bool ok,) = owner.call{value: slashAmt}("");
        require(ok, "Oracle: slash transfer failed");
        emit FeederSlashed(feeder, slashAmt);
    }

    function submitPrice(
        uint256 feedId,
        inEuint128 calldata encPrice
    ) external onlyFeeder feedExists(feedId) {
        Feed storage feed = feeds[feedId];
        uint256 currentRound = feed.roundId + 1;

        require(
            !submissions[feedId][currentRound][msg.sender].submitted,
            "Oracle: already submitted this round"
        );

        euint128 enc = FHE.asEuint128(encPrice);

        submissions[feedId][currentRound][msg.sender] = FeederSubmission({
            price: enc,
            submitted: true
        });
        roundFeeders[feedId][currentRound].push(msg.sender);

        emit PriceSubmitted(feedId, msg.sender, currentRound);

        if (roundFeeders[feedId][currentRound].length >= feed.minFeeders) {
            _finaliseRound(feedId, currentRound);
        }
    }

    function _finaliseRound(uint256 feedId, uint256 roundId_) internal {
        address[] storage feederAddrs = roundFeeders[feedId][roundId_];
        uint256 n = feederAddrs.length;
        euint128 aggregated;

        if (n == 1) {
            aggregated = submissions[feedId][roundId_][feederAddrs[0]].price;
        } else {
            euint128[] memory prices = new euint128[](n);
            for (uint256 i = 0; i < n; i++) {
                prices[i] = submissions[feedId][roundId_][feederAddrs[i]].price;
            }
            aggregated = MedianLibFhenix.encryptedMedian(prices);
        }

        feeds[feedId].encryptedPrice = aggregated;
        feeds[feedId].lastUpdated = block.timestamp;
        feeds[feedId].roundId = roundId_;

        emit FeedUpdated(feedId, roundId_, n);
    }

    function getEncryptedPrice(uint256 feedId)
        external
        view
        onlyWhitelisted
        feedExists(feedId)
        returns (euint128)
    {
        Feed storage feed = feeds[feedId];
        require(feed.lastUpdated > 0, "Oracle: no price yet");
        require(block.timestamp - feed.lastUpdated <= feed.ttl, "Oracle: stale price");
        return feed.encryptedPrice;
    }

    function getFeedInfo(uint256 feedId) external view returns (
        string memory description,
        uint256 lastUpdated,
        uint256 roundId,
        uint256 ttl,
        uint8   minFeeders,
        bool    active,
        bool    isStale
    ) {
        Feed storage f = feeds[feedId];
        return (
            f.description,
            f.lastUpdated,
            f.roundId,
            f.ttl,
            f.minFeeders,
            f.active,
            f.lastUpdated > 0 && block.timestamp - f.lastUpdated > f.ttl
        );
    }

    function pendingSubmissions(uint256 feedId) external view returns (uint256) {
        uint256 nextRound = feeds[feedId].roundId + 1;
        return roundFeeders[feedId][nextRound].length;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Oracle: zero address");
        owner = newOwner;
    }

    receive() external payable {}
}
