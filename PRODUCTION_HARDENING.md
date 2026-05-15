# FHE Oracle Bridge - Production Hardening & Error Handling

## Overview

This document outlines production hardening measures and comprehensive error handling strategies for the FHE Oracle Bridge system to ensure maximum reliability, security, and operational stability in production environments.

## Table of Contents

1. [Security Hardening](#security-hardening)
2. [Error Handling Strategy](#error-handling-strategy)
3. [Resilience Patterns](#resilience-patterns)
4. [Monitoring & Alerting](#monitoring--alerting)
5. [Operational Procedures](#operational-procedures)
6. [Disaster Recovery](#disaster-recovery)
7. [Compliance & Auditing](#compliance--auditing)

## Security Hardening

### 1. Smart Contract Security

#### Access Control Implementation

```solidity
// Enhanced access control with role-based permissions
contract AccessControl {
    mapping(address => uint256) public roles;
    uint256 public constant OWNER_ROLE = 0;
    uint256 public constant ADMIN_ROLE = 1;
    uint256 public constant OPERATOR_ROLE = 2;
    
    modifier onlyRole(uint256 requiredRole) {
        require(roles[msg.sender] == requiredRole, "Unauthorized");
        _;
    }
    
    modifier onlyOwner() {
        require(roles[msg.sender] == OWNER_ROLE, "Owner only");
        _;
    }
    
    // Emergency pause functionality
    bool public paused = false;
    uint256 public pauseDeadline;
    
    modifier whenNotPaused() {
        require(!paused || block.timestamp > pauseDeadline, "Contract paused");
        _;
    }
    
    function emergencyPause(uint256 duration) external onlyOwner {
        paused = true;
        pauseDeadline = block.timestamp + duration;
        emit EmergencyPaused(duration);
    }
}
```

#### Input Validation & Sanitization

```solidity
library SafeMath {
    function safeAdd(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");
        return c;
    }
    
    function safeSub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "SafeMath: subtraction underflow");
        return a - b;
    }
}

contract Validation {
    modifier validFeedId(uint256 feedId) {
        require(feedId > 0 && feedId <= MAX_FEEDS, "Invalid feed ID");
        _;
    }
    
    modifier validPrice(uint256 price) {
        require(price > 0 && price <= MAX_PRICE, "Invalid price");
        _;
    }
    
    modifier validAddress(address addr) {
        require(addr != address(0), "Invalid address");
        _;
    }
}
```

#### Reentrancy Protection

```solidity
abstract contract ReentrancyGuard {
    uint256 private _status;
    
    constructor() {
        _status = 1;
    }
    
    modifier nonReentrant() {
        require(_status == 1, "ReentrancyGuard: reentrant call");
        _status = 2;
        _;
        _status = 1;
    }
}
```

### 2. Infrastructure Security

#### Network Security

```yaml
# Security configurations
security:
  firewalls:
    - inbound:
        ports: [443, 80]
        sources: [0.0.0.0/0]
      outbound:
        ports: [443, 53, 80]
        destinations: [0.0.0.0/0]
  
  ssl:
    certificates:
      - path: "/etc/ssl/certs/oracle.crt"
        key: "/etc/ssl/private/oracle.key"
        ca: "/etc/ssl/certs/ca.crt"
    
  rate_limiting:
    requests_per_minute: 1000
    burst_size: 100
    
  ddos_protection:
    enabled: true
    threshold: 10000
    blacklist_duration: 3600
```

#### Key Management

```javascript
// Secure key management
class KeyManager {
    constructor() {
        this.keys = new Map();
        this.rotationInterval = 24 * 60 * 60 * 1000; // 24 hours
        this.encryptionKey = process.env.MASTER_KEY;
    }
    
    async rotateKeys() {
        for (const [service, keyData] of this.keys) {
            const newKey = await this.generateKey();
            const encryptedKey = await this.encryptKey(newKey);
            
            await this.updateServiceKey(service, encryptedKey);
            this.keys.set(service, { key: newKey, rotatedAt: Date.now() });
        }
    }
    
    async encryptKey(key) {
        const crypto = require('crypto');
        const algorithm = 'aes-256-gcm';
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipher(algorithm, this.encryptionKey);
        cipher.setAAD(Buffer.from('FHE-ORACLE-KEY'));
        
        let encrypted = cipher.update(key, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    }
}
```

### 3. Data Protection

#### Encryption at Rest

```javascript
// Data encryption utilities
class DataEncryption {
    constructor(masterKey) {
        this.algorithm = 'aes-256-gcm';
        this.masterKey = masterKey;
    }
    
    encrypt(data) {
        const crypto = require('crypto');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher(this.algorithm, this.masterKey);
        
        cipher.setAAD(Buffer.from('FHE-ORACLE-DATA'));
        
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
            data: encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    }
    
    decrypt(encryptedData) {
        const crypto = require('crypto');
        const decipher = crypto.createDecipher(this.algorithm, this.masterKey);
        
        decipher.setAAD(Buffer.from('FHE-ORACLE-DATA'));
        decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
        
        let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    }
}
```

#### Backup Security

```bash
#!/bin/bash
# secure_backup.sh

# Create encrypted backups
create_encrypted_backup() {
    local backup_dir=$1
    local encryption_key=$2
    
    # Create backup
    tar -czf - "$backup_dir" | \
    openssl enc -aes-256-cbc -salt -out "backup_$(date +%Y%m%d_%H%M%S).tar.gz.enc" \
    -k "$encryption_key"
    
    # Upload to secure storage
    aws s3 cp "backup_*.tar.gz.enc" s3://secure-backups/fhe-oracle/ \
    --server-side-encryption AES256
}

# Verify backup integrity
verify_backup() {
    local backup_file=$1
    local encryption_key=$2
    
    openssl enc -d -aes-256-cbc -in "$backup_file" -k "$encryption_key" | \
    tar -tzf - > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "Backup integrity verified"
    else
        echo "Backup integrity check failed"
        exit 1
    fi
}
```

## Error Handling Strategy

### 1. Error Classification

```javascript
// Error classification system
class ErrorHandler {
    constructor() {
        this.errorCategories = {
            NETWORK: 'network',
            CONTRACT: 'contract',
            VALIDATION: 'validation',
            SECURITY: 'security',
            SYSTEM: 'system'
        };
        
        this.severityLevels = {
            LOW: 'low',
            MEDIUM: 'medium',
            HIGH: 'high',
            CRITICAL: 'critical'
        };
    }
    
    classifyError(error) {
        const message = error.message.toLowerCase();
        
        if (message.includes('network') || message.includes('rpc')) {
            return this.createError(this.errorCategories.NETWORK, this.severityLevels.HIGH, error);
        } else if (message.includes('gas') || message.includes('revert')) {
            return this.createError(this.errorCategories.CONTRACT, this.severityLevels.MEDIUM, error);
        } else if (message.includes('invalid') || message.includes('require')) {
            return this.createError(this.errorCategories.VALIDATION, this.severityLevels.LOW, error);
        } else if (message.includes('unauthorized') || message.includes('access denied')) {
            return this.createError(this.errorCategories.SECURITY, this.severityLevels.CRITICAL, error);
        } else {
            return this.createError(this.errorCategories.SYSTEM, this.severityLevels.MEDIUM, error);
        }
    }
    
    createError(category, severity, originalError) {
        return {
            category,
            severity,
            message: originalError.message,
            stack: originalError.stack,
            timestamp: new Date().toISOString(),
            id: this.generateErrorId()
        };
    }
}
```

### 2. Retry Mechanisms

```javascript
// Exponential backoff retry mechanism
class RetryHandler {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.baseDelay = options.baseDelay || 1000;
        this.maxDelay = options.maxDelay || 30000;
        this.backoffMultiplier = options.backoffMultiplier || 2;
    }
    
    async executeWithRetry(operation, context = {}) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`Executing operation (attempt ${attempt}/${this.maxRetries})`);
                return await operation();
            } catch (error) {
                lastError = error;
                
                if (attempt === this.maxRetries) {
                    console.error(`Operation failed after ${this.maxRetries} attempts:`, error.message);
                    throw error;
                }
                
                if (!this.shouldRetry(error)) {
                    console.error(`Non-retryable error:`, error.message);
                    throw error;
                }
                
                const delay = this.calculateDelay(attempt);
                console.log(`Retrying in ${delay}ms...`);
                await this.sleep(delay);
            }
        }
        
        throw lastError;
    }
    
    shouldRetry(error) {
        const retryableErrors = [
            'network timeout',
            'connection refused',
            'temporary failure',
            'rate limit',
            'gas price too low'
        ];
        
        return retryableErrors.some(pattern => 
            error.message.toLowerCase().includes(pattern)
        );
    }
    
    calculateDelay(attempt) {
        const delay = this.baseDelay * Math.pow(this.backoffMultiplier, attempt - 1);
        return Math.min(delay, this.maxDelay);
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

### 3. Circuit Breaker Pattern

```javascript
// Circuit breaker for fault tolerance
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.recoveryTimeout = options.recoveryTimeout || 60000;
        this.monitoringPeriod = options.monitoringPeriod || 10000;
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
    }
    
    async execute(operation) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
                this.state = 'HALF_OPEN';
                this.successCount = 0;
            } else {
                throw new Error('Circuit breaker is OPEN');
            }
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    onSuccess() {
        this.failureCount = 0;
        
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= 3) {
                this.state = 'CLOSED';
            }
        }
    }
    
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }
    
    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime
        };
    }
}
```

## Resilience Patterns

### 1. Graceful Degradation

```javascript
// Graceful degradation for oracle operations
class OracleService {
    constructor(primaryOracle, fallbackOracles = []) {
        this.primaryOracle = primaryOracle;
        this.fallbackOracles = fallbackOracles;
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 3,
            recoveryTimeout: 30000
        });
    }
    
    async getPrice(feedId) {
        try {
            return await this.circuitBreaker.execute(async () => {
                return await this.primaryOracle.getPrice(feedId);
            });
        } catch (error) {
            console.warn('Primary oracle failed, trying fallbacks:', error.message);
            
            for (const fallback of this.fallbackOracles) {
                try {
                    const price = await fallback.getPrice(feedId);
                    console.log('Fallback oracle succeeded');
                    return price;
                } catch (fallbackError) {
                    console.warn('Fallback oracle failed:', fallbackError.message);
                }
            }
            
            // Return cached price if available
            const cachedPrice = await this.getCachedPrice(feedId);
            if (cachedPrice) {
                console.warn('Using cached price due to oracle failures');
                return cachedPrice;
            }
            
            throw new Error('All oracle sources failed');
        }
    }
    
    async getCachedPrice(feedId) {
        // Implement cached price retrieval
        return null;
    }
}
```

### 2. Health Check Implementation

```javascript
// Comprehensive health checks
class HealthChecker {
    constructor(services = {}) {
        this.services = services;
        this.checks = new Map();
        this.setupHealthChecks();
    }
    
