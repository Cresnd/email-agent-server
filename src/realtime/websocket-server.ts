/**
 * WebSocket Server for Real-time Email Processing Updates
 * Provides real-time updates on email processing pipeline execution
 */

import { Logger } from '../utils/logger.ts';

export interface WebSocketMessage {
  type: 'pipeline_started' | 'pipeline_completed' | 'pipeline_failed' | 
        'agent_started' | 'agent_completed' | 'agent_failed' | 
        'email_processed' | 'system_status';
  data: any;
  timestamp: string;
  agent_run_id?: string;
}

export interface WebSocketClient {
  id: string;
  socket: WebSocket;
  subscriptions: string[]; // venue_ids or agent_run_ids
  connected_at: string;
  last_ping: string;
}

export class WebSocketServer {
  private clients: Map<string, WebSocketClient> = new Map();
  private logger: Logger;
  private pingInterval: number = 30000; // 30 seconds
  private connectionTimeout: number = 60000; // 60 seconds
  private pingTimer?: number;

  constructor() {
    this.logger = new Logger('WebSocketServer');
  }

  /**
   * Initialize the WebSocket server
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing WebSocket server...');
    
    // Start ping interval for connection health checks
    this.pingTimer = setInterval(() => {
      this.pingAllClients();
    }, this.pingInterval);
    
    this.logger.info('WebSocket server initialized', {
      ping_interval_ms: this.pingInterval,
      connection_timeout_ms: this.connectionTimeout
    });
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(socket: WebSocket, clientId: string): void {
    this.logger.info('New WebSocket connection', { client_id: clientId });

    const client: WebSocketClient = {
      id: clientId,
      socket,
      subscriptions: [],
      connected_at: new Date().toISOString(),
      last_ping: new Date().toISOString()
    };

    this.clients.set(clientId, client);

    // Set up event handlers
    socket.onmessage = (event) => {
      this.handleMessage(clientId, event);
    };

    socket.onclose = () => {
      this.handleDisconnection(clientId);
    };

    socket.onerror = (error) => {
      this.logger.error('WebSocket error', error, { client_id: clientId });
    };

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'system_status',
      data: {
        message: 'Connected to Email Agent Server',
        server_time: new Date().toISOString(),
        client_id: clientId
      },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(clientId: string, event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      const client = this.clients.get(clientId);

      if (!client) return;

      this.logger.debug('WebSocket message received', { 
        client_id: clientId, 
        message_type: message.type 
      });

      switch (message.type) {
        case 'ping':
          client.last_ping = new Date().toISOString();
          this.sendToClient(clientId, {
            type: 'system_status',
            data: { message: 'pong' },
            timestamp: new Date().toISOString()
          });
          break;

        case 'subscribe':
          this.handleSubscription(clientId, message.data);
          break;

        case 'unsubscribe':
          this.handleUnsubscription(clientId, message.data);
          break;

        default:
          this.logger.warn('Unknown WebSocket message type', { 
            client_id: clientId, 
            message_type: message.type 
          });
      }

    } catch (error) {
      this.logger.error('Error handling WebSocket message', error, { client_id: clientId });
    }
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      const connectionDuration = Date.now() - new Date(client.connected_at).getTime();
      
      this.logger.info('WebSocket client disconnected', { 
        client_id: clientId,
        connection_duration_ms: connectionDuration,
        subscriptions: client.subscriptions
      });

      this.clients.delete(clientId);
    }
  }

  /**
   * Handle subscription to venue or agent run updates
   */
  private handleSubscription(clientId: string, subscriptionData: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { venue_id, agent_run_id } = subscriptionData;

    if (venue_id && !client.subscriptions.includes(venue_id)) {
      client.subscriptions.push(venue_id);
      this.logger.debug('Client subscribed to venue', { client_id: clientId, venue_id });
    }

    if (agent_run_id && !client.subscriptions.includes(agent_run_id)) {
      client.subscriptions.push(agent_run_id);
      this.logger.debug('Client subscribed to agent run', { client_id: clientId, agent_run_id });
    }

    this.sendToClient(clientId, {
      type: 'system_status',
      data: { 
        message: 'Subscription updated',
        subscriptions: client.subscriptions
      },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle unsubscription
   */
  private handleUnsubscription(clientId: string, subscriptionData: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { venue_id, agent_run_id } = subscriptionData;

    if (venue_id) {
      client.subscriptions = client.subscriptions.filter(sub => sub !== venue_id);
    }

    if (agent_run_id) {
      client.subscriptions = client.subscriptions.filter(sub => sub !== agent_run_id);
    }

    this.sendToClient(clientId, {
      type: 'system_status',
      data: { 
        message: 'Unsubscribed',
        subscriptions: client.subscriptions
      },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(clientId: string, message: WebSocketMessage): void {
    const client = this.clients.get(clientId);
    
    if (client && client.socket.readyState === WebSocket.OPEN) {
      try {
        client.socket.send(JSON.stringify(message));
      } catch (error) {
        this.logger.error('Failed to send message to client', error, { client_id: clientId });
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Broadcast message to all clients subscribed to a venue or agent run
   */
  broadcast(venueId: string | undefined, agentRunId: string | undefined, message: WebSocketMessage): void {
    let targetClients = 0;

    for (const [clientId, client] of this.clients.entries()) {
      let shouldSend = false;

      // Check if client is subscribed to the venue
      if (venueId && client.subscriptions.includes(venueId)) {
        shouldSend = true;
      }

      // Check if client is subscribed to the agent run
      if (agentRunId && client.subscriptions.includes(agentRunId)) {
        shouldSend = true;
      }

      if (shouldSend) {
        this.sendToClient(clientId, message);
        targetClients++;
      }
    }

    this.logger.debug('Message broadcasted', {
      venue_id: venueId,
      agent_run_id: agentRunId,
      target_clients: targetClients,
      message_type: message.type
    });
  }

  /**
   * Broadcast to all connected clients
   */
  broadcastToAll(message: WebSocketMessage): void {
    for (const [clientId] of this.clients.entries()) {
      this.sendToClient(clientId, message);
    }

    this.logger.debug('Message broadcasted to all clients', {
      client_count: this.clients.size,
      message_type: message.type
    });
  }

  /**
   * Ping all connected clients to check connection health
   */
  private pingAllClients(): void {
    const now = new Date();
    const clientsToRemove: string[] = [];

    for (const [clientId, client] of this.clients.entries()) {
      const lastPingTime = new Date(client.last_ping).getTime();
      const timeSinceLastPing = now.getTime() - lastPingTime;

      if (timeSinceLastPing > this.connectionTimeout) {
        this.logger.warn('Client connection timeout', { 
          client_id: clientId,
          time_since_last_ping_ms: timeSinceLastPing
        });
        clientsToRemove.push(clientId);
      } else {
        // Send ping
        this.sendToClient(clientId, {
          type: 'system_status',
          data: { message: 'ping' },
          timestamp: now.toISOString()
        });
      }
    }

    // Remove timed-out clients
    for (const clientId of clientsToRemove) {
      const client = this.clients.get(clientId);
      if (client) {
        client.socket.close();
        this.clients.delete(clientId);
      }
    }

    if (clientsToRemove.length > 0) {
      this.logger.info('Removed timed-out clients', { removed_count: clientsToRemove.length });
    }
  }

  /**
   * Get current connection statistics
   */
  getStats(): { connected_clients: number; total_subscriptions: number } {
    let totalSubscriptions = 0;

    for (const client of this.clients.values()) {
      totalSubscriptions += client.subscriptions.length;
    }

    return {
      connected_clients: this.clients.size,
      total_subscriptions: totalSubscriptions
    };
  }

  /**
   * Shutdown the WebSocket server
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down WebSocket server...');

    // Clear ping timer
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }

    // Close all client connections
    for (const [clientId, client] of this.clients.entries()) {
      client.socket.close();
      this.clients.delete(clientId);
    }

    this.logger.info('WebSocket server shutdown complete');
  }

  // Pipeline event broadcasting methods

  /**
   * Notify clients when email processing pipeline starts
   */
  notifyPipelineStarted(venueId: string, agentRunId: string, emailData: any): void {
    this.broadcast(venueId, agentRunId, {
      type: 'pipeline_started',
      data: {
        agent_run_id: agentRunId,
        venue_id: venueId,
        customer_email: emailData.customer_email,
        subject: emailData.subject
      },
      timestamp: new Date().toISOString(),
      agent_run_id: agentRunId
    });
  }

  /**
   * Notify clients when email processing pipeline completes
   */
  notifyPipelineCompleted(venueId: string, agentRunId: string, result: any): void {
    this.broadcast(venueId, agentRunId, {
      type: 'pipeline_completed',
      data: {
        agent_run_id: agentRunId,
        venue_id: venueId,
        success: result.success,
        total_execution_time_ms: result.total_execution_time_ms,
        final_status: result.final_status
      },
      timestamp: new Date().toISOString(),
      agent_run_id: agentRunId
    });
  }

  /**
   * Notify clients when individual agent starts
   */
  notifyAgentStarted(venueId: string, agentRunId: string, agentType: string): void {
    this.broadcast(venueId, agentRunId, {
      type: 'agent_started',
      data: {
        agent_run_id: agentRunId,
        venue_id: venueId,
        agent_type: agentType
      },
      timestamp: new Date().toISOString(),
      agent_run_id: agentRunId
    });
  }

  /**
   * Notify clients when individual agent completes
   */
  notifyAgentCompleted(venueId: string, agentRunId: string, agentType: string, executionTimeMs: number): void {
    this.broadcast(venueId, agentRunId, {
      type: 'agent_completed',
      data: {
        agent_run_id: agentRunId,
        venue_id: venueId,
        agent_type: agentType,
        execution_time_ms: executionTimeMs
      },
      timestamp: new Date().toISOString(),
      agent_run_id: agentRunId
    });
  }
}