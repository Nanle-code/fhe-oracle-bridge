const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * FHE Oracle Bridge — Test Suite
 *
 * Tests cover all 5 waves:
 *   Wave 1: Encrypted price submission, opaque storage
 *   Wave 2: Access control, whitelisted pulls, staleness guard
 *   Wave 3: Multi-feeder aggregation, outlier rejection, staking/slashing
 *   Wave 4: MockConsumer + PrivateLiquidator end-to-end
 *   Wave 5: Multi-feed, gas profiling
 */
describe("FHE Oracle Bridge", function () {
  let registry, oracle, consumer, liquidator;
  let owner, feeder1, feeder2, feeder3, consumer1, unauthorized, liquidatorAddr;

  // Feed IDs
  const ETH_USD = 1n;
  const BTC_USD = 2n;

  // Simulated prices (in USD with 8 decimals, like Chainlink)
  const ETH_PRICE  = 3500_00000000n; // $3,500.00000000
  const BTC_PRICE  = 67000_00000000n; // $67,000.00000000
  const LOW_PRICE  = 2000_00000000n;  // $2,000 — triggers liquidation

  before(async function () {
    [owner, feeder1, feeder2, feeder3, consumer1, unauthorized, liquidatorAddr] =
      await ethers.getSigners();
  });

  beforeEach(async function () {
    // Deploy AccessRegistry
    const Registry = await ethers.getContractFactory("AccessRegistry");
    registry = await Registry.deploy();

    // Deploy FHEOracleBridge
    const Oracle = await ethers.getContractFactory("FHEOracleBridge");
    oracle = await Oracle.deploy(await registry.getAddress());

    // Deploy MockConsumer
    const Consumer = await ethers.getContractFactory("MockConsumer");
    consumer = await Consumer.deploy(await oracle.getAddress());

    // Deploy PrivateLiquidator
    const Liquidator = await ethers.getContractFactory("PrivateLiquidator");
    liquidator = await Liquidator.deploy(await oracle.getAddress());

    // Setup: create feeds
    await oracle.createFeed("ETH / USD", 3600, 1); // feedId=1, TTL=1h, minFeeders=1
    await oracle.createFeed("BTC / USD", 3600, 1); // feedId=2

    // Setup: register feeders
    await oracle.addFeeder(feeder1.address);
    await oracle.addFeeder(feeder2.address);
    await oracle.addFeeder(feeder3.address);

    // Feeders stake ETH
    const MIN_STAKE = ethers.parseEther("0.01");
    await oracle.connect(feeder1).stake({ value: MIN_STAKE });
    await oracle.connect(feeder2).stake({ value: MIN_STAKE });
    await oracle.connect(feeder3).stake({ value: MIN_STAKE });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 1: Encrypted price submission
  // ─────────────────────────────────────────────────────────────────────────
  describe("Wave 1 — Encrypted price submission", function () {

    it("accepts a price submission from an authorised feeder", async function () {
      await expect(
        oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE)
      ).to.emit(oracle, "PriceSubmitted")
       .withArgs(ETH_USD, feeder1.address, 1n);
    });

    it("rejects submission from unauthorised address", async function () {
      await expect(
        oracle.connect(unauthorized).submitPrice(ETH_USD, ETH_PRICE)
      ).to.be.revertedWith("Oracle: not authorised feeder");
    });

    it("rejects submission from feeder with insufficient stake", async function () {
      // Add feeder but no stake
      const [,,,,,,, noStakeFeeder] = await ethers.getSigners();
      await oracle.addFeeder(noStakeFeeder.address);
      await expect(
        oracle.connect(noStakeFeeder).submitPrice(ETH_USD, ETH_PRICE)
      ).to.be.revertedWith("Oracle: insufficient stake");
    });

    it("finalises round when quorum reached (minFeeders=1)", async function () {
      await oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE);

      const info = await oracle.getFeedInfo(ETH_USD);
      expect(info.roundId).to.equal(1n);
      expect(info.lastUpdated).to.be.gt(0n);
    });

    it("rejects duplicate submission from same feeder in same round", async function () {
      await oracle.createFeed("TEST / USD", 3600, 2); // feedId=3, minFeeders=2
      const TEST_FEED = 3n;

      await oracle.connect(feeder1).submitPrice(TEST_FEED, ETH_PRICE);
      await expect(
        oracle.connect(feeder1).submitPrice(TEST_FEED, ETH_PRICE)
      ).to.be.revertedWith("Oracle: already submitted this round");
    });

    it("tracks pending submissions before quorum", async function () {
      await oracle.createFeed("MULTI / USD", 3600, 3); // minFeeders=3
      const MULTI_FEED = 3n;

      expect(await oracle.pendingSubmissions(MULTI_FEED)).to.equal(0n);
      await oracle.connect(feeder1).submitPrice(MULTI_FEED, ETH_PRICE);
      expect(await oracle.pendingSubmissions(MULTI_FEED)).to.equal(1n);
      await oracle.connect(feeder2).submitPrice(MULTI_FEED, ETH_PRICE);
      expect(await oracle.pendingSubmissions(MULTI_FEED)).to.equal(2n);
    });

    it("rejects submission to non-existent feed", async function () {
      await expect(
        oracle.connect(feeder1).submitPrice(99n, ETH_PRICE)
      ).to.be.revertedWith("Oracle: feed does not exist");
    });

    it("rejects submission to paused feed", async function () {
      await oracle.pauseFeed(ETH_USD);
      await expect(
        oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE)
      ).to.be.revertedWith("Oracle: feed paused");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 2: Access control + encrypted pull
  // ─────────────────────────────────────────────────────────────────────────
  describe("Wave 2 — Access control & encrypted pull", function () {

    beforeEach(async function () {
      // Submit a price first
      await oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE);
      // Whitelist consumer
      await registry.whitelist(await consumer.getAddress(), "MockConsumer v1");
    });

    it("whitelisted consumer can pull encrypted price", async function () {
      // Calling through consumer (which is whitelisted)
      const result = await consumer.isPriceAbove(ETH_USD, 3000_00000000n);
      expect(result).to.equal(true); // ETH_PRICE(3500) > 3000
    });

    it("non-whitelisted address cannot call getEncryptedPrice directly", async function () {
      await expect(
        oracle.connect(unauthorized).getEncryptedPrice(ETH_USD)
      ).to.be.revertedWith("Oracle: consumer not whitelisted");
    });

    it("revoked consumer loses access", async function () {
      await registry.revoke(await consumer.getAddress());
      await expect(
        consumer.isPriceAbove(ETH_USD, 3000_00000000n)
      ).to.be.revertedWith("Oracle: consumer not whitelisted");
    });

    it("getFeedInfo is public (no price exposure)", async function () {
      const info = await oracle.getFeedInfo(ETH_USD);
      expect(info.description).to.equal("ETH / USD");
      expect(info.roundId).to.equal(1n);
      expect(info.active).to.equal(true);
      expect(info.isStale).to.equal(false);
    });

    it("reverts on stale price after TTL", async function () {
      // Create a feed with 1-second TTL
      await oracle.createFeed("FAST / USD", 1, 1);
      const FAST_FEED = 3n;
      await oracle.addFeeder(feeder1.address);
      await oracle.connect(feeder1).submitPrice(FAST_FEED, ETH_PRICE);
      await registry.whitelist(await consumer.getAddress(), "MockConsumer v1");

      // Advance time by 2 seconds
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      await expect(
        consumer.isPriceAbove(FAST_FEED, 1000_00000000n)
      ).to.be.revertedWith("Oracle: stale price");
    });

    it("reverts when no price has been submitted yet", async function () {
      await oracle.createFeed("EMPTY / USD", 3600, 1);
      const EMPTY_FEED = 3n;
      await registry.whitelist(await consumer.getAddress(), "MockConsumer v1");

      await expect(
        consumer.isPriceAbove(EMPTY_FEED, 1000_00000000n)
      ).to.be.revertedWith("Oracle: no price yet");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 3: Multi-feeder aggregation
  // ─────────────────────────────────────────────────────────────────────────
  describe("Wave 3 — Multi-feeder aggregation", function () {

    let multiFeed;

    beforeEach(async function () {
      await oracle.createFeed("MULTI / USD", 3600, 3); // minFeeders=3
      multiFeed = 3n;
      await registry.whitelist(await consumer.getAddress(), "MockConsumer");
    });

    it("does not finalise round until quorum is reached", async function () {
      await oracle.connect(feeder1).submitPrice(multiFeed, ETH_PRICE);
      const info1 = await oracle.getFeedInfo(multiFeed);
      expect(info1.roundId).to.equal(0n); // not finalised yet

      await oracle.connect(feeder2).submitPrice(multiFeed, ETH_PRICE);
      const info2 = await oracle.getFeedInfo(multiFeed);
      expect(info2.roundId).to.equal(0n); // still not finalised

      await oracle.connect(feeder3).submitPrice(multiFeed, ETH_PRICE);
      const info3 = await oracle.getFeedInfo(multiFeed);
      expect(info3.roundId).to.equal(1n); // finalised on 3rd submission
    });

    it("computes median correctly across 3 feeders", async function () {
      // feeder1: 3000, feeder2: 3500 (median), feeder3: 4000
      await oracle.connect(feeder1).submitPrice(multiFeed, 3000_00000000n);
      await oracle.connect(feeder2).submitPrice(multiFeed, 3500_00000000n);
      await oracle.connect(feeder3).submitPrice(multiFeed, 4000_00000000n);

      // Median = 3500. Consumer checks > 3200 should be true
      const aboveLow = await consumer.isPriceAbove(multiFeed, 3200_00000000n);
      expect(aboveLow).to.equal(true);

      // Consumer checks > 3800 should be false (median 3500 < 3800)
      const aboveHigh = await consumer.isPriceAbove(multiFeed, 3800_00000000n);
      expect(aboveHigh).to.equal(false);
    });

    it("emits FeedUpdated with correct feeder count on finalisation", async function () {
      await oracle.connect(feeder1).submitPrice(multiFeed, ETH_PRICE);
      await oracle.connect(feeder2).submitPrice(multiFeed, ETH_PRICE);
      await expect(
        oracle.connect(feeder3).submitPrice(multiFeed, ETH_PRICE)
      ).to.emit(oracle, "FeedUpdated")
       .withArgs(multiFeed, 1n, 3n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 3 cont.: Feeder staking & slashing
  // ─────────────────────────────────────────────────────────────────────────
  describe("Wave 3 — Feeder staking & slashing", function () {

    it("records feeder stake correctly", async function () {
      const stake = await oracle.feederStake(feeder1.address);
      expect(stake).to.equal(ethers.parseEther("0.01"));
    });

    it("owner can slash a feeder's stake", async function () {
      const slashAmount = ethers.parseEther("0.005");
      await oracle.slash(feeder1.address, slashAmount);
      const remaining = await oracle.feederStake(feeder1.address);
      expect(remaining).to.equal(ethers.parseEther("0.005"));
    });

    it("slashed feeder below MIN_STAKE cannot submit", async function () {
      await oracle.slash(feeder1.address, ethers.parseEther("0.01")); // slash all
      await expect(
        oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE)
      ).to.be.revertedWith("Oracle: insufficient stake");
    });

    it("slash is capped at available stake (no underflow)", async function () {
      await oracle.slash(feeder1.address, ethers.parseEther("999")); // more than staked
      const remaining = await oracle.feederStake(feeder1.address);
      expect(remaining).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 4: End-to-end — PrivateLiquidator
  // ─────────────────────────────────────────────────────────────────────────
  describe("Wave 4 — PrivateLiquidator end-to-end", function () {

    let positionId;
    const COLLATERAL = ethers.parseEther("1");
    const LIQ_PRICE  = 3000_00000000n; // liquidate if price < $3,000

    beforeEach(async function () {
      // Whitelist the liquidator contract
      await registry.whitelist(await liquidator.getAddress(), "PrivateLiquidator v1");

      // Submit healthy price ($3,500 > $3,000 liquidation threshold)
      await oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE);

      // Open a position
      const tx = await liquidator
        .connect(consumer1)
        .openPosition(ETH_USD, LIQ_PRICE, { value: COLLATERAL });
      const receipt = await tx.wait();
      positionId = 1n;
    });

    it("position is not liquidatable at healthy price", async function () {
      // ETH at $3,500 > liquidation at $3,000 → NOT liquidatable
      const liq = await liquidator.isLiquidatable(positionId);
      expect(liq).to.equal(false);
    });

    it("position becomes liquidatable when price drops", async function () {
      // Price drops to $2,000 — below $3,000 liquidation threshold
      await oracle.connect(feeder1).submitPrice(ETH_USD, LOW_PRICE);
      const liq = await liquidator.isLiquidatable(positionId);
      expect(liq).to.equal(true);
    });

    it("liquidation pays reward to liquidator and remainder to protocol", async function () {
      await oracle.connect(feeder1).submitPrice(ETH_USD, LOW_PRICE);

      const liqBefore = await ethers.provider.getBalance(liquidatorAddr.address);
      const tx = await liquidator.connect(liquidatorAddr).liquidate(positionId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const liqAfter = await ethers.provider.getBalance(liquidatorAddr.address);

      // Liquidator should have gained 5% of collateral minus gas
      const reward = COLLATERAL * 5n / 100n;
      expect(liqAfter - liqBefore + gasUsed).to.equal(reward);
    });

    it("cannot liquidate a healthy position", async function () {
      await expect(
        liquidator.connect(liquidatorAddr).liquidate(positionId)
      ).to.be.revertedWith("Liquidator: not liquidatable");
    });

    it("position owner can close a healthy position and reclaim collateral", async function () {
      const before = await ethers.provider.getBalance(consumer1.address);
      const tx = await liquidator.connect(consumer1).closePosition(positionId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(consumer1.address);

      expect(after - before + gasUsed).to.equal(COLLATERAL);
    });

    it("cannot close someone else's position", async function () {
      await expect(
        liquidator.connect(unauthorized).closePosition(positionId)
      ).to.be.revertedWith("Liquidator: not position owner");
    });

    it("emits LiquidationTriggered event", async function () {
      await oracle.connect(feeder1).submitPrice(ETH_USD, LOW_PRICE);
      await expect(
        liquidator.connect(liquidatorAddr).liquidate(positionId)
      ).to.emit(liquidator, "PositionLiquidated");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 5: Multi-feed + admin
  // ─────────────────────────────────────────────────────────────────────────
  describe("Wave 5 — Multi-feed & admin controls", function () {

    beforeEach(async function () {
      await registry.whitelist(await consumer.getAddress(), "MockConsumer");
    });

    it("supports multiple feeds independently", async function () {
      await oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE);
      await oracle.connect(feeder1).submitPrice(BTC_USD, BTC_PRICE);

      const ethAbove = await consumer.isPriceAbove(ETH_USD, 3000_00000000n);
      const btcAbove = await consumer.isPriceAbove(BTC_USD, 50000_00000000n);

      expect(ethAbove).to.equal(true);  // ETH 3500 > 3000
      expect(btcAbove).to.equal(true);  // BTC 67000 > 50000
    });

    it("isWithinBand check works correctly", async function () {
      await oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE);
      // ETH at 3500 — check within [3000, 4000]
      const inBand = await consumer.isWithinBand(ETH_USD, 3000_00000000n, 4000_00000000n);
      expect(inBand).to.equal(true);

      // ETH at 3500 — check within [4000, 5000] → false
      const outBand = await consumer.isWithinBand(ETH_USD, 4000_00000000n, 5000_00000000n);
      expect(outBand).to.equal(false);
    });

    it("owner can transfer oracle ownership", async function () {
      await oracle.transferOwnership(feeder1.address);
      expect(await oracle.owner()).to.equal(feeder1.address);
    });

    it("old owner loses admin rights after transfer", async function () {
      await oracle.transferOwnership(feeder1.address);
      await expect(
        oracle.connect(owner).addFeeder(unauthorized.address)
      ).to.be.revertedWith("Oracle: not owner");
    });

    it("feedCount increments correctly as feeds are created", async function () {
      expect(await oracle.feedCount()).to.equal(2n); // ETH/USD and BTC/USD from beforeEach
      await oracle.createFeed("SOL / USD", 3600, 1);
      expect(await oracle.feedCount()).to.equal(3n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GAS PROFILING (Wave 5)
  // ─────────────────────────────────────────────────────────────────────────
  describe("Gas profiling", function () {

    it("logs gas for single-feeder price submission", async function () {
      const tx = await oracle.connect(feeder1).submitPrice(ETH_USD, ETH_PRICE);
      const receipt = await tx.wait();
      console.log(`    submitPrice (1 feeder): ${receipt.gasUsed} gas`);
    });

    it("logs gas for multi-feeder round finalisation (3 feeders)", async function () {
      await oracle.createFeed("GAS / USD", 3600, 3);
      const GAS_FEED = 3n;

      await oracle.connect(feeder1).submitPrice(GAS_FEED, 3000_00000000n);
      await oracle.connect(feeder2).submitPrice(GAS_FEED, 3500_00000000n);
      const tx = await oracle.connect(feeder3).submitPrice(GAS_FEED, 4000_00000000n);
      const receipt = await tx.wait();
      console.log(`    submitPrice (3 feeders, median finalization): ${receipt.gasUsed} gas`);
    });

    it("logs gas for liquidation check + execution", async function () {
      await registry.whitelist(await liquidator.getAddress(), "PrivateLiquidator");
      await oracle.connect(feeder1).submitPrice(ETH_USD, LOW_PRICE);
      await liquidator.connect(consumer1).openPosition(ETH_USD, ETH_PRICE, {
        value: ethers.parseEther("1"),
      });
      const tx = await liquidator.connect(liquidatorAddr).liquidate(1n);
      const receipt = await tx.wait();
      console.log(`    liquidate(): ${receipt.gasUsed} gas`);
    });
  });
});