    setupHealthChecks() {
        // Oracle health check
        this.checks.set('oracle', async () => {
            try {
                const price = await this.services.oracle.getPrice(1);
                return { status: 'healthy', details: { price: price.toString() } };
            } catch (error) {
                return { status: 'unhealthy', error: error.message };
            }
        });
        
        // Database health check
        this.checks.set('database', async () => {
            try {
                await this.services.database.query('SELECT 1');
                return { status: 'healthy' };
            } catch (error) {
                return { status: 'unhealthy', error: error.message };
            }
        });
        
        // Network connectivity check
        this.checks.set('network', async () => {
            try {
                const blockNumber = await this.services.provider.getBlockNumber();
                return { status: 'healthy', details: { blockNumber } };
            } catch (error) {
                return { status: 'unhealthy', error: error.message };
            }
        });
    }
    
    async runAllChecks() {
        const results = new Map();
        
        for (const [service, check] of this.checks) {
            try {
                const startTime = Date.now();
                const result = await check();
                const duration = Date.now() - startTime;
                
                results.set(service, {
                    ...result,
                    duration,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.set(service, {
                    status: 'error',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        return this.calculateOverallHealth(results);
    }
    
    calculateOverallHealth(results) {
        const healthy = Array.from(results.values()).filter(r => r.status === 'healthy').length;
        const total = results.size;
        
        const overallStatus = healthy === total ? 'healthy' : 
                            healthy > 0 ? 'degraded' : 'unhealthy';
        
        return {
            status: overallStatus,
            score: Math.round((healthy / total) * 100),
            services: Object.fromEntries(results),
            timestamp: new Date().toISOString()
        };
    }
}
```

### 3. Load Balancing

```javascript
// Load balancer for multiple oracle instances
class OracleLoadBalancer {
    constructor(oracles = []) {
        this.oracles = oracles;
        this.currentIndex = 0;
        this.healthStatus = new Map();
        this.responseTimes = new Map();
    }
    
    async getNextOracle() {
        const healthyOracles = await this.getHealthyOracles();
        
        if (healthyOracles.length === 0) {
            throw new Error('No healthy oracles available');
        }
        
        // Round-robin selection
        const oracle = healthyOracles[this.currentIndex % healthyOracles.length];
        this.currentIndex++;
        
        return oracle;
    }
    
    async getHealthyOracles() {
        const healthy = [];
        
        for (const oracle of this.oracles) {
            const isHealthy = await this.checkOracleHealth(oracle);
            if (isHealthy) {
                healthy.push(oracle);
            }
        }
        
        return healthy;
    }
    
    async checkOracleHealth(oracle) {
        try {
            const startTime = Date.now();
            await oracle.getPrice(1); // Health check
            const responseTime = Date.now() - startTime;
            
            this.responseTimes.set(oracle.address, responseTime);
            this.healthStatus.set(oracle.address, true);
            
            return true;
        } catch (error) {
            this.healthStatus.set(oracle.address, false);
            return false;
        }
    }
    
    getLoadBalancedStats() {
        return {
            totalOracles: this.oracles.length,
            healthyOracles: Array.from(this.healthStatus.values()).filter(h => h).length,
            averageResponseTime: this.calculateAverageResponseTime(),
            healthStatus: Object.fromEntries(this.healthStatus)
        };
    }
}
```

## Monitoring & Alerting

### 1. Advanced Monitoring

```javascript
// Advanced monitoring system
class AdvancedMonitor {
    constructor() {
        this.metrics = new Map();
        this.alerts = [];
        this.thresholds = {
            errorRate: 0.05, // 5%
            responseTime: 5000, // 5 seconds
            memoryUsage: 0.8, // 80%
            cpuUsage: 0.9 // 90%
        };
    }
    
    trackMetric(name, value, tags = {}) {
        const timestamp = Date.now();
        const metric = {
            name,
            value,
            tags,
            timestamp
        };
        
        if (!this.metrics.has(name)) {
            this.metrics.set(name, []);
        }
        
        this.metrics.get(name).push(metric);
        
        // Keep only last 1000 metrics per name
        const metrics = this.metrics.get(name);
        if (metrics.length > 1000) {
            metrics.splice(0, metrics.length - 1000);
        }
        
        this.checkThresholds(name, value, tags);
    }
    
    checkThresholds(metricName, value, tags) {
        const threshold = this.thresholds[metricName];
        
        if (threshold && value > threshold) {
            this.createAlert({
                severity: 'warning',
                metric: metricName,
                value,
                threshold,
                tags,
                message: `${metricName} exceeded threshold: ${value} > ${threshold}`
            });
        }
    }
    
    createAlert(alertData) {
        const alert = {
            id: this.generateAlertId(),
            ...alertData,
            timestamp: new Date().toISOString(),
            status: 'active'
        };
        
        this.alerts.push(alert);
        this.sendAlert(alert);
    }
    
    async sendAlert(alert) {
        // Send to multiple channels
        await Promise.all([
            this.sendToDiscord(alert),
            this.sendToSlack(alert),
            this.sendToEmail(alert),
            this.sendToPagerDuty(alert)
        ]);
    }
    
    async sendToDiscord(alert) {
        const webhook = process.env.DISCORD_WEBHOOK_URL;
        if (!webhook) return;
        
        const payload = {
            embeds: [{
                title: `🚨 ${alert.severity.toUpperCase()} Alert`,
                description: alert.message,
                color: this.getAlertColor(alert.severity),
                timestamp: alert.timestamp,
                fields: [
                    { name: 'Metric', value: alert.metric, inline: true },
                    { name: 'Value', value: alert.value.toString(), inline: true },
                    { name: 'Threshold', value: alert.threshold.toString(), inline: true }
                ]
            }]
        };
        
        await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }
    
    getAlertColor(severity) {
        const colors = {
            low: 0x00ff00,
            medium: 0xffff00,
            high: 0xff6600,
            critical: 0xff0000
        };
        
        return colors[severity] || 0x808080;
    }
}
```

### 2. Log Management

```javascript
// Structured logging system
class StructuredLogger {
    constructor(serviceName) {
        this.serviceName = serviceName;
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }
    
    log(level, message, context = {}) {
        if (this.levels[level] > this.levels[this.logLevel]) {
            return;
        }
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.serviceName,
            message,
            context,
            traceId: this.getTraceId()
        };
        
        console.log(JSON.stringify(logEntry));
        
        // Send to log aggregation service
        this.sendToLogAggregator(logEntry);
    }
    
    error(message, context = {}) {
        this.log('error', message, context);
    }
    
    warn(message, context = {}) {
        this.log('warn', message, context);
    }
    
    info(message, context = {}) {
        this.log('info', message, context);
    }
    
    debug(message, context = {}) {
        this.log('debug', message, context);
    }
    
    getTraceId() {
        // Implement trace ID generation/retrieval
        return Math.random().toString(36).substr(2, 9);
    }
    
    async sendToLogAggregator(logEntry) {
        // Send to ELK stack, Splunk, or other log aggregation
        // Implementation depends on your logging infrastructure
    }
}
```

## Operational Procedures

### 1. Incident Response

```bash
#!/bin/bash
# incident_response.sh

incident_types=("security" "performance" "availability" "data")

handle_incident() {
    local incident_type=$1
    local severity=$2
    local description=$3
    
    echo "🚨 Incident Response Initiated"
    echo "Type: $incident_type"
    echo "Severity: $severity"
    echo "Description: $description"
    
    # Create incident record
    create_incident_record "$incident_type" "$severity" "$description"
    
    # Notify stakeholders
    notify_stakeholders "$incident_type" "$severity" "$description"
    
    # Execute response plan
    case $incident_type in
        "security")
            execute_security_response "$severity"
            ;;
        "performance")
            execute_performance_response "$severity"
            ;;
        "availability")
            execute_availability_response "$severity"
            ;;
        "data")
            execute_data_response "$severity"
            ;;
    esac
}

execute_security_response() {
    local severity=$1
    
    echo "🔒 Executing security response..."
    
    # Block suspicious IPs
    block_suspicious_ips
    
    # Rotate credentials if needed
    if [ "$severity" = "critical" ]; then
        rotate_credentials
    fi
    
    # Enable additional monitoring
    enable_security_monitoring
    
    # Backup current state
    create_emergency_backup
}

execute_performance_response() {
    local severity=$1
    
    echo "⚡ Executing performance response..."
    
    # Scale up resources
    scale_up_resources
    
    # Enable caching
    enable_caching
    
    # Optimize database queries
    optimize_database
    
    # Monitor performance metrics
    enable_performance_monitoring
}

execute_availability_response() {
    local severity=$1
    
    echo "🔄 Executing availability response..."
    
    # Switch to backup systems
    activate_backup_systems
    
    # Restart affected services
    restart_services
    
    # Enable health checks
    enable_health_checks
    
    # Notify users if needed
    if [ "$severity" = "critical" ]; then
        notify_users_of_outage
    fi
}
```

### 2. Maintenance Procedures

```javascript
// Maintenance scheduler
class MaintenanceScheduler {
    constructor() {
        this.scheduledTasks = new Map();
        this.maintenanceWindows = {
            daily: { start: '02:00', duration: 2 }, // 2 AM - 4 AM
            weekly: { day: 'sunday', start: '01:00', duration: 4 },
            monthly: { day: 1, start: '00:00', duration: 6 }
        };
    }
    
