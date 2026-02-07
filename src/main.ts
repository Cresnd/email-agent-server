/**
 * Email Agent Server - Main Entry Point
 * 
 * A deterministic, real-time workflow execution system for email processing
 * and agent orchestration, designed to integrate with the Cresnd AI v2 platform.
 */

import { Application, Router } from "@oak/oak";
import { config } from "./config/environment.ts";
import { DatabaseConnection } from "./database/connection.ts";
import { WorkflowExecutor } from "./workflow-engine/executor.ts";
import { WebSocketServer } from "./realtime/websocket-server.ts";
import { EmailProcessor } from "./email-processing/router.ts";
import { AgentManager } from "./agent-system/agent-manager.ts";
import { Logger, LogLevel } from "./utils/logger.ts";

// Configure global log level from environment (e.g., LOG_LEVEL=debug)
const envLogLevel = Deno.env.get('LOG_LEVEL') as LogLevel | undefined;
if (envLogLevel) {
  Logger.configure({ level: envLogLevel });
}

class EmailAgentServer {
  private app: Application;
  private database: DatabaseConnection;
  private workflowExecutor: WorkflowExecutor;
  private webSocketServer: WebSocketServer;
  private emailProcessor: EmailProcessor;
  private agentManager: AgentManager;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('EmailAgentServer');
    this.app = new Application();
    this.database = new DatabaseConnection();
    this.workflowExecutor = new WorkflowExecutor();
    this.webSocketServer = new WebSocketServer();
    this.emailProcessor = new EmailProcessor();
    this.agentManager = new AgentManager();
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Email Agent Server...');

      // Initialize database connection
      await this.database.connect();
      this.logger.info('Database connection established');

      // Workflow executor ready (no initialization needed)
      this.logger.info('Workflow executor ready');

      // Agent manager ready (no initialization needed)
      this.logger.info('Agent manager ready');

      // Email processor ready (no initialization needed)
      this.logger.info('Email processor ready');

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Initialize WebSocket server
      await this.webSocketServer.initialize(this.app);
      this.logger.info('WebSocket server initialized');

