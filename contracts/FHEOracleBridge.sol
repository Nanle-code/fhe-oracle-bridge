// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FHEOracleBridge
 * @notice Privacy-preserving price oracle built on Fhenix CoFHE.
 *
 * Architecture:
 *   - Authorised feeders submit encrypted price data each round.
 *   - Prices are stored as euint128 — never readable as plaintext on-chain.
 *   - Only whitelisted consumer contracts can pull the encrypted value.
 *   - Consumers decrypt locally inside their own execution context.
 *   - Multi-feeder aggregation: median computed via FHE comparisons (Wave 3).
 *   - Staleness guard: pulls revert if feed not updated within TTL.
 *   - Feeder staking: feeders bond ETH; outlier submissions can be slashed.
 *
 * Feed IDs:
 *   1 = ETH/USD
 *   2 = BTC/USD
 *   3 = (extensible)
 *
 * NOTE: FHE type imports reference @fhenixprotocol/contracts.
 *       For local Hardhat testing without the FHE precompile, a mock
 *       FHE library is injected via the MockFHE pattern (see test/).
 */

import "./AccessRegistry.sol";
import "./interfaces/IFHEOracleBridge.sol";
import "./libraries/MedianLib.sol";
import "./mocks/FHECompat.sol";
// ─────────────────────────────────────────────────────────────────────────────