    scheduleMaintenance(type, task, options = {}) {
        const window = this.maintenanceWindows[type];
        const scheduledTime = this.calculateNextMaintenance(window);
        
        const maintenanceTask = {
            id: this.generateTaskId(),
            type,
            task,
            scheduledTime,
            duration: options.duration || 1,
            priority: options.priority || 'normal',
            rollbackPlan: options.rollbackPlan
        };
        
        this.scheduledTasks.set(maintenanceTask.id, maintenanceTask);
        
        console.log(`Maintenance scheduled: ${task} at ${scheduledTime.toISOString()}`);
        
        return maintenanceTask.id;
    }
    
    async executeMaintenance(taskId) {
        const task = this.scheduledTasks.get(taskId);
        if (!task) {
            throw new Error('Maintenance task not found');
        }
        
        console.log(`Executing maintenance: ${task.task}`);
        
        try {
            // Create system backup
            await this.createSystemBackup();
            
            // Execute maintenance task
            const result = await task.task();
            
            // Verify system health
            await this.verifySystemHealth();
            
            console.log(`Maintenance completed successfully: ${task.task}`);
            
            // Clean up old backups
            await this.cleanupOldBackups();
            
            return result;
            
        } catch (error) {
            console.error(`Maintenance failed: ${task.task}`, error);
            
            // Execute rollback if available
            if (task.rollbackPlan) {
                console.log('Executing rollback plan...');
                await task.rollbackPlan();
            }
            
            throw error;
        }
    }
    
