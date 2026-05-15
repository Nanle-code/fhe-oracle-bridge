// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../mocks/FHECompat.sol";
import "../interfaces/IFHEOracleBridge.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ProductionOracle
 * @notice Production-hardened FHE Oracle Bridge with comprehensive security measures
 * @dev Includes access control, rate limiting, emergency controls, and detailed audit logging
 */
contract ProductionOracle is IFHEOracleBridge, Ownable, Pausable, ReentrancyGuard {
    
    // ===== STATE VARIABLES =====
    
    // Feed management
    struct Feed {
        string name;
        uint256 minFeeders;
        uint256 ttl;
        uint256 lastUpdated;
        uint256 roundId;
        bool active;
        uint256 createdAt;
    }
    
    // Feeder management
    struct FeederInfo {
        bool active;
        uint256 stake;
        uint256 lastSubmission;
        uint256 reputationScore;
        uint256 submissionsCount;
        mapping(uint256 => bool) hasSubmittedRound;
    }
    
    // Rate limiting
    struct RateLimit {
        uint256 lastSubmission;
        uint256 submissionsInWindow;
        uint256 windowStart;
    }
    
    // Security controls
    uint256 public constant MAX_SUBMISSIONS_PER_WINDOW = 10;
    uint256 public constant RATE_LIMIT_WINDOW = 60; // 1 minute
    uint256 public constant MAX_PRICE = 1e12 * 1e8; // $1 trillion
    uint256 public constant MIN_STAKE = 1e16; // 0.01 ETH
    
    // Emergency controls
    uint256 public emergencyPauseDuration;
    mapping(address => bool) public emergencyPausers;
    mapping(address => bool) public authorizedOperators;
    
    // Audit logging
    event AuditLog(
        uint256 indexed timestamp,
        address indexed actor,
        string action,
        bytes32 indexed requestId,
        bytes data
    );
    
    // State variables
    mapping(uint256 => Feed) public feeds;
    mapping(address => FeederInfo) public feeders;
    mapping(uint256 => mapping(address => RateLimit)) public rateLimits;
    mapping(uint256 => euint128) public encryptedPrices;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;
    
    uint256 public feedCount;
    uint256 public totalStaked;
    address[] public feederList;
    
    // ===== MODIFIERS =====
    
    modifier onlyAuthorizedOperator() {
        require(authorizedOperators[msg.sender] || msg.sender == owner(), "Unauthorized operator");
        _;
    }
    
    modifier onlyEmergencyPauser() {
        require(emergencyPausers[msg.sender] || msg.sender == owner(), "Not an emergency pauser");
        _;
    }
    
    modifier rateLimited(uint256 feedId) {
        require(!isRateLimited(msg.sender, feedId), "Rate limit exceeded");
        _;
        updateRateLimit(msg.sender, feedId);
    }
    
    modifier validFeedId(uint256 feedId) {
        require(feedId > 0 && feedId <= feedCount, "Invalid feed ID");
        require(feeds[feedId].active, "Feed not active");
        _;
    }
    
    modifier validFeeder() {
        require(feeders[msg.sender].active, "Not an authorized feeder");
        require(feeders[msg.sender].stake >= MIN_STAKE, "Insufficient stake");
        _;
    }
    
    modifier validPrice(uint256 price) {
        require(price > 0 && price <= MAX_PRICE, "Invalid price");
        _;
    }
    
    modifier whenNotEmergencyPaused() {
        require(!paused || block.timestamp > emergencyPauseDuration, "Emergency pause active");
        _;
    }
    
    // ===== CONSTRUCTOR =====
    
    constructor() Ownable(msg.sender) {
        emergencyPauseDuration = 0;
        
        // Initialize emergency pausers
        emergencyPausers[msg.sender] = true;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "CONTRACT_DEPLOYED",
            keccak256("deploy"),
            abi.encode(address(this))
        );
    }
    
    // ===== ADMIN FUNCTIONS =====
    
    /**
     * @notice Create a new price feed
     * @param name Feed name
     * @param minFeeders Minimum number of feeders required
     * @param ttl Time-to-live in seconds
     */
    function createFeed(
        string memory name,
        uint256 minFeeders,
        uint256 ttl
    ) external onlyOwner whenNotPaused validFeeder {
        require(minFeeders > 0 && minFeeders <= 20, "Invalid min feeders");
        require(ttl > 60 && ttl <= 86400, "Invalid TTL"); // 1 minute to 24 hours
        
        feedCount++;
        feeds[feedCount] = Feed({
            name: name,
            minFeeders: minFeeders,
            ttl: ttl,
            lastUpdated: 0,
            roundId: 0,
            active: true,
            createdAt: block.timestamp
        });
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "FEED_CREATED",
            keccak256(abi.encode(feedCount)),
            abi.encode(name, minFeeders, ttl)
        );
        
        emit FeedCreated(feedCount, name, minFeeders, ttl);
    }
    
    /**
     * @notice Add a new feeder
     * @param feeder Feeder address
     */
    function addFeeder(address feeder) external onlyOwner whenNotPaused {
        require(feeder != address(0), "Invalid address");
        require(!feeders[feeder].active, "Feeder already active");
        
        feeders[feeder].active = true;
        feederList.push(feeder);
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "FEEDER_ADDED",
            keccak256(abi.encode(feeder)),
            abi.encode(feeder)
        );
        
        emit FeederAdded(feeder);
    }
    
    /**
     * @notice Remove a feeder
     * @param feeder Feeder address
     */
    function removeFeeder(address feeder) external onlyOwner whenNotPaused {
        require(feeders[feeder].active, "Feeder not active");
        
        feeders[feeder].active = false;
        totalStaked -= feeders[feeder].stake;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "FEEDER_REMOVED",
            keccak256(abi.encode(feeder)),
            abi.encode(feeder, feeders[feeder].stake)
        );
        
        emit FeederRemoved(feeder);
    }
    
    /**
     * @notice Emergency pause the contract
     * @param duration Pause duration in seconds
     */
    function emergencyPause(uint256 duration) external onlyEmergencyPauser {
        require(duration > 0 && duration <= 86400, "Invalid duration"); // Max 24 hours
        
        _pause();
        emergencyPauseDuration = block.timestamp + duration;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "EMERGENCY_PAUSE",
            keccak256("pause"),
            abi.encode(duration)
        );
        
        emit EmergencyPaused(duration);
    }
    
    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
        emergencyPauseDuration = 0;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "CONTRACT_UNPAUSED",
            keccak256("unpause"),
            abi.encode(block.timestamp)
        );
    }
    
    /**
     * @notice Authorize an operator
     * @param operator Operator address
     */
    function authorizeOperator(address operator) external onlyOwner {
        require(operator != address(0), "Invalid address");
        authorizedOperators[operator] = true;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "OPERATOR_AUTHORIZED",
            keccak256(abi.encode(operator)),
            abi.encode(operator)
        );
    }
    
    /**
     * @notice Revoke operator authorization
     * @param operator Operator address
     */
    function revokeOperator(address operator) external onlyOwner {
        authorizedOperators[operator] = false;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "OPERATOR_REVOKED",
            keccak256(abi.encode(operator)),
            abi.encode(operator)
        );
    }
    
    /**
     * @notice Add emergency pauser
     * @param pauser Pauser address
     */
    function addEmergencyPauser(address pauser) external onlyOwner {
        require(pauser != address(0), "Invalid address");
        emergencyPausers[pauser] = true;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "EMERGENCY_PAUSER_ADDED",
            keccak256(abi.encode(pauser)),
            abi.encode(pauser)
        );
    }
    
    /**
     * @notice Remove emergency pauser
     * @param pauser Pauser address
     */
    function removeEmergencyPauser(address pauser) external onlyOwner {
        emergencyPausers[pauser] = false;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "EMERGENCY_PAUSER_REMOVED",
            keccak256(abi.encode(pauser)),
            abi.encode(pauser)
        );
    }
    
    // ===== FEEDER FUNCTIONS =====
    
    /**
     * @notice Stake ETH as a feeder
     */
    function stake() external payable validFeeder whenNotPaused nonReentrant {
        require(msg.value >= MIN_STAKE, "Insufficient stake amount");
        
        feeders[msg.sender].stake += msg.value;
        totalStaked += msg.value;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "STAKE_INCREASED",
            keccak256(abi.encode(msg.sender)),
            abi.encode(msg.value)
        );
        
        emit Staked(msg.sender, msg.value);
    }
    
    /**
     * @notice Unstake ETH
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external validFeeder whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(feeders[msg.sender].stake >= amount, "Insufficient staked amount");
        
        // Check if feeder has active obligations
        require(!hasActiveObligations(msg.sender), "Has active obligations");
        
        feeders[msg.sender].stake -= amount;
        totalStaked -= amount;
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "STAKE_DECREASED",
            keccak256(abi.encode(msg.sender)),
            abi.encode(amount)
        );
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
        
        emit Unstaked(msg.sender, amount);
    }
    
    /**
     * @notice Submit encrypted price
     * @param feedId Feed identifier
     * @param price Encrypted price
     */
    function submitPrice(
        uint256 feedId,
        uint256 price
    ) external validFeedId validFeeder validPrice(price) 
        whenNotPaused rateLimited(feedId) nonReentrant {
        
        require(!hasSubmitted[feedId][msg.sender], "Already submitted this round");
        require(!feeders[msg.sender].hasSubmittedRound[feeds[feedId].roundId], 
                "Already submitted to this round");
        
        // Update round if needed
        uint256 currentRound = feeds[feedId].roundId;
        if (block.timestamp > feeds[feedId].lastUpdated + feeds[feedId].ttl) {
            currentRound++;
            feeds[feedId].roundId = currentRound;
            
            // Clear previous round submissions
            clearPreviousSubmissions(feedId, currentRound - 1);
        }
        
        // Store encrypted price
        encryptedPrices[feedId] = FHE.asEuint128(price);
        hasSubmitted[feedId][msg.sender] = true;
        feeders[msg.sender].hasSubmittedRound[currentRound] = true;
        
        // Update feeder stats
        feeders[msg.sender].lastSubmission = block.timestamp;
        feeders[msg.sender].submissionsCount++;
        updateReputation(msg.sender, true);
        
        // Update feed timestamp
        feeds[feedId].lastUpdated = block.timestamp;
        
        // Check if quorum reached
        uint256 submissions = countSubmissions(feedId);
        if (submissions >= feeds[feedId].minFeeders) {
            emit QuorumReady(feedId, currentRound, submissions);
        }
        
        emit AuditLog(
            block.timestamp,
            msg.sender,
            "PRICE_SUBMITTED",
            keccak256(abi.encode(feedId, currentRound)),
            abi.encode(feedId, currentRound, price)
        );
        
        emit FeedUpdated(feedId, currentRound, msg.sender);
    }
    
    // ===== VIEW FUNCTIONS =====
    
    /**
     * @notice Get encrypted price for a feed
     * @param feedId Feed identifier
     * @return Encrypted price
     */
    function getEncryptedPrice(uint256 feedId) external view validFeedId returns (euint128) {
        return encryptedPrices[feedId];
    }
    
    /**
     * @notice Get feed information
     * @param feedId Feed identifier
     * @return Feed details
     */
    function getFeedInfo(uint256 feedId) external view validFeedId returns (
        string memory name,
        uint256 minFeeders,
        uint256 ttl,
        uint256 lastUpdated,
        uint256 roundId,
        bool active,
        uint256 createdAt
    ) {
        Feed storage feed = feeds[feedId];
        return (
            feed.name,
            feed.minFeeders,
            feed.ttl,
            feed.lastUpdated,
            feed.roundId,
            feed.active,
            feed.createdAt
        );
    }
    
    /**
     * @notice Get feeder information
     * @param feeder Feeder address
     * @return Feeder details
     */
    function getFeederInfo(address feeder) external view returns (
        bool active,
        uint256 stake,
        uint256 lastSubmission,
        uint256 reputationScore,
        uint256 submissionsCount
    ) {
        FeederInfo storage info = feeders[feeder];
        return (
            info.active,
            info.stake,
            info.lastSubmission,
            info.reputationScore,
            info.submissionsCount
        );
    }
    
    /**
     * @notice Check if feed is stale
     * @param feedId Feed identifier
     * @return Whether feed is stale
     */
    function isFeedStale(uint256 feedId) external view validFeedId returns (bool) {
        return block.timestamp > feeds[feedId].lastUpdated + feeds[feedId].ttl;
    }
    
    /**
     * @notice Get total number of active feeders
     * @return Number of active feeders
     */
    function getActiveFeederCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < feederList.length; i++) {
            if (feeders[feederList[i]].active) {
                count++;
            }
        }
        return count;
    }
    
    // ===== INTERNAL FUNCTIONS =====
    
    function isRateLimited(address feeder, uint256 feedId) internal view returns (bool) {
        RateLimit storage limit = rateLimits[feedId][feeder];
        
        if (block.timestamp >= limit.windowStart + RATE_LIMIT_WINDOW) {
            return false; // Window reset
        }
        
        return limit.submissionsInWindow >= MAX_SUBMISSIONS_PER_WINDOW;
    }
    
    function updateRateLimit(address feeder, uint256 feedId) internal {
        RateLimit storage limit = rateLimits[feedId][feeder];
        
        if (block.timestamp >= limit.windowStart + RATE_LIMIT_WINDOW) {
            // Reset window
            limit.windowStart = block.timestamp;
            limit.submissionsInWindow = 1;
        } else {
            limit.submissionsInWindow++;
        }
        
        limit.lastSubmission = block.timestamp;
    }
    
    function countSubmissions(uint256 feedId) internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < feederList.length; i++) {
            if (feeders[feederList[i]].hasSubmittedRound[feeds[feedId].roundId]) {
                count++;
            }
        }
        return count;
    }
    
    function clearPreviousSubmissions(uint256 feedId, uint256 roundId) internal {
        for (uint256 i = 0; i < feederList.length; i++) {
            feeders[feederList[i]].hasSubmittedRound[roundId] = false;
        }
    }
    
    function hasActiveObligations(address feeder) internal view returns (bool) {
        // Check if feeder has recent submissions or active alerts
        return block.timestamp <= feeders[feeder].lastSubmission + 3600; // 1 hour
    }
    
    function updateReputation(address feeder, bool success) internal {
        if (success) {
            feeders[feeder].reputationScore = feeders[feeder].reputationScore + 1;
        } else {
            if (feeders[feeder].reputationScore > 0) {
                feeders[feeder].reputationScore = feeders[feeder].reputationScore - 1;
            }
        }
    }
    
    // ===== EVENTS =====
    
    event FeedCreated(uint256 indexed feedId, string name, uint256 minFeeders, uint256 ttl);
    event FeederAdded(address indexed feeder);
    event FeederRemoved(address indexed feeder);
    event Staked(address indexed feeder, uint256 amount);
    event Unstaked(address indexed feeder, uint256 amount);
    event FeedUpdated(uint256 indexed feedId, uint256 roundId, address indexed feeder);
    event QuorumReady(uint256 indexed feedId, uint256 roundId, uint256 submissions);
    event EmergencyPaused(uint256 duration);
    
    // ===== FALLBACK =====
    
    receive() external payable {
        // Accept ETH for staking
    }
}
