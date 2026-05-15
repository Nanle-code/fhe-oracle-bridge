/**
 * performanceMonitor.js - Performance monitoring for FHE Oracle Bridge
 *
 * Tracks:
 *   - Gas usage patterns
 *   - Transaction latency
 *   - Error rates
 *   - System throughput
 *   - Resource utilization
 *
 * Usage: node scripts/monitoring/performanceMonitor.js --network <network>
 */

const { ethers } = require("hardhat");
const fs = require('fs').promises;
const path = require('path');
require("dotenv").config();

class PerformanceMonitor {
    constructor(network, provider) {
        this.network = network;
        this.provider = provider;
        this.metrics = [];
        this.thresholds = {
            maxGasPrice: 50, // Gwei
            maxLatency: 5000, // ms
            maxErrorRate: 0.05, // 5%
            minThroughput: 10 // tx/min
        };
        this.metricsFile = path.join(__dirname, `../data/performance_${network}.json`);
    }

    async startMonitoring() {
        console.log(`📈 Starting Performance Monitor - ${this.network.toUpperCase()}`);
        console.log("=" .repeat(50));
        
        // Load historical metrics
        await this.loadMetrics();
        
        // Start continuous monitoring
        this.monitoringInterval = setInterval(() => {
            this.collectMetrics();
        }, 60000); // Every minute
        
        // Graceful shutdown
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
        
        console.log("✅ Performance monitoring started");
        console.log("Press Ctrl+C to stop");
        
        // Initial metrics collection
        await this.collectMetrics();
    }

    async collectMetrics() {
        try {
            const timestamp = Date.now();
            
            // Collect network metrics
            const networkMetrics = await this.collectNetworkMetrics();
            
            // Collect system metrics
            const systemMetrics = await this.collectSystemMetrics();
            
            // Calculate performance metrics
            const performanceMetrics = this.calculatePerformanceMetrics(networkMetrics, systemMetrics);
            
            // Store metrics
            const metricEntry = {
                timestamp,
                network: this.network,
                ...networkMetrics,
                ...systemMetrics,
                ...performanceMetrics
            };
            
            this.metrics.push(metricEntry);
            await this.saveMetrics();
            
            // Check thresholds and alert
            await this.checkThresholds(metricEntry);
            
            // Display current metrics
            this.displayCurrentMetrics(metricEntry);
            
        } catch (error) {
            console.error("❌ Metrics collection failed:", error.message);
            await this.logError(error);
        }
    }

    async collectNetworkMetrics() {
        try {
            const [blockNumber, feeData] = await Promise.all([
                this.provider.getBlockNumber(),
                this.provider.getFeeData()
            ]);

            return {
                blockNumber,
                gasPrice: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : null,
                maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : null,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') : null
            };
        } catch (error) {
            return {
                error: `Network metrics failed: ${error.message}`
            };
        }
    }