    async createSystemBackup() {
        // Implement system backup
        console.log('Creating system backup...');
    }
    
    async verifySystemHealth() {
        // Implement health verification
        console.log('Verifying system health...');
    }
}
```

## Disaster Recovery

### 1. Backup Strategy

```javascript
// Comprehensive backup system
class BackupManager {
    constructor() {
        this.backupTypes = {
            FULL: 'full',
            INCREMENTAL: 'incremental',
            DIFFERENTIAL: 'differential'
        };
        
        this.retentionPolicy = {
            daily: 7,      // Keep 7 days
            weekly: 4,     // Keep 4 weeks
            monthly: 12,  // Keep 12 months
            yearly: 5     // Keep 5 years
        };
    }
    
    async createBackup(type = this.backupTypes.FULL) {
        const backupId = this.generateBackupId();
        const timestamp = new Date().toISOString();
        
        console.log(`Creating ${type} backup: ${backupId}`);
        
        try {
            const backupData = await this.collectBackupData(type);
            const encryptedBackup = await this.encryptBackup(backupData);
            
            // Store in multiple locations
            await Promise.all([
                this.storeToLocal(backupId, encryptedBackup),
                this.storeToCloud(backupId, encryptedBackup),
                this.storeToColdStorage(backupId, encryptedBackup)
            ]);
            
            const backupInfo = {
                id: backupId,
                type,
                timestamp,
                size: encryptedBackup.length,
                checksum: this.calculateChecksum(encryptedBackup),
                locations: ['local', 'cloud', 'cold']
            };
            
            await this.recordBackup(backupInfo);
            
            console.log(`Backup completed: ${backupId}`);
            return backupInfo;
            
        } catch (error) {
            console.error(`Backup failed: ${error.message}`);
            throw error;
        }
    }
    