      this.logger.info('Email Agent Server initialization complete');

    } catch (error) {
      this.logger.error('Failed to initialize Email Agent Server:', error);
      throw error;
    }
  }

  private setupMiddleware(): void {
    // CORS middleware
    this.app.use(async (ctx, next) => {
      ctx.response.headers.set('Access-Control-Allow-Origin', '*');
      ctx.response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      ctx.response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (ctx.request.method === 'OPTIONS') {
        ctx.response.status = 200;
        return;
      }
      
      await next();
    });

    // Request logging middleware
    this.app.use(async (ctx, next) => {
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      this.logger.info(`${ctx.request.method} ${ctx.request.url} - ${ctx.response.status} - ${ms}ms`);
    });

    // Error handling middleware
    this.app.use(async (ctx, next) => {
      try {
        await next();
      } catch (error) {
        this.logger.error('Request error:', error);
        ctx.response.status = error.status || 500;
        ctx.response.body = {
          error: error.message || 'Internal Server Error',
          timestamp: new Date().toISOString(),
          path: ctx.request.url.pathname
        };
      }
    });
  }

  private setupRoutes(): void {
    const router = new Router();
    const emailRouter = this.emailProcessor.getRouter();

    // Health check endpoint
    router.get('/health', (ctx) => {
      ctx.response.body = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: {
          database: this.database.isConnected(),
          workflow_executor: this.workflowExecutor.isReady(),
          email_processor: this.emailProcessor.isReady(),
          agent_manager: this.agentManager.isReady()
        }
      };
    });

    // Workflow API routes
    router.get('/api/workflows', async (ctx) => {
      // TODO: Implement workflow listing
      ctx.response.body = { message: 'Workflow listing endpoint' };
    });

    router.post('/api/workflows', async (ctx) => {
      // TODO: Implement workflow creation
      ctx.response.body = { message: 'Workflow creation endpoint' };
    });

    router.get('/api/workflows/:id', async (ctx) => {
      // TODO: Implement workflow retrieval
      const workflowId = ctx.params.id;
      ctx.response.body = { message: `Workflow ${workflowId} details` };
    });

    router.put('/api/workflows/:id', async (ctx) => {
      // TODO: Implement workflow update
      const workflowId = ctx.params.id;
      ctx.response.body = { message: `Updated workflow ${workflowId}` };
    });

    router.delete('/api/workflows/:id', async (ctx) => {
      // TODO: Implement workflow deletion
      const workflowId = ctx.params.id;
      ctx.response.body = { message: `Deleted workflow ${workflowId}` };
    });

    // Execution API routes
    router.get('/api/executions', async (ctx) => {
      // TODO: Implement execution listing
      ctx.response.body = { message: 'Execution listing endpoint' };
    });

    router.post('/api/executions', async (ctx) => {
      // TODO: Implement execution triggering
      ctx.response.body = { message: 'Execution trigger endpoint' };
    });

    router.get('/api/executions/:id', async (ctx) => {
      // TODO: Implement execution status retrieval
      const executionId = ctx.params.id;
      ctx.response.body = { message: `Execution ${executionId} status` };
    });

    router.post('/api/executions/:id/cancel', async (ctx) => {
      // TODO: Implement execution cancellation
      const executionId = ctx.params.id;
      ctx.response.body = { message: `Cancelled execution ${executionId}` };
    });

    // Agent API routes
    router.get('/api/agents', async (ctx) => {
      // TODO: Implement agent listing
      ctx.response.body = { message: 'Agent listing endpoint' };
    });

    router.get('/api/agents/:type/status', async (ctx) => {
      // TODO: Implement agent status check
      const agentType = ctx.params.type;
      ctx.response.body = { message: `Agent ${agentType} status` };
    });

    // Email processing API routes
    router.get('/api/emails/status', async (ctx) => {
      // TODO: Implement email processing status
      ctx.response.body = { message: 'Email processing status endpoint' };
    });

    router.post('/api/emails/process', async (ctx) => {
      // TODO: Implement manual email processing
      ctx.response.body = { message: 'Manual email processing endpoint' };
    });

    // Apply email processing routes
    this.app.use(emailRouter.routes());
    this.app.use(emailRouter.allowedMethods());

    // Apply core routes to the application
    this.app.use(router.routes());
    this.app.use(router.allowedMethods());
  }

  async start(): Promise<void> {
    const port = config?.server?.port || 8000;
    const host = config?.server?.host || 'localhost';

    this.logger.info(`Starting Email Agent Server on ${host}:${port}`);
    
    await this.app.listen({ 
      port, 
      hostname: host
    });
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Email Agent Server...');

    try {
      // Graceful shutdown sequence
      await this.webSocketServer.shutdown();
      await this.emailProcessor.shutdown();
      await this.workflowExecutor.shutdown();
      await this.agentManager.shutdown();
      await this.database.disconnect();

      this.logger.info('Email Agent Server shutdown complete');
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      throw error;
    }
  }
}

// Global error handlers
globalThis.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);
});

globalThis.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rejection:', event.reason);
});

// Application lifecycle management
async function main() {
  const server = new EmailAgentServer();

  try {
    await server.initialize();
    
    // Setup graceful shutdown
    const shutdownHandler = async () => {
      console.log('Received shutdown signal, gracefully shutting down...');
      try {
        await server.shutdown();
        Deno.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        Deno.exit(1);
      }
    };

    // Handle various shutdown signals
    Deno.addSignalListener('SIGTERM', shutdownHandler);
    Deno.addSignalListener('SIGINT', shutdownHandler);

    // Start the server
    await server.start();

  } catch (error) {
    console.error('Failed to start Email Agent Server:', error);
    Deno.exit(1);
  }
}

// Start the application
if (import.meta.main) {
  main();
}

export { EmailAgentServer };