    async collectSystemMetrics() {
        try {
            // Mock system metrics - in production, use actual system monitoring
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            return {
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024), // MB
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) // MB
                },
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system
                },
                uptime: Math.round(process.uptime())
            };
        } catch (error) {
            return {
                error: `System metrics failed: ${error.message}`
            };
        }
    }

    calculatePerformanceMetrics(networkMetrics, systemMetrics) {
        const recentMetrics = this.getRecentMetrics(60); // Last hour
        
        // Calculate gas trends
        const gasTrend = this.calculateTrend(recentMetrics, 'gasPrice');
        
        // Calculate error rate
        const errorRate = this.calculateErrorRate(recentMetrics);
        
        // Calculate throughput (mock data)
        const throughput = 15 + Math.random() * 10; // 15-25 tx/min
        
        // Calculate latency (mock data)
        const latency = 200 + Math.random() * 800; // 200-1000ms
        
        return {
            gasTrend,
            errorRate,
            throughput,
            latency,
            performance: this.calculatePerformanceScore(gasTrend, errorRate, throughput, latency)
        };
    }

    calculateTrend(metrics, field) {
        const validMetrics = metrics.filter(m => m[field] !== null && m[field] !== undefined);
        if (validMetrics.length < 2) return 'insufficient_data';
        
        const recent = validMetrics.slice(-5);
        const older = validMetrics.slice(-10, -5);
        
        if (recent.length === 0 || older.length === 0) return 'insufficient_data';
        
        const recentAvg = recent.reduce((sum, m) => sum + m[field], 0) / recent.length;
        const olderAvg = older.reduce((sum, m) => sum + m[field], 0) / older.length;
        
        const change = ((recentAvg - olderAvg) / olderAvg) * 100;
        
        if (Math.abs(change) < 5) return 'stable';
        return change > 0 ? 'increasing' : 'decreasing';
    }

    calculateErrorRate(metrics) {
        const errorCount = metrics.filter(m => m.error).length;
        return metrics.length > 0 ? errorCount / metrics.length : 0;
    }

    calculatePerformanceScore(gasTrend, errorRate, throughput, latency) {
        let score = 100;
        
        // Gas trend penalty
        if (gasTrend === 'increasing') score -= 10;
        else if (gasTrend === 'decreasing') score += 5;
        
        // Error rate penalty
        score -= errorRate * 100;
        
        // Throughput bonus/penalty
        if (throughput > this.thresholds.minThroughput) score += 5;
        else score -= 10;
        
        // Latency penalty
        if (latency > this.thresholds.maxLatency) {
            score -= (latency - this.thresholds.maxLatency) / 100;
        }
        
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    getRecentMetrics(minutes) {
        const cutoff = Date.now() - (minutes * 60 * 1000);
        return this.metrics.filter(m => m.timestamp > cutoff);
    }

    async checkThresholds(metrics) {
        const alerts = [];
        
        // Gas price threshold
        if (metrics.gasPrice && parseFloat(metrics.gasPrice) > this.thresholds.maxGasPrice) {
            alerts.push({
                severity: 'warning',
                type: 'gas_price',
                message: `High gas price: ${metrics.gasPrice} Gwei`
            });
        }
        
        // Latency threshold
        if (metrics.latency > this.thresholds.maxLatency) {
            alerts.push({
                severity: 'warning',
                type: 'latency',
                message: `High latency: ${Math.round(metrics.latency)}ms`
            });
        }
        
        // Error rate threshold
        if (metrics.errorRate > this.thresholds.maxErrorRate) {
            alerts.push({
                severity: 'error',
                type: 'error_rate',
                message: `High error rate: ${(metrics.errorRate * 100).toFixed(2)}%`
            });
        }
        
        // Throughput threshold
        if (metrics.throughput < this.thresholds.minThroughput) {
            alerts.push({
                severity: 'warning',
                type: 'throughput',
                message: `Low throughput: ${metrics.throughput.toFixed(1)} tx/min`
            });
        }
        
        if (alerts.length > 0) {
            await this.sendAlerts(alerts);
        }
    }

    displayCurrentMetrics(metrics) {
        console.log(`\n📊 Performance Metrics - ${new Date().toLocaleTimeString()}`);
        console.log("-".repeat(40));
        
        // Network metrics
        console.log("🌐 Network:");
        console.log(`   Block: ${metrics.blockNumber || 'N/A'}`);
        console.log(`   Gas Price: ${metrics.gasPrice ? `${metrics.gasPrice} Gwei` : 'N/A'}`);
        if (metrics.maxFeePerGas) {
            console.log(`   Max Fee: ${metrics.maxFeePerGas} Gwei`);
        }
        
        // Performance metrics
        console.log("\n⚡ Performance:");
        console.log(`   Latency: ${Math.round(metrics.latency)}ms`);
        console.log(`   Throughput: ${metrics.throughput.toFixed(1)} tx/min`);
        console.log(`   Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
        console.log(`   Gas Trend: ${metrics.gasTrend}`);
        console.log(`   Performance Score: ${metrics.performance}/100`);
        
        // System metrics
        if (metrics.memory) {
            console.log("\n💻 System:");
            console.log(`   Memory: ${metrics.memory.heapUsed}MB / ${metrics.memory.heapTotal}MB`);
            console.log(`   Uptime: ${Math.floor(metrics.uptime / 3600)}h ${Math.floor((metrics.uptime % 3600) / 60)}m`);
        }
        
        // Errors
        if (metrics.error) {
            console.log(`\n❌ Error: ${metrics.error}`);
        }
    }

    async sendAlerts(alerts) {
        console.log("\n🚨 Performance Alerts:");
        alerts.forEach(alert => {
            const icon = alert.severity === 'error' ? '🔴' : 
                         alert.severity === 'warning' ? '⚠️' : '📢';
            console.log(`${icon} ${alert.type}: ${alert.message}`);
        });
        
        // In production, send to monitoring system
        // await this.notificationService.sendAlerts(alerts);
    }

    async logError(error) {
        const errorLog = {
            timestamp: Date.now(),
            network: this.network,
            error: error.message,
            stack: error.stack
        };
        
        console.error("❌ Error logged:", errorLog);
        
        // In production, send to error tracking service
        // await this.errorTracking.logError(errorLog);
    }

    async loadMetrics() {
        try {
            const data = await fs.readFile(this.metricsFile, 'utf8');
            this.metrics = JSON.parse(data);
            console.log(`📂 Loaded ${this.metrics.length} historical metrics`);
        } catch (error) {
            console.log("📂 No existing metrics file, starting fresh");
            this.metrics = [];
        }
    }

    async saveMetrics() {
        try {
            // Keep only last 24 hours of metrics
            const cutoff = Date.now() - (24 * 60 * 60 * 1000);
            const recentMetrics = this.metrics.filter(m => m.timestamp > cutoff);
            
            await fs.writeFile(this.metricsFile, JSON.stringify(recentMetrics, null, 2));
        } catch (error) {
            console.error("❌ Failed to save metrics:", error.message);
        }
    }

    async generateReport(timeRange = '24h') {
        const cutoff = timeRange === '1h' ? Date.now() - (60 * 60 * 1000) :
                     timeRange === '6h' ? Date.now() - (6 * 60 * 60 * 1000) :
                     Date.now() - (24 * 60 * 60 * 1000); // 24h default
        
        const reportMetrics = this.metrics.filter(m => m.timestamp > cutoff);
        
        if (reportMetrics.length === 0) {
            console.log("📊 No metrics available for the specified time range");
            return;
        }
        
        console.log(`\n📈 Performance Report - ${timeRange.toUpperCase()}`);
        console.log("=" .repeat(40));
        
        // Calculate statistics
        const gasPrices = reportMetrics.filter(m => m.gasPrice).map(m => parseFloat(m.gasPrice));
        const latencies = reportMetrics.map(m => m.latency);
        const throughputs = reportMetrics.map(m => m.throughput);
        const performanceScores = reportMetrics.map(m => m.performance);
        
        console.log("\n📊 Statistics:");
        console.log(`   Data Points: ${reportMetrics.length}`);
        console.log(`   Time Range: ${timeRange}`);
        
        if (gasPrices.length > 0) {
            console.log(`\n⛽ Gas Price (Gwei):`);
            console.log(`   Average: ${(gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length).toFixed(2)}`);
            console.log(`   Min: ${Math.min(...gasPrices).toFixed(2)}`);
            console.log(`   Max: ${Math.max(...gasPrices).toFixed(2)}`);
        }
        
        console.log(`\n⚡ Latency (ms):`);
        console.log(`   Average: ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)}`);
        console.log(`   Min: ${Math.min(...latencies).toFixed(0)}`);
        console.log(`   Max: ${Math.max(...latencies).toFixed(0)}`);
        
        console.log(`\n📈 Throughput (tx/min):`);
        console.log(`   Average: ${(throughputs.reduce((a, b) => a + b, 0) / throughputs.length).toFixed(1)}`);
        console.log(`   Min: ${Math.min(...throughputs).toFixed(1)}`);
        console.log(`   Max: ${Math.max(...throughputs).toFixed(1)}`);
        
        console.log(`\n🎯 Performance Score:`);
        console.log(`   Average: ${(performanceScores.reduce((a, b) => a + b, 0) / performanceScores.length).toFixed(1)}`);
        console.log(`   Min: ${Math.min(...performanceScores)}`);
        console.log(`   Max: ${Math.max(...performanceScores)}`);
    }

    async shutdown() {
        console.log("\n🛑 Shutting down performance monitor...");
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        await this.saveMetrics();
        console.log("✅ Performance monitor stopped gracefully");
        
        process.exit(0);
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const networkIndex = args.indexOf('--network');
    const network = networkIndex !== -1 ? args[networkIndex + 1] : 'hardhat';
    
    const reportIndex = args.indexOf('--report');
    const timeRangeIndex = args.indexOf('--time-range');
    
    // Setup provider
    let provider;
    if (network === 'hardhat') {
        provider = ethers.provider;
    } else {
        const rpcUrl = process.env[`${network.toUpperCase()}_RPC`];
        if (!rpcUrl) {
            console.error(`RPC URL not configured for network: ${network}`);
            process.exit(1);
        }
        provider = new ethers.JsonRpcProvider(rpcUrl);
    }

    const monitor = new PerformanceMonitor(network, provider);
    
    if (reportIndex !== -1) {
        const timeRange = timeRangeIndex !== -1 ? args[timeRangeIndex + 1] : '24h';
        await monitor.generateReport(timeRange);
    } else {
        await monitor.startMonitoring();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error("Performance monitor failed:", error);
        process.exit(1);
    });
}

module.exports = PerformanceMonitor;