    async restoreFromBackup(backupId) {
        console.log(`Restoring from backup: ${backupId}`);
        
        try {
            // Try local storage first
            let backupData = await this.loadFromLocal(backupId);
            
            if (!backupData) {
                // Try cloud storage
                backupData = await this.loadFromCloud(backupId);
            }
            
            if (!backupData) {
                throw new Error('Backup not found in any location');
            }
            
            // Verify backup integrity
            const isValid = await this.verifyBackupIntegrity(backupId, backupData);
            if (!isValid) {
                throw new Error('Backup integrity check failed');
            }
            
            // Decrypt and restore
            const decryptedData = await this.decryptBackup(backupData);
            await this.restoreSystem(decryptedData);
            
            console.log(`Restore completed: ${backupId}`);
            
        } catch (error) {
            console.error(`Restore failed: ${error.message}`);
            throw error;
        }
    }
    
    async testBackup(backupId) {
        console.log(`Testing backup: ${backupId}`);
        
        try {
            const backupData = await this.loadFromCloud(backupId);
            const isValid = await this.verifyBackupIntegrity(backupId, backupData);
            
            if (isValid) {
                console.log(`Backup test passed: ${backupId}`);
                return true;
            } else {
                console.log(`Backup test failed: ${backupId}`);
                return false;
            }
            
        } catch (error) {
            console.error(`Backup test error: ${error.message}`);
            return false;
        }
    }
}
```

### 2. Recovery Procedures

```bash
#!/bin/bash
# disaster_recovery.sh

declare -A RECOVERY_STEPS=(
    ["assessment"]="assess_system_damage"
    ["backup"]="restore_from_backup"
    ["services"]="restore_critical_services"
    ["data"]="restore_data_integrity"
    ["validation"]="validate_system_recovery"
)

execute_recovery() {
    local disaster_type=$1
    local backup_id=$2
    
    echo "🚨 Disaster Recovery Initiated"
    echo "Type: $disaster_type"
    echo "Backup ID: $backup_id"
    
    # Step 1: Assess damage
    echo "📊 Step 1: Assessing system damage..."
    ${RECOVERY_STEPS[assessment]}
    
    # Step 2: Restore from backup
    echo "💾 Step 2: Restoring from backup..."
    ${RECOVERY_STEPS[backup]} "$backup_id"
    
    # Step 3: Restore critical services
    echo "🔄 Step 3: Restoring critical services..."
    ${RECOVERY_STEPS[services]}
    
    # Step 4: Restore data integrity
    echo "🔍 Step 4: Restoring data integrity..."
    ${RECOVERY_STEPS[data]}
    
    # Step 5: Validate recovery
    echo "✅ Step 5: Validating system recovery..."
    ${RECOVERY_STEPS[validation]}
    
    echo "🎉 Disaster Recovery Completed"
}

assess_system_damage() {
    echo "Assessing system damage..."
    
    # Check system components
    check_database_status
    check_oracle_status
    check_network_status
    check_storage_status
    
    # Generate damage report
    generate_damage_report
}

restore_from_backup() {
    local backup_id=$1
    
    echo "Restoring from backup: $backup_id"
    
    # Verify backup integrity
    verify_backup_integrity "$backup_id"
    
    # Restore system components
    restore_database "$backup_id"
    restore_configurations "$backup_id"
    restore_smart_contracts "$backup_id"
}

restore_critical_services() {
    echo "Restoring critical services..."
    
    # Start core services in order
    start_database_service
    start_oracle_service
    start_feeder_service
    start_keeper_service
    start_frontend_service
}

validate_system_recovery() {
    echo "Validating system recovery..."
    
    # Run health checks
    run_health_checks
    
    # Validate data integrity
    validate_data_integrity
    
    # Test functionality
    test_oracle_functionality
    test_feeder_functionality
    test_keeper_functionality
    
    # Generate recovery report
    generate_recovery_report
}
```

## Compliance & Auditing

### 1. Audit Logging

```javascript
// Comprehensive audit logging
class AuditLogger {
    constructor() {
        this.auditLog = [];
        this.sensitiveFields = ['privateKey', 'password', 'secret'];
    }
    
