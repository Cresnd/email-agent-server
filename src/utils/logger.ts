/**
 * Centralized Logging System
 * Provides structured logging with multiple output targets and log levels
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: any;
  error?: Error;
}

export class Logger {
  private module: string;
  private static logLevel: LogLevel = 'info';
  private static enableConsole = true;
  private static enableFile = false;

  constructor(module: string) {
    this.module = module;
  }

  static configure(options: {
    level?: LogLevel;
    enableConsole?: boolean;
    enableFile?: boolean;
  }) {
    if (options.level) Logger.logLevel = options.level;
    if (options.enableConsole !== undefined) Logger.enableConsole = options.enableConsole;
    if (options.enableFile !== undefined) Logger.enableFile = options.enableFile;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };

    return levels[level] >= levels[Logger.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, data?: any, error?: Error): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      data: data ? this.sanitizeData(data) : undefined,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } as any : undefined
    };
  }

  private sanitizeData(data: any): any {
    // Remove sensitive information from logs
    if (typeof data === 'object' && data !== null) {
      const sanitized = { ...data };
      
      // List of sensitive field names to redact
      const sensitiveFields = ['password', 'token', 'key', 'secret', 'auth', 'credential'];
      
      for (const field of sensitiveFields) {
        if (field in sanitized) {
          sanitized[field] = '[REDACTED]';
        }
      }
      
      return sanitized;
    }
    
    return data;
  }

  private output(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    // Console output
    if (Logger.enableConsole) {
      const colorCodes: Record<LogLevel, string> = {
        debug: '\x1b[36m', // Cyan
        info: '\x1b[32m',  // Green
        warn: '\x1b[33m',  // Yellow
        error: '\x1b[31m'  // Red
      };
      const resetCode = '\x1b[0m';

      const baseMessage = `${colorCodes[entry.level]}[${entry.timestamp}] ${entry.level.toUpperCase()} [${entry.module}] ${entry.message}${resetCode}`;
      
      if (entry.data) {
        console.log(baseMessage, entry.data);
      } else {
        console.log(baseMessage);
      }

      if (entry.error) {
        console.error('Error details:', entry.error);
      }
    }

    // File output (if enabled)
    if (Logger.enableFile) {
      this.writeToFile(entry);
    }
  }

  private async writeToFile(entry: LogEntry): Promise<void> {
    try {
      const logDir = './logs';
      const logFile = `${logDir}/email-agent-${new Date().toISOString().split('T')[0]}.log`;
      
      // Ensure log directory exists
      try {
        await Deno.stat(logDir);
      } catch {
        await Deno.mkdir(logDir, { recursive: true });
      }

      const logLine = JSON.stringify(entry) + '\n';
      await Deno.writeTextFile(logFile, logLine, { append: true });
    } catch (error) {
      // Fallback to console if file logging fails
      console.error('Failed to write to log file:', error);
    }
  }

  debug(message: string, data?: any): void {
    this.output(this.formatMessage('debug', message, data));
  }

  info(message: string, data?: any): void {
    this.output(this.formatMessage('info', message, data));
  }

  warn(message: string, data?: any): void {
    this.output(this.formatMessage('warn', message, data));
  }

  error(message: string, error?: Error | any, data?: any): void {
    const resolvedMessage = error?.message ?? String(error);
    const errorObj = error instanceof Error ? error : new Error(resolvedMessage);
    const mergedData = error && !(error instanceof Error)
      ? { ...(data || {}), error_details: this.sanitizeData(error) }
      : data;
    this.output(this.formatMessage('error', message, mergedData, errorObj));
  }

  /**
   * Create a child logger with additional context
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`);
  }

  /**
   * Time a function execution
   */
  async time<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    this.debug(`Starting ${operation}`);
    
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.info(`Completed ${operation}`, { duration_ms: duration });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(`Failed ${operation}`, error, { duration_ms: duration });
      throw error;
    }
  }

  /**
   * Log with performance metrics
   */
  perf(message: string, metrics: Record<string, number | string>): void {
    this.info(`[PERF] ${message}`, metrics);
  }

  /**
   * Log business events for audit trail
   */
  audit(event: string, details: Record<string, any>): void {
    this.info(`[AUDIT] ${event}`, {
      ...details,
      timestamp: new Date().toISOString(),
      module: this.module
    });
  }
}
