/**
 * Database Connection Manager
 * Manages Supabase connections and provides centralized database access
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config/environment.ts";
import { Logger } from "../utils/logger.ts";

export interface DatabaseStats {
  activeConnections: number;
  totalQueries: number;
  avgQueryTime: number;
  lastQueryTime?: string;
  errorCount: number;
}

export class DatabaseConnection {
  private client: SupabaseClient | null = null;
  private logger: Logger;
  private stats: DatabaseStats = {
    activeConnections: 0,
    totalQueries: 0,
    avgQueryTime: 0,
    errorCount: 0
  };
  private queryTimes: number[] = [];

  constructor() {
    this.logger = new Logger('DatabaseConnection');
  }

  /**
   * Initialize the database connection
   */
  async connect(): Promise<void> {
    try {
      this.logger.info('Initializing Supabase client...');

      this.client = createClient(
        config.supabase.url,
        config.supabase.serviceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          },
          db: {
            schema: 'public'
          }
        }
      );

      // Test connection
      await this.testConnection();
      
      this.stats.activeConnections = 1;
      this.logger.info('Database connection established successfully', {
        url: config.supabase.url,
        environment: config.environment
      });

    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw new Error(`Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Test the database connection
   */
  private async testConnection(): Promise<void> {
    if (!this.client) {
      throw new Error('Database client not initialized');
    }

    const startTime = Date.now();
    
    try {
      // Simple query to test connection
      const { data, error } = await this.client
        .from('venue')
        .select('id')
        .limit(1);

      if (error) {
        throw error;
      }

      const queryTime = Date.now() - startTime;
      this.trackQueryPerformance(queryTime);
      
      this.logger.debug('Database connection test successful', {
        query_time_ms: queryTime,
        rows_returned: data?.length || 0
      });

    } catch (error) {
      this.stats.errorCount++;
      throw new Error(`Database connection test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the Supabase client instance
   */
  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Execute a raw SQL query
   */
  async query<T = any>(sql: string, params?: any[]): Promise<{ data: T[] | null; error: any }> {
    if (!this.client) {
      throw new Error('Database not connected');
    }

    const startTime = Date.now();
    this.stats.totalQueries++;

    try {
      this.logger.debug('Executing SQL query', { 
        sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
        params_count: params?.length || 0
      });

      // Use RPC for raw SQL if needed, or structure as Supabase query
      const result = await this.client.rpc('execute_sql', { 
        sql_query: sql, 
        sql_params: params || [] 
      });

      const queryTime = Date.now() - startTime;
      this.trackQueryPerformance(queryTime);
      this.stats.lastQueryTime = new Date().toISOString();

      if (result.error) {
        this.stats.errorCount++;
        this.logger.error('SQL query failed', result.error, { sql, queryTime });
      } else {
        this.logger.debug('SQL query completed', { 
          queryTime, 
          rowCount: result.data?.length || 0 
        });
      }

      return result;

    } catch (error) {
      const queryTime = Date.now() - startTime;
      this.stats.errorCount++;
      this.logger.error('Database query exception', error, { sql, queryTime });
      
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: (client: SupabaseClient) => Promise<T>): Promise<T> {
    if (!this.client) {
      throw new Error('Database not connected');
    }

    const startTime = Date.now();
    this.logger.debug('Starting database transaction');

    try {
      // Supabase doesn't have explicit transactions in the client library
      // Instead, we rely on the database's ACID properties
      const result = await callback(this.client);
      
      const duration = Date.now() - startTime;
      this.logger.info('Transaction completed successfully', { duration_ms: duration });
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Transaction failed', error, { duration_ms: duration });
      throw error;
    }
  }

  /**
   * Track query performance metrics
   */
  private trackQueryPerformance(queryTime: number): void {
    this.queryTimes.push(queryTime);
    
    // Keep only the last 1000 query times for moving average
    if (this.queryTimes.length > 1000) {
      this.queryTimes = this.queryTimes.slice(-1000);
    }
    
    // Calculate moving average
    this.stats.avgQueryTime = this.queryTimes.reduce((sum, time) => sum + time, 0) / this.queryTimes.length;
  }

  /**
   * Get database performance statistics
   */
  getStats(): DatabaseStats {
    return { ...this.stats };
  }

  /**
   * Health check for the database connection
   */
  async healthCheck(): Promise<{ healthy: boolean; metrics: DatabaseStats; details?: string }> {
    try {
      await this.testConnection();
      
      return {
        healthy: true,
        metrics: this.getStats()
      };

    } catch (error) {
      return {
        healthy: false,
        metrics: this.getStats(),
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Close the database connection
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      // Supabase client doesn't require explicit disconnection
      this.client = null;
      this.stats.activeConnections = 0;
      this.logger.info('Database connection closed');
    }
  }

  /**
   * Reset connection statistics
   */
  resetStats(): void {
    this.stats = {
      activeConnections: this.stats.activeConnections,
      totalQueries: 0,
      avgQueryTime: 0,
      errorCount: 0
    };
    this.queryTimes = [];
    this.logger.info('Database statistics reset');
  }
}