    logAction(action, actor, details = {}) {
        const auditEntry = {
            timestamp: new Date().toISOString(),
            action,
            actor: this.sanitizeActor(actor),
            details: this.sanitizeDetails(details),
            sessionId: this.getSessionId(),
            ipAddress: this.getClientIP(),
            userAgent: this.getUserAgent(),
            requestId: this.getRequestId()
        };
        
        this.auditLog.push(auditEntry);
        this.persistAuditLog(auditEntry);
        
        // Check for suspicious activity
        this.checkSuspiciousActivity(auditEntry);
    }
    
    sanitizeActor(actor) {
        // Remove sensitive information from actor identification
        if (typeof actor === 'string' && actor.length > 10) {
            return actor.substring(0, 6) + '...' + actor.substring(actor.length - 4);
        }
        return actor;
    }
    
    sanitizeDetails(details) {
        const sanitized = { ...details };
        
        for (const field of this.sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }
        
        return sanitized;
    }
    
    checkSuspiciousActivity(entry) {
        // Implement suspicious activity detection
        const suspiciousPatterns = [
            'unauthorized_access',
            'privilege_escalation',
            'data_export',
            'configuration_change'
        ];
        
        if (suspiciousPatterns.includes(entry.action)) {
            this.triggerSecurityAlert(entry);
        }
    }
    
