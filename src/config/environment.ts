/**
 * Environment Configuration
 * Centralized configuration management for the Email Agent Server
 */

export interface ServerConfig {
  // Server settings
  port: number;
  host: string;
  environment: 'development' | 'staging' | 'production';
  
  // Database configuration
  supabase: {
    url: string;
    serviceRoleKey: string;
    anonKey: string;
  };
  
  // Email infrastructure
  email: {
    defaultTimeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  
  // AI services
  ai: {
    openaiApiKey?: string;
    anthropicApiKey?: string;
    defaultModel: string;
  };
  
  // Real-time settings
  websocket: {
    enabled: boolean;
    pingInterval: number;
    connectionTimeout: number;
  };
  
  // Logging
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableConsole: boolean;
    enableFile: boolean;
    maxFileSize: string;
  };
  
  // Security
  security: {
    corsOrigins: string[];
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
  };
}

class EnvironmentConfig {
  public readonly config: ServerConfig;

  constructor() {
    this.config = this.loadConfiguration();
    this.validateConfiguration();
  }

  private loadConfiguration(): ServerConfig {
    return {
      // Server settings
      port: parseInt(Deno.env.get('PORT') || '8080'),
      host: Deno.env.get('HOST') || '0.0.0.0',
      environment: (Deno.env.get('DENO_ENV') || 'development') as ServerConfig['environment'],
      
      // Database configuration
      supabase: {
        url: Deno.env.get('SUPABASE_URL') || '',
        serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
        anonKey: Deno.env.get('SUPABASE_ANON_KEY') || ''
      },
      
      // Email infrastructure
      email: {
        defaultTimeout: parseInt(Deno.env.get('EMAIL_TIMEOUT') || '30000'),
        retryAttempts: parseInt(Deno.env.get('EMAIL_RETRY_ATTEMPTS') || '3'),
        retryDelay: parseInt(Deno.env.get('EMAIL_RETRY_DELAY') || '1000')
      },
      
      // AI services
      ai: {
        openaiApiKey: Deno.env.get('OPENAI_API_KEY'),
        anthropicApiKey: Deno.env.get('ANTHROPIC_API_KEY'),
        defaultModel: Deno.env.get('DEFAULT_AI_MODEL') || 'gpt-4.1-mini'
      },
      
      // Real-time settings
      websocket: {
        enabled: Deno.env.get('WEBSOCKET_ENABLED') === 'true',
        pingInterval: parseInt(Deno.env.get('WEBSOCKET_PING_INTERVAL') || '30000'),
        connectionTimeout: parseInt(Deno.env.get('WEBSOCKET_TIMEOUT') || '60000')
      },
      
      // Logging
      logging: {
        level: (Deno.env.get('LOG_LEVEL') || 'info') as ServerConfig['logging']['level'],
        enableConsole: Deno.env.get('LOG_CONSOLE') !== 'false',
        enableFile: Deno.env.get('LOG_FILE') === 'true',
        maxFileSize: Deno.env.get('LOG_MAX_FILE_SIZE') || '10MB'
      },
      
      // Security
      security: {
        corsOrigins: Deno.env.get('CORS_ORIGINS')?.split(',') || ['*'],
        rateLimitWindowMs: parseInt(Deno.env.get('RATE_LIMIT_WINDOW_MS') || '900000'), // 15 minutes
        rateLimitMaxRequests: parseInt(Deno.env.get('RATE_LIMIT_MAX_REQUESTS') || '100')
      }
    };
  }

  private validateConfiguration(): void {
    const errors: string[] = [];

    // Validate required environment variables
    if (!this.config.supabase.url) {
      errors.push('SUPABASE_URL is required');
    }
    if (!this.config.supabase.serviceRoleKey) {
      errors.push('SUPABASE_SERVICE_ROLE_KEY is required');
    }

    // Validate AI configuration (at least one provider)
    if (!this.config.ai.openaiApiKey && !this.config.ai.anthropicApiKey) {
      console.warn('Warning: No AI provider API keys configured. AI features may not work.');
    }

    // Validate numeric configurations
    if (this.config.port < 1 || this.config.port > 65535) {
      errors.push('PORT must be between 1 and 65535');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Check if running in development mode
   */
  isDevelopment(): boolean {
    return this.config.environment === 'development';
  }

  /**
   * Check if running in production mode
   */
  isProduction(): boolean {
    return this.config.environment === 'production';
  }

  /**
   * Get database connection string for MCP
   */
  getDatabaseUrl(): string {
    return `${this.config.supabase.url}`;
  }

  /**
   * Get full server URL
   */
  getServerUrl(): string {
    const protocol = this.isProduction() ? 'https' : 'http';
    const defaultPort = this.isProduction() ? (protocol === 'https' ? 443 : 80) : this.config.port;
    const portSuffix = this.config.port === defaultPort ? '' : `:${this.config.port}`;
    
    return `${protocol}://${this.config.host}${portSuffix}`;
  }
}

// Export singleton instance
export const config = new EnvironmentConfig().config;

// Export configuration utility
export { EnvironmentConfig };