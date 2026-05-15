/**
 * productionErrorHandler.js - Production-hardened error handling utilities
 *
 * Features:
 *   - Comprehensive error classification
 *   - Automatic retry with exponential backoff
 *   - Circuit breaker pattern
 *   - Graceful degradation
 *   - Structured logging
 *   - Alert integration
 *
 * Usage: const errorHandler = new ProductionErrorHandler(options);
 */

const crypto = require('crypto');

class ProductionErrorHandler {
    constructor(options = {}) {
        this.options = {
            maxRetries: options.maxRetries || 3,
            baseDelay: options.baseDelay || 1000,
            maxDelay: options.maxDelay || 30000,
            backoffMultiplier: options.backoffMultiplier || 2,
            circuitBreakerThreshold: options.circuitBreakerThreshold || 5,
            circuitBreakerTimeout: options.circuitBreakerTimeout || 60000,
            enableMetrics: options.enableMetrics !== false,
            enableAlerts: options.enableAlerts !== false,
            ...options
        };
        
        this.errorStats = new Map();
        this.circuitBreakers = new Map();
        this.retryAttempts = new Map();
        this.metrics = {
            totalErrors: 0,
            errorsByCategory: {},
            errorsBySeverity: {},
            retrySuccessRate: 0,
            circuitBreakerActivations: 0
        };
        
        this.initializeCircuitBreakers();
    }
    
    // ===== ERROR CLASSIFICATION =====
    
    classifyError(error, context = {}) {
        const classification = {
            category: this.determineCategory(error),
            severity: this.determineSeverity(error, context),
            isRetryable: this.isRetryable(error),
            requiresEscalation: this.requiresEscalation(error, context),
            suggestedAction: this.suggestAction(error),
            errorId: this.generateErrorId(),
            timestamp: new Date().toISOString(),
            context
        };
        
        this.updateErrorStats(classification);
        this.logError(error, classification);
        
        return classification;
    }
    
    determineCategory(error) {
        const message = error.message.toLowerCase();
        const code = error.code || '';
        
        if (message.includes('network') || message.includes('rpc') || code === 'NETWORK_ERROR') {
            return 'NETWORK';
        } else if (message.includes('gas') || message.includes('revert') || code === 'EXECUTION_ERROR') {
            return 'CONTRACT';
        } else if (message.includes('invalid') || message.includes('require') || code === 'VALIDATION_ERROR') {
            return 'VALIDATION';
        } else if (message.includes('unauthorized') || message.includes('access denied') || code === 'AUTH_ERROR') {
            return 'SECURITY';
        } else if (message.includes('timeout') || code === 'TIMEOUT') {
            return 'TIMEOUT';
        } else if (message.includes('rate limit') || code === 'RATE_LIMIT') {
            return 'RATE_LIMIT';
        } else if (message.includes('storage') || message.includes('disk')) {
            return 'STORAGE';
        } else if (message.includes('memory') || message.includes('heap')) {
            return 'MEMORY';
        } else {
            return 'SYSTEM';
        }
    }
    
    determineSeverity(error, context) {
        const category = this.determineCategory(error);
        const message = error.message.toLowerCase();
        
        // Critical errors
        if (category === 'SECURITY' || message.includes('critical') || message.includes('fatal')) {
            return 'CRITICAL';
        }
        
        // High severity
        if (category === 'CONTRACT' && message.includes('revert') || 
            category === 'NETWORK' && message.includes('connection refused') ||
            context.impact === 'HIGH') {
            return 'HIGH';
        }
        
        // Medium severity
        if (category === 'TIMEOUT' || category === 'RATE_LIMIT' || 
            context.impact === 'MEDIUM') {
            return 'MEDIUM';
        }
        
        // Low severity
        return 'LOW';
    }
    
    isRetryable(error) {
        const category = this.determineCategory(error);
        const message = error.message.toLowerCase();
        
        const retryableCategories = ['NETWORK', 'TIMEOUT', 'RATE_LIMIT'];
        const retryablePatterns = [
            'network timeout',
            'connection refused',
            'temporary failure',
            'rate limit',
            'gas price too low',
            'nonce too low',
            'underpriced transaction'
        ];
        
        return retryableCategories.includes(category) || 
               retryablePatterns.some(pattern => message.includes(pattern));
    }
    
    requiresEscalation(error, context) {
        const classification = this.classifyError(error, context);
        
        return classification.severity === 'CRITICAL' ||
               (classification.severity === 'HIGH' && this.getRecentErrorCount(classification.category) > 5) ||
               context.userImpact === 'HIGH' ||
               context.financialImpact === 'HIGH';
    }
    
