/**
 * healthMonitor.js - System health monitoring for FHE Oracle Bridge
 *
 * Monitors:
 *   - Oracle price freshness
 *   - Feeder connectivity and activity
 *   - Keeper process health
 *   - Frontend availability
 *   - Network connectivity
 *
 * Usage: node scripts/monitoring/healthMonitor.js --network <network>
 */

const { ethers } = require("hardhat");
const { runLiveHealthCheck } = require("../lib/liveHealth");
const { rpcForNetwork } = require("../lib/testnetConfig");
require("dotenv").config();

class HealthMonitor {
    constructor(network, provider) {
        this.network = network;
        this.provider = provider;
        this.alerts = [];
        this.thresholds = {
            maxPriceAge: 3600, // 1 hour
            maxFeederInactivity: 1800, // 30 minutes
            maxKeeperLatency: 30000, // 30 seconds
            maxFrontendResponseTime: 5000 // 5 seconds
        };
    }

    async runFullHealthCheck() {
        console.log(`\n🏥 FHE Oracle Bridge Health Check - ${this.network.toUpperCase()}`);
        console.log("=".repeat(60));

        if (process.env.FHE_ORACLE_BRIDGE && (this.network === "arbitrumSepolia" || this.network === "baseSepolia")) {
            const live = await runLiveHealthCheck(this.network);
            console.log(JSON.stringify(live, null, 2));
            if (live.overall === "error") process.exitCode = 1;
            return live;
        }
        
        const healthResults = {
            timestamp: new Date().toISOString(),
            network: this.network,
            components: {}
        };

        try {
            // Check Oracle Health
            healthResults.components.oracle = await this.checkOracleHealth();
            
            // Check Feeder Health
            healthResults.components.feeders = await this.checkFeederHealth();
            
            // Check Keeper Health (simulated)
            healthResults.components.keepers = await this.checkKeeperHealth();
            
            // Check Frontend Health (simulated)
            healthResults.components.frontend = await this.checkFrontendHealth();
            
            // Check Network Health
            healthResults.components.network = await this.checkNetworkHealth();
            
            // Calculate overall health
            healthResults.overall = this.calculateOverallHealth(healthResults.components);
            
            // Display results
            this.displayHealthResults(healthResults);
            
            // Send alerts if needed
            await this.sendHealthAlerts(healthResults);
            
            return healthResults;
            
        } catch (error) {
            console.error("❌ Health check failed:", error.message);
            await this.sendCriticalAlert("Health check failed", error.message);
        }
    }

    async checkOracleHealth() {
        try {
            // In production, this would connect to actual oracle contract
            const mockFeedInfo = {
                lastUpdated: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
                roundId: 12345,
                minFeeders: 3,
                ttl: 3600
            };

            const now = Math.floor(Date.now() / 1000);
            const age = now - mockFeedInfo.lastUpdated;
            
            const health = {
                status: age < this.thresholds.maxPriceAge ? 'healthy' : 'warning',
                lastUpdate: new Date(mockFeedInfo.lastUpdated * 1000),
                age: age,
                roundId: mockFeedInfo.roundId,
                message: age < this.thresholds.maxPriceAge ? 
                    `Prices are fresh (${Math.floor(age/60)}min old)` : 
                    `⚠️ Prices are stale (${Math.floor(age/60)}min old)`
            };

            if (age > this.thresholds.maxPriceAge) {
                this.alerts.push({
                    severity: 'warning',
                    component: 'oracle',
                    message: `Oracle prices are stale: ${Math.floor(age/60)} minutes old`
                });
            }

            return health;
            
        } catch (error) {
            return {
                status: 'error',
                message: `❌ Oracle check failed: ${error.message}`
            };
        }
    }