    triggerSecurityAlert(entry) {
        console.warn('🚨 Suspicious activity detected:', entry);
        
        // Send security alert
        this.sendSecurityAlert({
            type: 'suspicious_activity',
            entry,
            timestamp: new Date().toISOString()
        });
    }
    
    async persistAuditLog(entry) {
        // Store audit log in immutable storage
        await this.storeInImmutableStorage(entry);
        
        // Create hash for integrity verification
        const hash = this.calculateHash(entry);
        await this.storeHash(entry.timestamp, hash);
    }
}
```

### 2. Compliance Reporting

```javascript
// Compliance reporting system
class ComplianceReporter {
    constructor() {
        this.reportTypes = {
            SECURITY: 'security',
            PRIVACY: 'privacy',
            OPERATIONAL: 'operational',
            FINANCIAL: 'financial'
        };
        
        this.complianceFrameworks = {
            GDPR: 'gdpr',
            SOC2: 'soc2',
            ISO27001: 'iso27001',
            PCI_DSS: 'pci_dss'
        };
    }
    
    async generateComplianceReport(type, timeframe) {
        console.log(`Generating ${type} compliance report for ${timeframe}`);
        
        const reportData = await this.collectComplianceData(type, timeframe);
        const report = this.formatComplianceReport(type, reportData);
        
        // Validate report completeness
        const validation = await this.validateReport(report);
        if (!validation.isValid) {
            throw new Error(`Report validation failed: ${validation.errors.join(', ')}`);
        }
        
        // Sign report for integrity
        const signedReport = await this.signReport(report);
        
        // Store report
        await this.storeComplianceReport(signedReport);
        
        return signedReport;
    }
    