    suggestAction(error) {
        const category = this.determineCategory(error);
        const message = error.message.toLowerCase();
        
        const suggestions = {
            'NETWORK': 'Check network connectivity and RPC endpoints',
            'CONTRACT': 'Verify contract state and transaction parameters',
            'VALIDATION': 'Review input parameters and constraints',
            'SECURITY': 'Immediate security review required',
            'TIMEOUT': 'Increase timeout values or optimize operation',
            'RATE_LIMIT': 'Implement rate limiting or backoff strategy',
            'STORAGE': 'Check disk space and permissions',
            'MEMORY': 'Optimize memory usage or increase allocation',
            'SYSTEM': 'System-wide diagnostic required'
        };
        
        return suggestions[category] || 'Contact system administrator';
    }
    
    // ===== RETRY MECHANISM =====
    
    async executeWithRetry(operation, context = {}) {
        const operationId = this.generateOperationId();
        const maxRetries = context.maxRetries || this.options.maxRetries;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Executing operation ${operationId} (attempt ${attempt}/${maxRetries})`);
                
                const result = await this.executeWithCircuitBreaker(operation, context);
                
                // Log successful retry
                if (attempt > 1) {
                    this.logRetrySuccess(operationId, attempt);
                }
                
                return result;
                
            } catch (error) {
                const classification = this.classifyError(error, context);
                
                if (attempt === maxRetries) {
                    this.logRetryFailure(operationId, maxRetries, classification);
                    throw new Error(`Operation failed after ${maxRetries} attempts: ${error.message}`);
                }
                
                if (!classification.isRetryable) {
                    this.logNonRetryableError(operationId, classification);
                    throw error;
                }
                
                const delay = this.calculateRetryDelay(attempt, classification);
                console.log(`Retrying operation ${operationId} in ${delay}ms...`);
                await this.sleep(delay);
            }
        }
    }
    
    async executeWithCircuitBreaker(operation, context = {}) {
        const circuitBreakerKey = context.circuitBreakerKey || 'default';
        const circuitBreaker = this.getCircuitBreaker(circuitBreakerKey);
        
        return await circuitBreaker.execute(operation);
    }
    
    calculateRetryDelay(attempt, classification) {
        let delay = this.options.baseDelay * Math.pow(this.options.backoffMultiplier, attempt - 1);
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.1 * delay;
        delay += jitter;
        
        // Adjust based on error category
        if (classification.category === 'RATE_LIMIT') {
            delay *= 2; // Longer delay for rate limits
        } else if (classification.category === 'TIMEOUT') {
            delay *= 1.5; // Moderate delay for timeouts
        }
        
        return Math.min(delay, this.options.maxDelay);
    }
    
    // ===== CIRCUIT BREAKER =====
    
    initializeCircuitBreakers() {
        // Default circuit breaker
        this.circuitBreakers.set('default', new CircuitBreaker({
            failureThreshold: this.options.circuitBreakerThreshold,
            timeout: this.options.circuitBreakerTimeout
        }));
        
        // Oracle-specific circuit breaker
        this.circuitBreakers.set('oracle', new CircuitBreaker({
            failureThreshold: 3,
            timeout: 30000
        }));
        
        // Database circuit breaker
        this.circuitBreakers.set('database', new CircuitBreaker({
            failureThreshold: 5,
            timeout: 60000
        }));
    }
    
    getCircuitBreaker(key) {
        if (!this.circuitBreakers.has(key)) {
            this.circuitBreakers.set(key, new CircuitBreaker({
                failureThreshold: this.options.circuitBreakerThreshold,
                timeout: this.options.circuitBreakerTimeout
            }));
        }
        
        return this.circuitBreakers.get(key);
    }
    
    // ===== GRACEFUL DEGRADATION =====
    
    async executeWithFallback(primaryOperation, fallbackOperations, context = {}) {
        try {
            console.log('Attempting primary operation...');
            return await this.executeWithRetry(primaryOperation, context);
        } catch (primaryError) {
            console.warn('Primary operation failed, trying fallbacks:', primaryError.message);
            
            for (let i = 0; i < fallbackOperations.length; i++) {
                try {
                    console.log(`Attempting fallback operation ${i + 1}...`);
                    const result = await this.executeWithRetry(fallbackOperations[i], context);
                    console.log(`Fallback operation ${i + 1} succeeded`);
                    return result;
                } catch (fallbackError) {
                    console.warn(`Fallback operation ${i + 1} failed:`, fallbackError.message);
                    
                    if (i === fallbackOperations.length - 1) {
                        // All operations failed, try emergency response
                        return await this.executeEmergencyResponse(primaryError, context);
                    }
                }
            }
        }
    }
    
    async executeEmergencyResponse(error, context = {}) {
        console.error('All operations failed, executing emergency response...');
        
        // Log emergency situation
        this.logEmergency(error, context);
        
        // Send emergency alert
        await this.sendEmergencyAlert(error, context);
        
        // Return safe default or cached response if available
        return this.getSafeDefault(context);
    }
    
    getSafeDefault(context) {
        const defaults = {
            'oracle': { price: 0, timestamp: Date.now(), source: 'emergency_default' },
            'database': { data: null, cached: true },
            'network': { status: 'degraded', message: 'Service temporarily unavailable' }
        };
        
        return defaults[context.service] || { status: 'error', message: 'Service unavailable' };
    }
    
    // ===== LOGGING AND MONITORING =====
    
    logError(error, classification) {
        const logEntry = {
            timestamp: classification.timestamp,
            errorId: classification.errorId,
            category: classification.category,
            severity: classification.severity,
            message: error.message,
            stack: error.stack,
            context: classification.context,
            isRetryable: classification.isRetryable,
            suggestedAction: classification.suggestedAction
        };
        
        console.error(JSON.stringify(logEntry, null, 2));
        
        if (this.options.enableMetrics) {
            this.updateMetrics(classification);
        }
        
        if (classification.requiresEscalation && this.options.enableAlerts) {
            this.sendAlert(classification);
        }
    }
    
    logRetrySuccess(operationId, attempt) {
        console.log(`✅ Retry success for operation ${operationId} on attempt ${attempt}`);
        this.metrics.retrySuccessRate = (this.metrics.retrySuccessRate + 1) / 2; // Simple moving average
    }
    
    logRetryFailure(operationId, maxRetries, classification) {
        console.error(`❌ Retry failed for operation ${operationId} after ${maxRetries} attempts`);
        this.logError(new Error(`Retry failed after ${maxRetries} attempts`), classification);
    }
    
    logNonRetryableError(operationId, classification) {
        console.error(`❌ Non-retryable error for operation ${operationId}`);
        this.logError(new Error('Non-retryable error'), classification);
    }
    
    logEmergency(error, context) {
        const emergencyLog = {
            timestamp: new Date().toISOString(),
            type: 'EMERGENCY',
            error: error.message,
            context,
            systemState: this.getSystemState()
        };
        
        console.error('🚨 EMERGENCY:', JSON.stringify(emergencyLog, null, 2));
    }
    
    // ===== METRICS AND STATISTICS =====
    
    updateErrorStats(classification) {
        const key = `${classification.category}_${classification.severity}`;
        const current = this.errorStats.get(key) || { count: 0, lastOccurrence: null };
        
        current.count++;
        current.lastOccurrence = classification.timestamp;
        
        this.errorStats.set(key, current);
        this.metrics.totalErrors++;
    }
    
    updateMetrics(classification) {
        // Update category metrics
        if (!this.metrics.errorsByCategory[classification.category]) {
            this.metrics.errorsByCategory[classification.category] = 0;
        }
        this.metrics.errorsByCategory[classification.category]++;
        
        // Update severity metrics
        if (!this.metrics.errorsBySeverity[classification.severity]) {
            this.metrics.errorsBySeverity[classification.severity] = 0;
        }
        this.metrics.errorsBySeverity[classification.severity]++;
    }
    
    getRecentErrorCount(category, timeWindow = 300000) { // 5 minutes
        const cutoff = Date.now() - timeWindow;
        let count = 0;
        
        for (const [key, stats] of this.errorStats) {
            if (key.startsWith(category) && stats.lastOccurrence && new Date(stats.lastOccurrence).getTime() > cutoff) {
                count += stats.count;
            }
        }
        
        return count;
    }
    
    getSystemState() {
        return {
            timestamp: new Date().toISOString(),
            metrics: this.metrics,
            circuitBreakers: Object.fromEntries(
                Array.from(this.circuitBreakers.entries()).map(([key, cb]) => [key, cb.getState()])
            ),
            errorStats: Object.fromEntries(this.errorStats)
        };
    }
    
    // ===== ALERTING =====
    
    async sendAlert(classification) {
        const alert = {
            id: this.generateAlertId(),
            type: 'ERROR',
            severity: classification.severity,
            category: classification.category,
            message: classification.suggestedAction,
            timestamp: classification.timestamp,
            errorId: classification.errorId,
            context: classification.context
        };
        
        console.log('🚨 ALERT:', JSON.stringify(alert, null, 2));
        
        // Send to multiple alert channels
        await Promise.all([
            this.sendToDiscord(alert),
            this.sendToSlack(alert),
            this.sendToPagerDuty(alert)
        ]).catch(error => {
            console.error('Failed to send alerts:', error.message);
        });
    }
    
    async sendEmergencyAlert(error, context) {
        const alert = {
            id: this.generateAlertId(),
            type: 'EMERGENCY',
            severity: 'CRITICAL',
            message: 'All operations failed - emergency response activated',
            timestamp: new Date().toISOString(),
            error: error.message,
            context,
            systemState: this.getSystemState()
        };
        
        console.log('🚨🚨 EMERGENCY ALERT:', JSON.stringify(alert, null, 2));
        
        // Send emergency alerts with high priority
        await Promise.all([
            this.sendToDiscord(alert),
            this.sendToSlack(alert),
            this.sendToPagerDuty(alert),
            this.sendToEmail(alert)
        ]);
    }
    
    async sendToDiscord(alert) {
        if (!process.env.DISCORD_WEBHOOK_URL) return;
        
        const colors = {
            LOW: 0x00ff00,
            MEDIUM: 0xffff00,
            HIGH: 0xff6600,
            CRITICAL: 0xff0000,
            EMERGENCY: 0x8b0000
        };
        
        const payload = {
            embeds: [{
                title: `🚨 ${alert.severity} ${alert.type} ALERT`,
                description: alert.message,
                color: colors[alert.severity] || 0x808080,
                timestamp: alert.timestamp,
                fields: [
                    { name: 'Category', value: alert.category, inline: true },
                    { name: 'Error ID', value: alert.errorId || 'N/A', inline: true },
                    { name: 'Context', value: JSON.stringify(alert.context, null, 2), inline: false }
                ]
            }]
        };
        
        try {
            await fetch(process.env.DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('Failed to send Discord alert:', error.message);
        }
    }
    
    async sendToSlack(alert) {
        if (!process.env.SLACK_WEBHOOK_URL) return;
        
        const payload = {
            text: `🚨 ${alert.severity} ${alert.type} ALERT`,
            attachments: [{
                color: this.getSlackColor(alert.severity),
                text: alert.message,
                fields: [
                    { title: 'Category', value: alert.category, short: true },
                    { title: 'Error ID', value: alert.errorId || 'N/A', short: true },
                    { title: 'Context', value: JSON.stringify(alert.context, null, 2), short: false }
                ],
                ts: Math.floor(new Date(alert.timestamp).getTime() / 1000)
            }]
        };
        
        try {
            await fetch(process.env.SLACK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('Failed to send Slack alert:', error.message);
        }
    }
    
    async sendToPagerDuty(alert) {
        if (!process.env.PAGERDUTY_INTEGRATION_KEY) return;
        
        const payload = {
            routing_key: process.env.PAGERDUTY_INTEGRATION_KEY,
            event_action: 'trigger',
            payload: {
                summary: `${alert.severity} ${alert.type}: ${alert.message}`,
                source: 'fhe-oracle-bridge',
                severity: alert.severity.toLowerCase(),
                timestamp: alert.timestamp,
                custom_details: alert
            }
        };
        
        try {
            await fetch('https://events.pagerduty.com/v2/enqueue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('Failed to send PagerDuty alert:', error.message);
        }
    }
    
    async sendToEmail(alert) {
        // Email implementation would depend on your email service
        console.log('Email alert would be sent here:', alert);
    }
    
    // ===== UTILITY METHODS =====
    
    generateErrorId() {
        return crypto.randomBytes(16).toString('hex');
    }
    
    generateOperationId() {
        return crypto.randomBytes(8).toString('hex');
    }
    
    generateAlertId() {
        return crypto.randomBytes(16).toString('hex');
    }
    
    getSlackColor(severity) {
        const colors = {
            LOW: 'good',
            MEDIUM: 'warning',
            HIGH: 'danger',
            CRITICAL: 'danger',
            EMERGENCY: '#8b0000'
        };
        
        return colors[severity] || 'warning';
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ===== PUBLIC API =====
    
    getMetrics() {
        return {
            ...this.metrics,
            errorStats: Object.fromEntries(this.errorStats),
            circuitBreakers: Object.fromEntries(
                Array.from(this.circuitBreakers.entries()).map(([key, cb]) => [key, cb.getState()])
            ),
            timestamp: new Date().toISOString()
        };
    }
    
    resetMetrics() {
        this.errorStats.clear();
        this.metrics = {
            totalErrors: 0,
            errorsByCategory: {},
            errorsBySeverity: {},
            retrySuccessRate: 0,
            circuitBreakerActivations: 0
        };
        
        // Reset circuit breakers
        for (const circuitBreaker of this.circuitBreakers.values()) {
            circuitBreaker.reset();
        }
    }
}

// Circuit Breaker Implementation
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.timeout = options.timeout || 60000;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
        this.requestCount = 0;
    }
    
    async execute(operation) {
        this.requestCount++;
        
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = 'HALF_OPEN';
                this.successCount = 0;
                console.log('Circuit breaker transitioning to HALF_OPEN');
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
                console.log('Circuit breaker transitioning to CLOSED');
            }
        }
    }
    
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            console.log('Circuit breaker transitioning to OPEN');
        }
    }
    
    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            requestCount: this.requestCount,
            lastFailureTime: this.lastFailureTime
        };
    }
    
    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
        this.requestCount = 0;
    }
}

module.exports = ProductionErrorHandler;