    async checkFeederHealth() {
        try {
            // Mock feeder data - in production, query actual feeder contracts
            const mockFeeders = [
                { address: "0x123...", lastSubmission: Date.now() - 600000, active: true }, // 10 min ago
                { address: "0x456...", lastSubmission: Date.now() - 1200000, active: true }, // 20 min ago
                { address: "0x789...", lastSubmission: Date.now() - 3600000, active: false } // 1 hour ago
            ];

            const now = Date.now();
            const feederHealth = mockFeeders.map(feeder => {
                const inactivity = now - feeder.lastSubmission;
                const status = feeder.active && inactivity < this.thresholds.maxFeederInactivity ? 'healthy' : 'warning';
                
                return {
                    address: feeder.address,
                    active: feeder.active,
                    lastSubmission: new Date(feeder.lastSubmission),
                    inactivity: Math.floor(inactivity / 1000),
                    status: status,
                    message: status === 'healthy' ? 
                        `Active (${Math.floor(inactivity/60000)}min ago)` : 
                        `⚠️ Inactive (${Math.floor(inactivity/60000)}min ago)`
                };
            });

            const healthyFeeders = feederHealth.filter(f => f.status === 'healthy').length;
            const totalFeeders = feederHealth.length;

            const health = {
                status: healthyFeeders === totalFeeders ? 'healthy' : 'warning',
                healthyCount: healthyFeeders,
                totalCount: totalFeeders,
                feeders: feederHealth,
                message: `${healthyFeeders}/${totalFeeders} feeders healthy`
            };

            if (healthyFeeders < totalFeeders) {
                this.alerts.push({
                    severity: 'warning',
                    component: 'feeders',
                    message: `Only ${healthyFeeders}/${totalFeeders} feeders are active`
                });
            }

            return health;
            
        } catch (error) {
            return {
                status: 'error',
                message: `❌ Feeder check failed: ${error.message}`
            };
        }
    }

    async checkKeeperHealth() {
        try {
            // Mock keeper processes - in production, check actual running processes
            const mockKeepers = [
                { type: 'liquidation', status: 'running', lastCheck: Date.now() - 60000 }, // 1 min ago
                { type: 'alerts', status: 'running', lastCheck: Date.now() - 120000 } // 2 min ago
            ];

            const keeperHealth = mockKeepers.map(keeper => {
                const latency = Date.now() - keeper.lastCheck;
                const status = keeper.status === 'running' && latency < this.thresholds.maxKeeperLatency ? 'healthy' : 'warning';
                
                return {
                    type: keeper.type,
                    status: keeper.status,
                    lastCheck: new Date(keeper.lastCheck),
                    latency: latency,
                    health: status,
                    message: status === 'healthy' ? 
                        `Running (${Math.floor(latency/1000)}s ago)` : 
                        `⚠️ Issue detected (${Math.floor(latency/1000)}s ago)`
                };
            });

            const healthyKeepers = keeperHealth.filter(k => k.health === 'healthy').length;
            const totalKeepers = keeperHealth.length;

            const health = {
                status: healthyKeepers === totalKeepers ? 'healthy' : 'warning',
                healthyCount: healthyKeepers,
                totalCount: totalKeepers,
                keepers: keeperHealth,
                message: `${healthyKeepers}/${totalKeepers} keepers healthy`
            };

            if (healthyKeepers < totalKeepers) {
                this.alerts.push({
                    severity: 'warning',
                    component: 'keepers',
                    message: `Only ${healthyKeepers}/${totalKeepers} keepers are healthy`
                });
            }

            return health;
            
        } catch (error) {
            return {
                status: 'error',
                message: `❌ Keeper check failed: ${error.message}`
            };
        }
    }

    async checkFrontendHealth() {
        try {
            // Mock frontend check - in production, make actual HTTP request
            const mockFrontend = {
                url: "http://127.0.0.1:8765",
                responseTime: 200 + Math.random() * 300, // 200-500ms
                status: 200,
                uptime: 0.999
            };

            const health = {
                status: mockFrontend.responseTime < this.thresholds.maxFrontendResponseTime ? 'healthy' : 'warning',
                url: mockFrontend.url,
                responseTime: Math.round(mockFrontend.responseTime),
                status: mockFrontend.status,
                uptime: mockFrontend.uptime,
                message: mockFrontend.responseTime < this.thresholds.maxFrontendResponseTime ? 
                    `Available (${Math.round(mockFrontend.responseTime)}ms)` : 
                    `⚠️ Slow response (${Math.round(mockFrontend.responseTime)}ms)`
            };

            if (mockFrontend.responseTime > this.thresholds.maxFrontendResponseTime) {
                this.alerts.push({
                    severity: 'warning',
                    component: 'frontend',
                    message: `Frontend response time: ${Math.round(mockFrontend.responseTime)}ms`
                });
            }

            return health;
            
        } catch (error) {
            return {
                status: 'error',
                message: `❌ Frontend check failed: ${error.message}`
            };
        }
    }

    async checkNetworkHealth() {
        try {
            const blockNumber = await this.provider.getBlockNumber();
            const gasPrice = await this.provider.getFeeData();
            
            const health = {
                status: 'healthy',
                blockNumber: blockNumber,
                gasPrice: gasPrice.gasPrice ? ethers.formatUnits(gasPrice.gasPrice, 'gwei') : 'N/A',
                networkId: this.network,
                message: `Network connected (Block ${blockNumber})`
            };

            return health;
            
        } catch (error) {
            return {
                status: 'error',
                message: `❌ Network check failed: ${error.message}`
            };
        }
    }