    async collectComplianceData(type, timeframe) {
        const startDate = new Date(timeframe.start);
        const endDate = new Date(timeframe.end);
        
        switch (type) {
            case this.reportTypes.SECURITY:
                return await this.collectSecurityData(startDate, endDate);
            case this.reportTypes.PRIVACY:
                return await this.collectPrivacyData(startDate, endDate);
            case this.reportTypes.OPERATIONAL:
                return await this.collectOperationalData(startDate, endDate);
            case this.reportTypes.FINANCIAL:
                return await this.collectFinancialData(startDate, endDate);
            default:
                throw new Error(`Unknown report type: ${type}`);
        }
    }
    
    async collectSecurityData(startDate, endDate) {
        return {
            accessLogs: await this.getAccessLogs(startDate, endDate),
            securityEvents: await this.getSecurityEvents(startDate, endDate),
            vulnerabilityScans: await this.getVulnerabilityScans(startDate, endDate),
            incidentReports: await this.getIncidentReports(startDate, endDate),
            complianceChecks: await this.getComplianceChecks(startDate, endDate)
        };
    }
    
    formatComplianceReport(type, data) {
        return {
            metadata: {
                reportType: type,
                generatedAt: new Date().toISOString(),
                version: '1.0',
                framework: this.complianceFrameworks.GDPR
            },
            summary: this.generateSummary(type, data),
            details: data,
            recommendations: this.generateRecommendations(type, data),
            appendix: this.generateAppendix(type, data)
        };
    }
}
```

## Conclusion

This production hardening guide provides comprehensive security measures, error handling strategies, and operational procedures to ensure the FHE Oracle Bridge operates reliably and securely in production environments.

Key takeaways:

1. **Security First**: Implement multiple layers of security including access control, encryption, and monitoring
2. **Resilience by Design**: Use circuit breakers, retry mechanisms, and graceful degradation
3. **Comprehensive Monitoring**: Track all system metrics and implement intelligent alerting
4. **Disaster Recovery**: Maintain regular backups and tested recovery procedures
5. **Compliance Ready**: Implement audit logging and compliance reporting

Regular testing and updating of these hardening measures will ensure the system remains secure and reliable as threats evolve and requirements change.