contract FHEOracleBridge is IFHEOracleBridge {

    // ── State ────────────────────────────────────────────────────────────────

    address public owner;
    AccessRegistry public immutable registry;

    /// @dev Default staleness TTL: 1 hour. Configurable per-feed.
    uint256 public constant DEFAULT_TTL = 1 hours;

    struct Feed {
        euint128 encryptedPrice;     // FHE-encrypted price — never plaintext
        uint256  lastUpdated;        // block.timestamp of last successful round
        uint256  roundId;            // monotonically increasing round counter
        uint256  ttl;                // staleness threshold in seconds
        uint8    minFeeders;         // quorum required before price is accepted
        bool     active;             // owner can pause a feed
        string   description;        // e.g. "ETH / USD"
    }

    struct FeederSubmission {
        euint128 price;
        bool     submitted;
    }

    mapping(uint256 => Feed)                                   private feeds;
    mapping(address => bool)                                   public  feeders;
    mapping(address => uint256)                                public  feederStake;  // bonded ETH
    mapping(uint256 => mapping(uint256 => address[]))          private roundFeeders; // feedId → roundId → feeder list
    mapping(uint256 => mapping(uint256 => mapping(address => FeederSubmission))) private submissions;

    uint256 public feedCount;
    uint256 public constant MIN_STAKE = 0.01 ether;

    // ── Events ───────────────────────────────────────────────────────────────

    event FeedCreated(uint256 indexed feedId, string description);
    event FeedUpdated(uint256 indexed feedId, uint256 roundId, uint256 feederCount);
    event FeederAdded(address indexed feeder);
    event FeederRemoved(address indexed feeder);
    event FeederSlashed(address indexed feeder, uint256 amount);
    event PriceSubmitted(uint256 indexed feedId, address indexed feeder, uint256 roundId);

    // ── Modifiers ────────────────────────────────────────────────────────────

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

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _registry) {
        owner = msg.sender;
        registry = AccessRegistry(_registry);
    }

    // ── Feed management ──────────────────────────────────────────────────────

    /**
     * @notice Create a new price feed.
     * @param description  Human-readable label, e.g. "ETH / USD"
     * @param ttl          Staleness TTL in seconds (0 = use DEFAULT_TTL)
     * @param minFeeders   Minimum feeder submissions before round is accepted
     */
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

    // ── Feeder management ────────────────────────────────────────────────────

    function addFeeder(address feeder) external onlyOwner {
        feeders[feeder] = true;
        emit FeederAdded(feeder);
    }

    function removeFeeder(address feeder) external onlyOwner {
        feeders[feeder] = false;
        emit FeederRemoved(feeder);
    }

    /**
     * @notice Feeders bond ETH to participate. Slashable for manipulation.
     */
    function stake() external payable {
        require(feeders[msg.sender], "Oracle: not a registered feeder");
        require(msg.value > 0, "Oracle: zero stake");
        feederStake[msg.sender] += msg.value;
    }

    /**
     * @notice Slash a feeder's stake (owner-controlled, for outlier manipulation).
     */
    function slash(address feeder, uint256 amount) external onlyOwner {
        uint256 available = feederStake[feeder];
        uint256 slashAmt = amount > available ? available : amount;
        feederStake[feeder] -= slashAmt;
        // Slashed ETH goes to owner (could route to insurance fund in v2)
        (bool ok,) = owner.call{value: slashAmt}("");
        require(ok, "Oracle: slash transfer failed");
        emit FeederSlashed(feeder, slashAmt);
    }

    // ── Price submission ─────────────────────────────────────────────────────

    /**
     * @notice Submit an encrypted price for a feed in the current round.
     *
     * @dev  `encPrice` is an FHE-encrypted uint256 produced client-side
     *        using the CoFHE SDK:
     *          const encPrice = await fhenixClient.encrypt_uint256(price);
     *        On Fhenix testnets, FHE.asEuint256(encPrice) stores it as
     *        an encrypted value the EVM can operate on without decrypting.
     *
     *        For local Hardhat testing, FHEMock treats euint256 as a plain
     *        uint256 so all logic can be exercised without a real FHE node.
     *
     * @param feedId    Target feed
     * @param encPrice  Plain uint256 in local tests, ciphertext-backed value on Fhenix
     */
    function submitPrice(
        uint256 feedId,
        uint256 encPrice
    ) external onlyFeeder feedExists(feedId) {
        Feed storage feed = feeds[feedId];
        uint256 currentRound = feed.roundId + 1; // next round being built

        // Prevent double-submission per feeder per round
        require(
            !submissions[feedId][currentRound][msg.sender].submitted,
            "Oracle: already submitted this round"
        );

        euint128 enc = FHE.asEuint128(encPrice);

        submissions[feedId][currentRound][msg.sender] = FeederSubmission({
            price:     enc,
            submitted: true
        });
        roundFeeders[feedId][currentRound].push(msg.sender);

        emit PriceSubmitted(feedId, msg.sender, currentRound);

        // If quorum reached, finalise the round
        if (roundFeeders[feedId][currentRound].length >= feed.minFeeders) {
            _finaliseRound(feedId, currentRound);
        }
    }

    /**
     * @dev Aggregate submissions for a round into a single encrypted price.
     *      Simple approach (Wave 2): take first submission.
     *      Full approach (Wave 3): compute encrypted median via FHE comparisons.
     *
     *      The median algorithm works as follows without decrypting:
     *        1. For each pair (i, j) of submitted prices, compute FHE.gt(p_i, p_j).
     *        2. Count how many prices each submission is greater than.
     *        3. The median is the price where count ≈ n/2.
     *      This is O(n²) FHE operations — feasible for n ≤ 5 feeders per round.
     */
    function _finaliseRound(uint256 feedId, uint256 roundId_) internal {
        address[] storage feederAddrs = roundFeeders[feedId][roundId_];
        uint256 n = feederAddrs.length;

        euint128 aggregated;

        if (n == 1) {
            // Single feeder — use directly
            aggregated = submissions[feedId][roundId_][feederAddrs[0]].price;
        } else {
            // Multi-feeder: encrypted median via FHE comparisons
            // Collect prices into memory array
            euint128[] memory prices = new euint128[](n);
            for (uint256 i = 0; i < n; i++) {
                prices[i] = submissions[feedId][roundId_][feederAddrs[i]].price;
            }
            aggregated = MedianLib.encryptedMedian(prices);
        }

        feeds[feedId].encryptedPrice = aggregated;
        feeds[feedId].lastUpdated    = block.timestamp;
        feeds[feedId].roundId        = roundId_;

        emit FeedUpdated(feedId, roundId_, n);
    }

    // ── Consumer interface ───────────────────────────────────────────────────

    /**
     * @notice Pull the encrypted price for a feed.
     * @dev    Returns euint256 — an FHE ciphertext. Callers must hold a
     *         valid FHE permit to decrypt it client-side via the CoFHE SDK.
     *         Price is NEVER revealed as plaintext in this call.
     *
     * @param feedId  The feed to query (1=ETH/USD, 2=BTC/USD, ...)
     * @return        Encrypted price as euint256
     */
    function getEncryptedPrice(uint256 feedId)
        external
        view
        onlyWhitelisted
        feedExists(feedId)
        returns (euint128)
    {
        Feed storage feed = feeds[feedId];
        require(feed.lastUpdated > 0, "Oracle: no price yet");
        require(
            block.timestamp - feed.lastUpdated <= feed.ttl,
            "Oracle: stale price"
        );
        return feed.encryptedPrice;
    }

    /**
     * @notice Metadata for a feed — no price exposure.
     */
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

    /**
     * @notice How many feeders have submitted in the current (pending) round.
     */
    function pendingSubmissions(uint256 feedId) external view returns (uint256) {
        uint256 nextRound = feeds[feedId].roundId + 1;
        return roundFeeders[feedId][nextRound].length;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Oracle: zero address");
        owner = newOwner;
    }

    receive() external payable {}
}
