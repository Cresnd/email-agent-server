/**
 * Retry and error recovery management system
 * Handles automatic retries, exponential backoff, and circuit breaker patterns
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number; // Base delay in ms
  maxDelay: number; // Maximum delay in ms
  exponentialBase: number; // Base for exponential backoff
  jitter: boolean; // Add random jitter to prevent thundering herd
}

export interface RetryResult<T> {
  result?: T;
  success: boolean;
  attempts: number;
  totalTime: number;
  lastError?: Error;
}

export class RetryManager {
  private defaultOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    exponentialBase: 2,
    jitter: true
  };

  /**
   * Execute a function with retry logic
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxAttempts?: number,
    baseDelay?: number
  ): Promise<T> {
    
    const options: RetryOptions = {
      ...this.defaultOptions,
      ...(maxAttempts && { maxAttempts }),
      ...(baseDelay && { baseDelay })
    };

    const result = await this.retryWithOptions(fn, options);
    
    if (!result.success) {
      throw result.lastError || new Error('Operation failed after all retry attempts');
    }

    return result.result!;
  }

  /**
   * Execute with full retry options configuration
   */
  async retryWithOptions<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions>
  ): Promise<RetryResult<T>> {
    
    const config: RetryOptions = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const result = await fn();
        return {
          result,
          success: true,
          attempts: attempt,
          totalTime: Date.now() - startTime
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Log retry attempt
        console.warn(`Attempt ${attempt}/${config.maxAttempts} failed:`, lastError.message);

        // Don't wait after the last attempt
        if (attempt < config.maxAttempts) {
          const delay = this.calculateDelay(attempt, config);
          await this.sleep(delay);
        }
      }
    }

    return {
      success: false,
      attempts: config.maxAttempts,
      totalTime: Date.now() - startTime,
      lastError
    };
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(error: Error): boolean {
    // Network errors are typically retryable
    if (error.message.includes('fetch')) {
      return true;
    }

    // Rate limiting errors are retryable
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return true;
    }

    // Timeout errors are retryable
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return true;
    }

    // Connection errors are retryable
    if (error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
      return true;
    }

    // Server errors (5xx) are typically retryable
    if (error.message.includes('500') || error.message.includes('502') || 
        error.message.includes('503') || error.message.includes('504')) {
      return true;
    }

    // Client errors (4xx) are typically not retryable, except for specific cases
    if (error.message.includes('400') || error.message.includes('401') || 
        error.message.includes('403') || error.message.includes('404')) {
      return false;
    }

    // Default: retry unknown errors
    return true;
  }

  /**
   * Execute with conditional retry based on error type
   */
  async executeWithConditionalRetry<T>(
    fn: () => Promise<T>,
    isRetryable: (error: Error) => boolean = this.isRetryableError.bind(this),
    options?: Partial<RetryOptions>
  ): Promise<T> {
    
    const config: RetryOptions = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await fn();

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if error is retryable
        if (!isRetryable(lastError)) {
          console.warn(`Non-retryable error encountered:`, lastError.message);
          throw lastError;
        }

        console.warn(`Retryable error on attempt ${attempt}/${config.maxAttempts}:`, lastError.message);

        // Don't wait after the last attempt
        if (attempt < config.maxAttempts) {
          const delay = this.calculateDelay(attempt, config);
          await this.sleep(delay);
        }
      }
    }

    // All attempts exhausted
    throw lastError || new Error('Operation failed after all retry attempts');
  }

  /**
   * Create a circuit breaker for a function
   */
  createCircuitBreaker<T>(
    fn: () => Promise<T>,
    options: {
      failureThreshold: number; // Number of failures before opening circuit
      resetTimeout: number; // Time to wait before attempting reset (ms)
      monitoringPeriod: number; // Time window for failure counting (ms)
    }
  ): () => Promise<T> {
    
    let state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    let failures = 0;
    let lastFailureTime = 0;
    let nextAttemptTime = 0;

    return async (): Promise<T> => {
      const now = Date.now();

      // Reset failure count if monitoring period has passed
      if (now - lastFailureTime > options.monitoringPeriod) {
        failures = 0;
      }

      // Handle circuit states
      switch (state) {
        case 'OPEN':
          if (now < nextAttemptTime) {
            throw new Error('Circuit breaker is OPEN - too many failures');
          }
          state = 'HALF_OPEN';
          break;

        case 'HALF_OPEN':
          // Allow one attempt to test if service is recovered
          break;

        case 'CLOSED':
          // Normal operation
          break;
      }

      try {
        const result = await fn();

        // Success - reset circuit if it was half-open
        if (state === 'HALF_OPEN') {
          state = 'CLOSED';
          failures = 0;
        }

        return result;

      } catch (error) {
        failures++;
        lastFailureTime = now;

        if (failures >= options.failureThreshold) {
          state = 'OPEN';
          nextAttemptTime = now + options.resetTimeout;
        } else if (state === 'HALF_OPEN') {
          // Failed during half-open, go back to open
          state = 'OPEN';
          nextAttemptTime = now + options.resetTimeout;
        }

        throw error;
      }
    };
  }

  // Private helper methods

  private calculateDelay(attempt: number, options: RetryOptions): number {
    // Calculate exponential backoff delay
    let delay = options.baseDelay * Math.pow(options.exponentialBase, attempt - 1);
    
    // Apply maximum delay limit
    delay = Math.min(delay, options.maxDelay);
    
    // Add jitter if enabled
    if (options.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5); // 50-100% of calculated delay
    }
    
    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}