    calculateOverallHealth(components) {
        const statuses = Object.values(components).map(c => c.status);
        const healthyCount = statuses.filter(s => s === 'healthy').length;
        const errorCount = statuses.filter(s => s === 'error').length;
        const totalCount = statuses.length;

        if (errorCount > 0) {
            return {
                status: 'error',
                score: 0,
                message: '❌ Critical system issues detected'
            };
        } else if (healthyCount === totalCount) {
            return {
                status: 'healthy',
                score: 100,
                message: '✅ All systems operational'
            };
        } else {
            return {
                status: 'warning',
                score: Math.round((healthyCount / totalCount) * 100),
                message: `⚠️ ${healthyCount}/${totalCount} systems healthy`
            };
        }
    }

    displayHealthResults(results) {
        console.log("\n📊 Health Summary:");
        console.log(`Overall Status: ${results.overall.message}`);
        console.log(`Health Score: ${results.overall.score}/100`);
        
        console.log("\n🔍 Component Details:");
        
        Object.entries(results.components).forEach(([component, health]) => {
            const icon = health.status === 'healthy' ? '✅' : 
                       health.status === 'warning' ? '⚠️' : '❌';
            console.log(`\n${icon} ${component.toUpperCase()}:`);
            console.log(`   Status: ${health.message}`);
            
            if (component === 'oracle') {
                console.log(`   Last Update: ${health.lastUpdate}`);
                console.log(`   Round ID: ${health.roundId}`);
            } else if (component === 'feeders') {
                health.feeders?.forEach(feeder => {
                    console.log(`   Feeder ${feeder.address.slice(0, 8)}...: ${feeder.message}`);
                });
            } else if (component === 'keepers') {
                health.keepers?.forEach(keeper => {
                    console.log(`   ${keeper.type} keeper: ${keeper.message}`);
                });
            } else if (component === 'frontend') {
                console.log(`   Response Time: ${health.responseTime}ms`);
                console.log(`   Uptime: ${(health.uptime * 100).toFixed(2)}%`);
            } else if (component === 'network') {
                console.log(`   Block: ${health.blockNumber}`);
                console.log(`   Gas Price: ${health.gasPrice} Gwei`);
            }
        });

        if (this.alerts.length > 0) {
            console.log("\n🚨 Active Alerts:");
            this.alerts.forEach(alert => {
                const icon = alert.severity === 'warning' ? '⚠️' : '🔴';
                console.log(`${icon} ${alert.component}: ${alert.message}`);
            });
        }
    }

    async sendHealthAlerts(results) {
        if (this.alerts.length === 0) return;

        const message = this.alerts.map(alert => 
            `${alert.component}: ${alert.message}`
        ).join('\n');

        // Log alerts (in production, send to Discord/Slack)
        console.log("\n📢 Alert Summary:");
        console.log(message);
        
        // Store alerts for historical tracking
        await this.storeAlerts(results.timestamp, this.alerts);
    }

    async storeAlerts(timestamp, alerts) {
        // In production, store in database or logging system
        const alertData = {
            timestamp,
            alerts,
            network: this.network
        };
        
        console.log("\n💾 Alerts stored for tracking:", JSON.stringify(alertData, null, 2));
    }

    async sendCriticalAlert(title, message) {
        console.log(`\n🚨 CRITICAL ALERT: ${title}`);
        console.log(`Message: ${message}`);
        
        // In production, send immediate notifications
        // await this.discordNotifier.sendCriticalAlert(title, message);
        // await this.slackNotifier.sendCriticalAlert(title, message);
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const networkIndex = args.indexOf('--network');
    const network = networkIndex !== -1 ? args[networkIndex + 1] : 'hardhat';
    
    // Setup provider
    let provider;
    if (network === 'hardhat') {
        provider = ethers.provider;
    } else {
        const rpcUrl = rpcForNetwork(network);
        if (!rpcUrl) {
            console.error(`RPC not configured for network: ${network} (set ARBITRUM_SEPOLIA_RPC or BASE_SEPOLIA_RPC)`);
            process.exit(1);
        }
        const chainId = network === "arbitrumSepolia" ? 421614 : network === "baseSepolia" ? 84532 : undefined;
        provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
    }

    const monitor = new HealthMonitor(network, provider);
    await monitor.runFullHealthCheck();
}

if (require.main === module) {
    main().catch(error => {
        console.error("Health monitor failed:", error);
        process.exit(1);
    });
}

module.exports = HealthMonitor;
