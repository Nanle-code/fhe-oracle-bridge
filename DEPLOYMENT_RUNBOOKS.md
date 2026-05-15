# FHE Oracle Bridge - Deployment Runbooks & Monitoring

## Overview

This document provides comprehensive deployment runbooks and monitoring procedures for the FHE Oracle Bridge system across different environments. It covers deployment strategies, operational procedures, and monitoring best practices.

## Table of Contents

1. [Environment Setup](#environment-setup)
2. [Local Development](#local-development)
3. [Testnet Deployment](#testnet-deployment)
4. [Production Deployment](#production-deployment)
5. [Monitoring Setup](#monitoring-setup)
6. [Operational Procedures](#operational-procedures)
7. [Troubleshooting](#troubleshooting)
8. [Emergency Procedures](#emergency-procedures)

## Environment Setup

### Prerequisites

```bash
# Node.js version
node --version  # Should be v18.0.0+

# Install dependencies
npm install

# Environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Required Environment Variables

```bash
# Network Configuration
PRIVATE_KEY=your_private_key_here
ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
BASE_SEPOLIA_RPC=https://sepolia.base.org

# Contract Addresses (after deployment)
ACCESS_REGISTRY=0x...
FHE_ORACLE_BRIDGE=0x...
PRIVATE_LIQUIDATOR=0x...
PRIVATE_THRESHOLD_ALERTS=0x...

# Keeper Configuration
KEEPER_POLL_MS=8000
KEEPER_FROM_BLOCK=0
KEEPER_LOG_JSON=1

# Monitoring
DISCORD_WEBHOOK_URL=your_discord_webhook
SLACK_WEBHOOK_URL=your_slack_webhook
```

### Network Configuration

| Network | RPC URL | Chain ID | Environment |
|----------|-----------|-----------|-------------|
| Hardhat | http://127.0.0.1:8545 | 31337 | Local |
| Arbitrum Sepolia | https://sepolia-rollup.arbitrum.io/rpc | 421614 | Testnet |
| Base Sepolia | https://sepolia.base.org | 84532 | Testnet |

## Local Development

### Quick Start

```bash
# 1. Start local hardhat network
npm run node

# 2. Deploy contracts (new terminal)
npm run deploy:hardhat

# 3. Run frontend (new terminal)
npm run frontend

# 4. Start feeder daemon (new terminal)
npm run feeder:hardhat
```

### Local Testing Runbook

#### Step 1: Environment Validation
```bash
# Check network connectivity
npx hardhat run scripts/validateEnvironment.js --network hardhat

# Verify contract deployment
npx hardhat run scripts/verifyDeployment.js --network hardhat
```

#### Step 2: System Integration Test
```bash
# Run complete system test
npx hardhat run scripts/demoFlow.js --network hardhat

# Test liquidation system
npx hardhat run scripts/demoLiquidationKeeper.js --network hardhat

# Test multi-feeder aggregation
npx hardhat run scripts/demoMultiFeeder.js --network hardhat

# Test threshold alerts
npx hardhat run scripts/demoThresholdAlerts.js --network hardhat
```

#### Step 3: Frontend Validation
```bash
# Access frontend at http://127.0.0.1:8765/
# Verify:
# - Network status indicator
# - Price feed updates
# - Event log activity
# - Performance metrics
```

## Testnet Deployment

### Arbitrum Sepolia Deployment

#### Pre-Deployment Checklist

- [ ] Private key funded with test ETH
- [ ] RPC endpoint accessible
- [ ] Environment variables configured
- [ ] Contract code audited
- [ ] Test scripts passing locally

#### Deployment Procedure

```bash
# 1. Deploy core contracts
npm run deploy:arbitrum-sepolia

# 2. Verify contracts on Arbiscan
npx hardhat verify --network arbitrumSepolia <contract-address> <constructor-args>

# 3. Update frontend configuration
cp contracts/deployments/arbitrumSepolia.json frontend/config.json

# 4. Start feeder daemon
npm run feeder:arbitrum-sepolia

# 5. Start liquidation keeper
npm run keeper:liquidation:arbitrum-sepolia

# 6. Start threshold alerts keeper
npm run keeper:alerts:arbitrum-sepolia
```

#### Post-Deployment Validation

```bash
# Verify contract deployment
npx hardhat run scripts/verifyTestnetDeployment.js --network arbitrumSepolia

# Test price submission
npx hardhat run scripts/testPriceSubmission.js --network arbitrumSepolia

# Test liquidation flow
npx hardhat run scripts/testLiquidation.js --network arbitrumSepolia

# Test threshold alerts
npx hardhat run scripts/testThresholdAlerts.js --network arbitrumSepolia
```

### Base Sepolia Deployment

```bash
# Similar procedure for Base Sepolia
npm run deploy:base-sepolia

# Update configuration for Base Sepolia
# Start keepers with Base Sepolia network
```

## Production Deployment

### Pre-Production Checklist

#### Security Review
- [ ] Smart contract audit completed
- [ ] Security assessment passed
- [ ] Penetration testing completed
- [ ] Multi-signature wallet setup
- [ ] Access control reviewed

#### Infrastructure Readiness
- [ ] Production RPC endpoints configured
- [ ] Monitoring systems deployed
- [ ] Alerting configured
- [ ] Backup procedures tested
- [ ] Disaster recovery planned

#### Economic Parameters
- [ ] Staking amounts finalized
- [ ] Fee structures set
- [ ] Reward mechanisms configured
- [ ] Slashing parameters defined

### Production Deployment Procedure

#### Phase 1: Infrastructure Setup

```bash
# 1. Deploy to production network
npm run deploy:mainnet

# 2. Configure production monitoring
npm run setup:monitoring

# 3. Deploy production frontend
npm run deploy:frontend:prod

# 4. Configure production keepers
npm run setup:keepers:prod
```

#### Phase 2: Service Startup

```bash
# 1. Start feeder daemons
npm run feeder:production

# 2. Start liquidation keepers
npm run keeper:liquidation:production

# 3. Start threshold alerts keepers
npm run keeper:alerts:production

# 4. Start monitoring services
npm run monitoring:start
```

#### Phase 3: Validation

```bash
# 1. System health check
npm run health:check

# 2. Load testing
npm run test:load

# 3. Security validation
npm run test:security

# 4. Performance benchmarking
npm run test:performance
```

## Monitoring Setup

### System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend     │    │   Keepers      │    │   Monitoring   │
│   Dashboard    │◄──►│   (Liquidation, │◄──►│   System       │
│                │    │    Alerts)     │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   Blockchain   │
                    │   Network     │
                    └─────────────────┘
```

### Monitoring Components

#### 1. Health Monitoring

```javascript
// healthMonitor.js
class HealthMonitor {
    async checkSystemHealth() {
        const health = {
            oracle: await this.checkOracleHealth(),
            feeders: await this.checkFeederHealth(),
            keepers: await this.checkKeeperHealth(),
            frontend: await this.checkFrontendHealth()
        };
        
        return this.calculateOverallHealth(health);
    }
    
    async checkOracleHealth() {
        const feedInfo = await this.oracle.getFeedInfo(1n);
        const lastUpdate = Number(feedInfo.lastUpdated);
        const now = Math.floor(Date.now() / 1000);
        const age = now - lastUpdate;
        
        return {
            status: age < 3600 ? 'healthy' : 'stale',
            lastUpdate: new Date(lastUpdate * 1000),
            age: age
        };
    }
}
```

#### 2. Performance Monitoring

```javascript
// performanceMonitor.js
class PerformanceMonitor {
    trackMetrics(operation, duration, gasUsed) {
        const metrics = {
            timestamp: Date.now(),
            operation: operation,
            duration: duration,
            gasUsed: gasUsed,
            success: true
        };
        
        this.storeMetrics(metrics);
        this.checkThresholds(metrics);
    }
    
    checkThresholds(metrics) {
        if (metrics.duration > this.SLA_DURATION) {
            this.alert(`Performance degradation: ${metrics.operation} took ${metrics.duration}ms`);
        }
        
        if (metrics.gasUsed > this.MAX_GAS) {
            this.alert(`High gas usage: ${metrics.operation} used ${metrics.gasUsed} gas`);
        }
    }
}
```

#### 3. Error Monitoring

```javascript
// errorMonitor.js
class ErrorMonitor {
    trackError(error, context) {
        const errorData = {
            timestamp: Date.now(),
            message: error.message,
            stack: error.stack,
            context: context,
            severity: this.classifyError(error)
        };
        
        this.logError(errorData);
        this.sendAlert(errorData);
    }
    
    classifyError(error) {
        if (error.message.includes('network')) return 'high';
        if (error.message.includes('gas')) return 'medium';
        return 'low';
    }
}
```

### Alerting Configuration

#### Discord Integration

```javascript
// discordNotifier.js
class DiscordNotifier {
    constructor(webhookUrl) {
        this.webhookUrl = webhookUrl;
    }
    
    async sendAlert(message, severity = 'info') {
        const colors = {
            info: 0x00ff00,
            warning: 0xffff00,
            error: 0xff0000,
            critical: 0xff00ff
        };
        
        const payload = {
            embeds: [{
                title: `FHE Oracle Bridge Alert`,
                description: message,
                color: colors[severity],
                timestamp: new Date().toISOString()
            }]
        };
        
        await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }
}
```

#### Slack Integration

```javascript
// slackNotifier.js
class SlackNotifier {
    constructor(webhookUrl) {
        this.webhookUrl = webhookUrl;
    }
    
    async sendAlert(message, severity = 'info') {
        const payload = {
            text: `🚨 FHE Oracle Bridge Alert [${severity.toUpperCase()}]`,
            attachments: [{
                color: this.getColorForSeverity(severity),
                text: message,
                ts: Math.floor(Date.now() / 1000)
            }]
        };
        
        await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }
}
```

## Operational Procedures

### Daily Operations

#### Morning Checklist

```bash
#!/bin/bash
# daily_check.sh

echo "=== FHE Oracle Bridge Daily Health Check ==="

# 1. Check system health
npm run health:check

# 2. Review yesterday's performance
npm run performance:report:yesterday

# 3. Check gas prices
npm run gas:check

# 4. Verify keeper status
npm run keeper:status

# 5. Review alerts
npm run alerts:review

echo "Daily check completed"
```

#### Weekly Operations

```bash
#!/bin/bash
# weekly_maintenance.sh

echo "=== FHE Oracle Bridge Weekly Maintenance ==="

# 1. Update dependencies
npm update

# 2. Rotate keeper keys
npm run keeper:rotate-keys

# 3. Backup configurations
npm run backup:config

# 4. Performance analysis
npm run performance:analysis:week

# 5. Security audit
npm run security:audit

echo "Weekly maintenance completed"
```

### Keeper Management

#### Keeper Deployment

```bash
# deploy_keepers.sh

#!/bin/bash

NETWORK=$1
KEEPER_TYPE=$2

echo "Deploying $KEEPER_TYPE keeper on $NETWORK"

case $KEEPER_TYPE in
    "liquidation")
        npm run keeper:liquidation:$NETWORK
        ;;
    "alerts")
        npm run keeper:alerts:$NETWORK
        ;;
    "all")
        npm run keeper:liquidation:$NETWORK &
        npm run keeper:alerts:$NETWORK &
        ;;
esac

echo "Keeper deployment completed"
```

#### Keeper Monitoring

```javascript
// keeperMonitor.js
class KeeperMonitor {
    async monitorKeeper(keeperType, network) {
        const keeperProcess = this.startKeeper(keeperType, network);
        
        keeperProcess.on('error', (error) => {
            this.alert(`Keeper ${keeperType} crashed: ${error.message}`);
            this.restartKeeper(keeperType, network);
        });
        
        keeperProcess.on('exit', (code) => {
            if (code !== 0) {
                this.alert(`Keeper ${keeperType} exited with code ${code}`);
                this.restartKeeper(keeperType, network);
            }
        });
    }
    
    async restartKeeper(keeperType, network) {
        console.log(`Restarting ${keeperType} keeper...`);
        await this.sleep(5000); // Wait before restart
        this.monitorKeeper(keeperType, network);
    }
}
```

## Troubleshooting

### Common Issues

#### 1. Oracle Price Stale

**Symptoms**: Frontend shows stale prices, alerts not triggering

**Diagnosis**:
```bash
# Check last price update
npx hardhat run scripts/checkOracleStatus.js --network <network>

# Check feeder status
npx hardhat run scripts/checkFeederStatus.js --network <network>
```

**Resolution**:
```bash
# Restart feeder daemon
npm run feeder:<network>:restart

# Check network connectivity
curl -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
     <RPC_URL>
```

#### 2. Keeper Not Processing

**Symptoms**: Liquidations not executing, alerts not triggering

**Diagnosis**:
```bash
# Check keeper logs
tail -f logs/keeper.log

# Check keeper process
ps aux | grep keeper

# Check contract events
npx hardhat run scripts/checkEvents.js --network <network>
```

**Resolution**:
```bash
# Restart keeper
npm run keeper:<type>:restart

# Check environment variables
cat .env | grep KEEPER

# Verify contract addresses
npx hardhat run scripts/verifyAddresses.js --network <network>
```

#### 3. Frontend Connection Issues

**Symptoms**: Frontend not connecting, RPC errors

**Diagnosis**:
```bash
# Check RPC endpoint
curl -X POST <RPC_URL> \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# Check frontend configuration
cat frontend/config.json

# Check browser console for errors
```

**Resolution**:
```bash
# Update RPC URL in frontend config
# Restart frontend service
npm run frontend:restart

# Check CORS configuration
```

### Debug Tools

#### System Health Check

```javascript
// healthCheck.js
async function runHealthCheck() {
    const checks = [
        checkOracleHealth(),
        checkFeederHealth(),
        checkKeeperHealth(),
        checkFrontendHealth(),
        checkNetworkHealth()
    ];
    
    const results = await Promise.allSettled(checks);
    const health = results.map((result, index) => ({
        component: ['oracle', 'feeder', 'keeper', 'frontend', 'network'][index],
        status: result.status === 'fulfilled' ? 'healthy' : 'unhealthy',
        details: result.status === 'fulfilled' ? result.value : result.reason
    }));
    
    console.table(health);
    return health;
}
```

#### Performance Analysis

```javascript
// performanceAnalysis.js
async function analyzePerformance(timeRange) {
    const metrics = await loadPerformanceMetrics(timeRange);
    
    const analysis = {
        averageGasUsage: calculateAverage(metrics, 'gasUsed'),
        averageLatency: calculateAverage(metrics, 'duration'),
        errorRate: calculateErrorRate(metrics),
        throughput: calculateThroughput(metrics)
    };
    
    console.log('Performance Analysis:', analysis);
    return analysis;
}
```

## Emergency Procedures

### Emergency Shutdown

#### Immediate Response

```bash
#!/bin/bash
# emergency_shutdown.sh

echo "=== EMERGENCY SHUTDOWN INITIATED ==="

# 1. Stop all keepers
npm run keeper:stop:all

# 2. Stop frontend
npm run frontend:stop

# 3. Stop feeders
npm run feeder:stop:all

# 4. Send emergency notification
npm run alert:emergency "System emergency shutdown initiated"

# 5. Backup current state
npm run backup:emergency

echo "Emergency shutdown completed"
```

#### Recovery Procedure

```bash
#!/bin/bash
# recovery.sh

echo "=== SYSTEM RECOVERY PROCEDURE ==="

# 1. Assess system state
npm run health:full-assessment

# 2. Restore from backup if needed
npm run restore:backup

# 3. Restart services in order
npm run feeder:start:all
sleep 30
npm run keeper:start:all
sleep 30
npm run frontend:start

# 4. Verify system operation
npm run health:comprehensive

# 5. Send recovery notification
npm run alert:recovery "System recovery completed"

echo "Recovery procedure completed"
```

### Security Incident Response

#### Incident Classification

| Severity | Response Time | Escalation |
|----------|---------------|-------------|
| Critical | 5 minutes | Executive team |
| High | 15 minutes | Security team |
| Medium | 1 hour | Engineering team |
| Low | 4 hours | Operations team |

#### Response Checklist

```bash
#!/bin/bash
# security_incident_response.sh

SEVERITY=$1
INCIDENT_ID=$2

echo "=== SECURITY INCIDENT RESPONSE ==="
echo "Severity: $SEVERITY"
echo "Incident ID: $INCIDENT_ID"

# 1. Isolate affected systems
npm run isolate:systems

# 2. Preserve evidence
npm run preserve:evidence

# 3. Notify stakeholders
npm run notify:stakeholders $SEVERITY $INCIDENT_ID

# 4. Begin investigation
npm run investigate:incident $INCIDENT_ID

# 5. Implement temporary fixes
npm run implement:temporary-fixes

echo "Initial response completed"
```

## Automation Scripts

### Deployment Automation

```bash
#!/bin/bash
# deploy.sh

NETWORK=$1
ENVIRONMENT=$2

echo "Deploying to $NETWORK ($ENVIRONMENT)"

# Pre-deployment checks
npm run pre-deploy:check

# Deploy contracts
npm run deploy:$NETWORK

# Verify deployment
npm run verify:deployment:$NETWORK

# Update configurations
npm run update:config:$NETWORK

# Start services
npm run start:services:$NETWORK

# Post-deployment validation
npm run post-deploy:validate:$NETWORK

echo "Deployment to $NETWORK completed"
```

### Monitoring Automation

```bash
#!/bin/bash
# setup_monitoring.sh

echo "Setting up monitoring system"

# 1. Install monitoring dependencies
npm install --save-dev @prometheus/client grafana-api

# 2. Configure Prometheus
npm run setup:prometheus

# 3. Configure Grafana
npm run setup:grafana

# 4. Setup alerting
npm run setup:alerting

# 5. Start monitoring stack
npm run monitoring:start

echo "Monitoring setup completed"
```

## Conclusion

This deployment runbook provides comprehensive procedures for deploying, operating, and maintaining the FHE Oracle Bridge system. Following these procedures ensures reliable operation, quick incident response, and system resilience.

Regular practice of these procedures, combined with robust monitoring, will help maintain high availability and security of the FHE Oracle Bridge infrastructure.

## Support

For deployment support:
1. Review this documentation thoroughly
2. Check troubleshooting section
3. Run diagnostic scripts
4. Contact the development team for critical issues
