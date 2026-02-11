/**
 * Email Processing Router
 * Handles email webhook ingestion and routes emails through the processing pipeline
 */

import { Router } from "@oak/oak";
import { EmailWebhookIngestion } from './webhook-ingestion.ts';
import { EmailPipelineOrchestrator } from './pipeline-orchestrator.ts';
import { AgentManager, EmailProcessingContext } from '../agent-system/agent-manager.ts';
import { Logger } from '../utils/logger.ts';
import { DatabaseQueries } from '../database/queries.ts';

export interface EmailProcessingRequest {
  // IMAP webhook payload
  email_account_id?: string;
  venue_id?: string;
  uid?: number;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  textPlain?: string;
  textHtml?: string;
  metadata?: any;
  raw?: string;
  
  // Outlook webhook payload  
  outlook_id?: string;
  conversation_id?: string;
  attachments?: any[];
  
  // Execution metadata
  execution_id?: string; // For reruns from edge function
  execution_type?: 'test' | 'normal';
  parent_execution_id?: string;
  is_test_run?: boolean;
  message_id?: string;
  body?: string;
  pinned_steps?: Array<{
    id: string;
    step_name: string;
    node_id?: string;
    output_data: any;
    step_order: number;
  }>;
}

export interface EmailProcessingResponse {
  success: boolean;
  message: string;
  cancelled?: boolean;
  workflow_execution_id?: string;
  agent_run_id?: string;
  processing_time_ms?: number;
  email_operations?: {
    sent_response: boolean;
    moved_to_folder?: string;
    marked_as_seen?: boolean;
    created_draft?: boolean;
  };
  error_details?: any;
}

export class EmailProcessor {
  private router: Router;
  private webhookIngestion: EmailWebhookIngestion;
  private pipelineOrchestrator: EmailPipelineOrchestrator;
  private agentManager: AgentManager;
  private db: DatabaseQueries;
  private logger: Logger;

  constructor() {
    this.router = new Router();
    this.webhookIngestion = new EmailWebhookIngestion();
    this.pipelineOrchestrator = new EmailPipelineOrchestrator();
    this.agentManager = new AgentManager();
    this.db = new DatabaseQueries();
    this.logger = new Logger('EmailProcessor');
    
    this.setupRoutes();
  }

  /**
   * Setup routing endpoints
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.router.get('/health', (ctx) => {
      ctx.response.body = {
        status: 'healthy',
        service: 'email-processor',
        timestamp: new Date().toISOString()
      };
    });

    // IMAP webhook endpoint
    this.router.post('/webhook/imap', async (ctx) => {
      await this.handleEmailWebhook(ctx, 'imap');
    });

    // Outlook webhook endpoint
    this.router.post('/webhook/outlook', async (ctx) => {
      await this.handleEmailWebhook(ctx, 'outlook');
    });

    // Manual email processing endpoint (for testing)
    this.router.post('/process', async (ctx) => {
      await this.handleManualProcessing(ctx);
    });

    // Processing status endpoint
    this.router.get('/status/:agent_run_id', async (ctx) => {
      await this.handleStatusCheck(ctx);
    });

    // Cancel execution endpoint
    this.router.post('/cancel/:workflow_execution_id', async (ctx) => {
      await this.handleExecutionCancel(ctx);
    });
  }

  /**
   * Handle incoming email webhooks
   */
  private async handleEmailWebhook(ctx: any, source: 'imap' | 'outlook'): Promise<void> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    
    try {
      const body = await ctx.request.body({ type: 'json' }).value;
      
      // Parse pinned steps from headers if present
      const pinnedStepsHeader = ctx.request.headers.get('x-pinned-steps');
      if (pinnedStepsHeader) {
        try {
          body.pinned_steps = JSON.parse(pinnedStepsHeader);
          this.logger.info('Parsed pinned steps from headers', {
            request_id: requestId,
            pinned_count: body.pinned_steps?.length || 0
          });
        } catch (error) {
          this.logger.warn('Failed to parse pinned steps header', { 
            error: error.message,
            header: pinnedStepsHeader 
          });
        }
      }
      
      this.logger.info(`Received ${source} webhook`, {
        request_id: requestId,
        venue_id: body.venue_id,
        email_account_id: body.email_account_id,
        subject: body.subject?.substring(0, 100),
        from: body.from,
        is_test_run: body.is_test_run,
        pinned_steps_count: body.pinned_steps?.length || 0
      });

      // Process the email through the pipeline
      this.logger.debug('Webhook payload received', {
        request_id: requestId,
        keys: Object.keys(body || {}),
        venue_id: body.venue_id,
        subject: body.subject?.substring(0, 80)
      });

      const result = await this.processEmail(body, source, requestId);
      
      const processingTime = Date.now() - startTime;
      
      this.logger.info(`Email processing completed`, {
        success: result.success,
        request_id: requestId,
        agent_run_id: result.agent_run_id,
        processing_time_ms: processingTime
      });

      ctx.response.status = result.cancelled ? 200 : (result.success ? 200 : 500);
      ctx.response.body = result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      this.logger.error('Email webhook processing failed', error, {
        request_id: requestId,
        source,
        processing_time_ms: processingTime
      });

      ctx.response.status = 500;
      ctx.response.body = {
        success: false,
        message: 'Email processing failed',
        error_details: error instanceof Error ? error.message : String(error),
        processing_time_ms: processingTime,
        request_id: requestId
      };
    }
  }

  /**
   * Handle manual email processing requests
   */
  private async handleManualProcessing(ctx: any): Promise<void> {
    try {
      const body = await ctx.request.body({ type: 'json' }).value;
      const requestId = crypto.randomUUID();
      
      this.logger.info('Manual email processing requested', {
        request_id: requestId,
        venue_id: body.venue_id,
        subject: body.subject
      });

      const result = await this.processEmail(body, 'manual', requestId);
      
      ctx.response.status = result.cancelled ? 200 : (result.success ? 200 : 500);
      ctx.response.body = result;

    } catch (error) {
      this.logger.error('Manual processing failed', error);
      
      ctx.response.status = 500;
      ctx.response.body = {
        success: false,
        message: 'Manual processing failed',
        error_details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle processing status checks
   */
  private async handleStatusCheck(ctx: any): Promise<void> {
    try {
      const agentRunId = ctx.params.agent_run_id;
      
      // TODO: Query database for status
      const status = await this.getProcessingStatus(agentRunId);
      
      ctx.response.body = status;

    } catch (error) {
      this.logger.error('Status check failed', error);
      
      ctx.response.status = 500;
      ctx.response.body = {
        error: 'Failed to check status',
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Main email processing pipeline
   */
  private async processEmail(
    emailPayload: EmailProcessingRequest, 
    source: 'imap' | 'outlook' | 'manual',
    requestId: string
  ): Promise<EmailProcessingResponse> {
    
    try {
      // Phase 1: Extract and normalize email data
      this.logger.debug('Starting email preprocessing', { source, request_id: requestId });
      const preprocessedData = await this.webhookIngestion.process(emailPayload);
      this.logger.debug('Preprocessing complete', {
        request_id: requestId,
        venue_id: preprocessedData.venue_id,
        customer_email: preprocessedData.email_content.customer_email,
        conversation_id: preprocessedData.metadata.conversation_id
      });
      
      // Phase 2: Fetch venue configuration and prompts
      this.logger.debug('Fetching venue configuration', { venue_id: preprocessedData.venue_id, request_id: requestId });
      const venueConfig = await this.pipelineOrchestrator.fetchVenueConfiguration(preprocessedData.venue_id);
      this.logger.debug('Venue configuration loaded', {
        request_id: requestId,
        venue_id: preprocessedData.venue_id,
        prompts_keys: Object.keys(venueConfig.venue_prompts || {}),
        guardrails_count: Object.keys(venueConfig.guardrails || {}).length
      });

      // Phase 2.5: Fetch type-based prompts & guardrails for the venue config wall
      const promptsAndGuardrails = await this.db.getVenuePromptsAndGuardrailsByType(preprocessedData.venue_id);

      // Build the venue config "wall" - all data assembled as a flat object
      // This becomes the trigger step output_data so downstream steps can reference
      // variables like {{subject}}, {{guardrails.post_intent_guardrails[0].name}}, etc.
      const venueTimezone = venueConfig.venue_settings?.venue_timezone || 'Europe/Stockholm';
      const nowFormatted = (() => {
        try {
          const now = new Date();
          const day = now.toLocaleDateString('en-US', { timeZone: venueTimezone, day: 'numeric' });
          const month = now.toLocaleDateString('en-US', { timeZone: venueTimezone, month: 'long' });
          const year = now.toLocaleDateString('en-US', { timeZone: venueTimezone, year: 'numeric' });
          const hours = now.toLocaleString('en-US', { timeZone: venueTimezone, hour: '2-digit', minute: '2-digit', hour12: false });
          const ordinal = (n: number) => {
            const s = ['th', 'st', 'nd', 'rd'];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
          };
          return `The ${ordinal(parseInt(day))} of ${month} ${year} at ${hours} o'clock`;
        } catch {
          return new Date().toISOString();
        }
      })();

      const venueConfigWall: Record<string, any> = {
        venue_prompts: promptsAndGuardrails.venue_prompts || {},
        guardrails: promptsAndGuardrails.guardrails || {},
        email_addresses_ignore: venueConfig.filtering_config?.ignored_emails || [],
        domains_ignore: venueConfig.filtering_config?.ignored_domains || [],
        email_sorting_rules: venueConfig.filtering_config?.sorting_rules || [],
        standard_sorting_rules: {},
        workflows: {},
        database_project_ref: Deno.env.get('SUPABASE_PROJECT_REF') || '',
        finance_email: venueConfig.venue_settings?.finance_email || '',
        session_id: '',
        phone_number: '',
        now: nowFormatted,
        venue_id: preprocessedData.venue_id,
        venue_name: venueConfig.venue_settings?.venue_name || '',
        venue_address: venueConfig.venue_settings?.venue_address || '',
        venue_description: venueConfig.venue_settings?.venue_description || '',
        venue_timezone: venueTimezone,
        organization_id: venueConfig.venue_settings?.organization_id || '',
        organization_name: venueConfig.venue_settings?.organization_name || '',
        references: preprocessedData.metadata?.references || '',
        in_reply_to: preprocessedData.metadata?.in_reply_to || '',
        conversation_id: preprocessedData.email_content?.conversation_id || '',
        email_UID: preprocessedData.metadata?.email_UID || 0,
        outlook_id: preprocessedData.metadata?.outlook_id || '',
        first_name: preprocessedData.email_content?.first_name || '',
        last_name: preprocessedData.email_content?.last_name || '',
        customer_email: preprocessedData.email_content?.customer_email || '',
        company_email: emailPayload.to || '',
        subject: preprocessedData.email_content?.subject || '',
        subject_tag: '',
        message: preprocessedData.email_content?.message || '',
        message_for_ai: preprocessedData.email_content?.message_for_ai || '',
        attachments: preprocessedData.email_content?.attachments || '',
        received_at: preprocessedData.email_content?.received_at || '',
        email_server: venueConfig.email_infrastructure || {},
        email_delay: 0
      };
      
      // Phase 3: Apply email filtering and guardrails
      this.logger.debug('Applying email filters and guardrails', { request_id: requestId });
      const shouldContinue = await this.pipelineOrchestrator.applyFiltersAndGuardrails(
        preprocessedData,
        venueConfig
      );
      
      if (!shouldContinue.continue) {
        this.logger.info('Email filtered/stopped before agent pipeline', {
          request_id: requestId,
          reason: shouldContinue.reason,
          operations: shouldContinue.email_operations
        });
        return {
          success: true,
          message: shouldContinue.reason || 'Email filtered out',
          email_operations: shouldContinue.email_operations
        };
      }
      
      // Phase 4: Prepare context for agent pipeline
      const processingContext: EmailProcessingContext = {
        email_content: preprocessedData.email_content,
        venue_settings: venueConfig.venue_settings,
        venue_prompts: venueConfig.venue_prompts,
        guardrails: venueConfig.guardrails,
        email_infrastructure: venueConfig.email_infrastructure
      };
      
      // Get venue's assigned workflow (dynamic workflow selection)
      const venueWorkflowId = await this.db.getVenueEmailWorkflow(emailPayload.venue_id);
      this.logger.info('Using venue workflow', { 
        venue_id: emailPayload.venue_id,
        workflow_id: venueWorkflowId
      });
      
      // Check if this is a rerun (has execution_id from edge function)
      let workflowExecutionId: string;
      let isRerun = false;
      let parentExecutionId: string | null = null;
      let existingExecution: any = null;
      
      if (emailPayload.execution_id && emailPayload.parent_execution_id) {
        // This is a rerun from the edge function with explicit parent - use the provided execution ID
        workflowExecutionId = emailPayload.execution_id;
        parentExecutionId = emailPayload.parent_execution_id;
        isRerun = true;
        this.logger.info('Using existing execution ID from rerun with explicit parent', { 
          workflowExecutionId,
          parent_execution_id: parentExecutionId
        });
        try {
          existingExecution = await this.db.getWorkflowExecution(workflowExecutionId);
        } catch (err) {
          this.logger.warn('Could not fetch existing execution for rerun', { workflowExecutionId, error: err instanceof Error ? err.message : String(err) });
        }
      } else if (emailPayload.execution_id && !emailPayload.parent_execution_id) {
        // Execution ID provided but no parent - this is a rerun where execution_id IS the parent
        // Generate a new execution ID for the rerun
        parentExecutionId = emailPayload.execution_id;
        workflowExecutionId = crypto.randomUUID();
        isRerun = false; // We'll create a new execution with parent reference
        this.logger.info('Creating rerun execution with parent', { 
          workflowExecutionId,
          parent_execution_id: parentExecutionId
        });
      } else {
        // Create new workflow execution record (no parent)
        workflowExecutionId = crypto.randomUUID();
        this.logger.info('Creating new workflow execution record', { 
          workflowExecutionId,
          customer_email: emailPayload.from,
          subject: emailPayload.subject,
          workflow_id: venueWorkflowId
        });
      }
      
      try {
        // Stop immediately if this rerun was already cancelled
        if (isRerun && existingExecution?.status === 'cancelled') {
          const processingTime = Date.now() - startTime;
          this.logger.info('Rerun aborted because execution is already cancelled', { workflowExecutionId });
          return {
            success: false,
            cancelled: true,
            message: 'Execution was already cancelled',
            workflow_execution_id: workflowExecutionId,
            processing_time_ms: processingTime
          };
        }

        if (!isRerun) {
          // Only create new execution if this is NOT a rerun
          await this.db.createWorkflowExecution({
            id: workflowExecutionId,
            workflow_id: venueWorkflowId, // Dynamic workflow based on venue configuration
            organization_id: venueConfig.venue_settings.organization_id,
            venue_id: emailPayload.venue_id,
            parent_execution: parentExecutionId, // Use the parentExecutionId variable we set above
            started_at: new Date().toISOString(),
            customer_email: emailPayload.from,
            subject: emailPayload.subject,
            trigger_type: emailPayload.execution_type === 'test' ? 'test' : 'email_webhook',
            trigger_data: emailPayload, // Store the raw webhook payload as input
            variables: {
              processing_status: 'running',
              ...venueConfigWall
            }
          });
          
          // Create workflow execution steps for the canvas to display
          // Trigger step gets: input_data = raw webhook, output_data = venue config wall
          await this.db.createWorkflowExecutionSteps(workflowExecutionId, venueWorkflowId, emailPayload, emailPayload.pinned_steps, venueConfigWall);
          this.logger.info('Workflow execution steps created successfully', { workflowExecutionId });

          // Immediately mark execution as running so the UI shows active state for new (non-rerun) executions
          await this.db.updateWorkflowExecution(workflowExecutionId, {
            status: 'running',
            started_at: new Date().toISOString()
          });
        } else {
          // For reruns, update the status to running and create steps
          await this.db.updateWorkflowExecution(workflowExecutionId, {
            status: 'running',
            started_at: new Date().toISOString()
          });
          
          // Create workflow execution steps for the canvas to display (reruns need steps too!)
          await this.db.createWorkflowExecutionSteps(workflowExecutionId, venueWorkflowId, emailPayload, emailPayload.pinned_steps, venueConfigWall);
          this.logger.info('Rerun execution updated to running and steps created', { workflowExecutionId });
        }
      } catch (error) {
        this.logger.error('Failed to create/update workflow execution', { workflowExecutionId, error: error.message });
      }
      
      // Phase 5: Execute 3-agent pipeline (with workflow execution ID)
      this.logger.debug('Executing agent pipeline', { request_id: requestId });
      const pipelineResult = await this.agentManager.processPipeline(processingContext, workflowExecutionId);
      this.logger.debug('Agent pipeline completed', {
        request_id: requestId,
        success: pipelineResult.success,
        agent_run_id: pipelineResult.agent_run_id,
        total_execution_time_ms: pipelineResult.total_execution_time_ms,
        error_message: pipelineResult.error_message
      });
      
      // Phase 6: Handle email operations (send/move/mark)
      let emailOperations = undefined;
      if (pipelineResult.success && pipelineResult.action_execution_output) {
        emailOperations = await this.executeEmailOperations(
          pipelineResult.action_execution_output,
          venueConfig.email_infrastructure
        );
        this.logger.debug('Email operations executed', { request_id: requestId, operations: emailOperations });
      }
      
      // Respect cancellation status and avoid overriding it
      let executionRecord: { status?: string; finished_at?: string; duration_ms?: number; end_time?: string } | null = null;
      try {
        const { data, error } = await this.db.supabase
          .from('workflow_executions')
          .select('status, finished_at, duration_ms, end_time')
          .eq('id', workflowExecutionId)
          .single();

        if (!error) {
          executionRecord = data;
        } else {
          this.logger.warn('Could not fetch workflow execution status after pipeline', {
            workflowExecutionId,
            error: error.message
          });
        }
      } catch (statusError) {
        this.logger.warn('Error while fetching workflow execution status after pipeline', {
          workflowExecutionId,
          error: statusError instanceof Error ? statusError.message : String(statusError)
        });
      }

        const wasCancelled = pipelineResult.cancelled || executionRecord?.status === 'cancelled';
        const finalStatus: 'completed' | 'failed' | 'cancelled' = wasCancelled ? 'cancelled' : (pipelineResult.success ? 'completed' : 'failed');
        const logStatus = finalStatus === 'cancelled' ? 'failed' : finalStatus; // email_processing_log constraint
        const statusErrorMessage = wasCancelled ? 'Execution cancelled' : pipelineResult.error_message;
        const nowIso = new Date().toISOString();

      // Log email processing to database
      try {
        // Get or create email account ID (using a fallback for testing)
        const emailAccountId = this.getOrCreateEmailAccountId(emailPayload.email_account_id);
        
        await this.db.logEmailProcessing({
          id: crypto.randomUUID(),
          email_account_id: emailAccountId,
          organization_id: venueConfig.venue_settings.organization_id,
          venue_id: emailPayload.venue_id,
          email_uid: emailPayload.uid?.toString() || '0',
          email_subject: emailPayload.subject || '',
          email_from: emailPayload.from || '',
          email_to: emailPayload.to || '',
          email_date: emailPayload.date || new Date().toISOString(),
          processing_status: logStatus,
          error_message: statusErrorMessage,
          processing_time_ms: pipelineResult.total_execution_time_ms,
          processed_at: new Date().toISOString()
        });
        
        this.logger.info('Email processing logged to database successfully', { request_id: requestId });
        
        // Update workflow execution with final status and agent_run_id
        try {
          
          // Update workflow execution with completion status
          const workflowUpdatePayload: any = {
            status: finalStatus,
            current_step: wasCancelled ? 'execution_cancelled' : 'email_processing_complete',
            error_message: statusErrorMessage
          };

          if (!executionRecord?.finished_at) {
            workflowUpdatePayload.finished_at = nowIso;
          }

          if (!executionRecord?.duration_ms) {
            workflowUpdatePayload.duration_ms = pipelineResult.total_execution_time_ms;
          }

          if (!executionRecord?.end_time) {
            workflowUpdatePayload.end_time = nowIso;
          }

          await this.db.updateWorkflowExecution(
            workflowExecutionId,
            workflowUpdatePayload
          );
          
          this.logger.info(wasCancelled ? 'Workflow execution cancelled' : 'Workflow execution completed successfully', { 
            request_id: requestId, 
            workflowExecutionId,
            status: finalStatus
          });
        } catch (workflowLogError) {
          this.logger.error('Failed to log workflow execution', {
            error: workflowLogError,
            request_id: requestId,
            agent_run_id: pipelineResult.agent_run_id
          });
        }
        
      } catch (logError) {
        this.logger.error('Failed to log email processing to database', {
          error: logError,
          request_id: requestId,
          venue_id: emailPayload.venue_id,
          organization_id: venueConfig.venue_settings.organization_id
        });
      }
      
      return {
        success: !wasCancelled && pipelineResult.success,
        cancelled: wasCancelled,
        message: wasCancelled ? 'Execution cancelled' : (pipelineResult.success ? 'Email processed successfully' : 'Email processing failed'),
        workflow_execution_id: workflowExecutionId,
        agent_run_id: pipelineResult.agent_run_id,
        processing_time_ms: pipelineResult.total_execution_time_ms,
        email_operations: emailOperations,
        error_details: statusErrorMessage
      };

    } catch (error) {
      this.logger.error('Email processing pipeline failed', error, {
        request_id: requestId,
        venue_id: emailPayload.venue_id
      });
      
      return {
        success: false,
        message: 'Pipeline execution failed',
        error_details: error instanceof Error ? error.message : String(error),
        request_id: requestId
      };
    }
  }

  /**
   * Execute email operations (send/move/mark as seen)
   */
  private async executeEmailOperations(actionOutput: any, emailInfra: any): Promise<any> {
    try {
      const operations = actionOutput.email_operations;
      const results = {
        sent_response: false,
        moved_to_folder: undefined as string | undefined,
        marked_as_seen: false,
        created_draft: false
      };

      // Send email response
      if (operations.send_response && actionOutput.email_response) {
        await this.sendEmailResponse(actionOutput.email_response, emailInfra);
        results.sent_response = true;
      }

      // Create draft
      if (operations.create_draft && actionOutput.email_response) {
        await this.createEmailDraft(actionOutput.email_response, emailInfra);
        results.created_draft = true;
      }

      // Move email to folder
      if (operations.move_to_folder) {
        await this.moveEmailToFolder(operations.move_to_folder, emailInfra);
        results.moved_to_folder = operations.move_to_folder;
      }

      // Mark as seen
      if (operations.mark_as_seen) {
        await this.markEmailAsSeen(emailInfra);
        results.marked_as_seen = true;
      }

      return results;

    } catch (error) {
      this.logger.error('Email operations failed', error);
      throw error;
    }
  }

  /**
   * Handle execution cancellation
   */
  private async handleExecutionCancel(ctx: any): Promise<void> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    
    try {
      const workflowExecutionId = ctx.params.workflow_execution_id;
      
      if (!workflowExecutionId) {
        ctx.response.status = 400;
        ctx.response.body = {
          success: false,
          error: 'Missing workflow_execution_id parameter',
          request_id: requestId
        };
        return;
      }

      // Validate UUID format
      if (!this.isValidUUID(workflowExecutionId)) {
        ctx.response.status = 400;
        ctx.response.body = {
          success: false,
          error: 'Invalid workflow execution ID format',
          request_id: requestId
        };
        return;
      }

      this.logger.info('Received execution cancel request', {
        request_id: requestId,
        workflow_execution_id: workflowExecutionId
      });

      // Fetch execution to compute duration and avoid cancelling a finished one
      let existingExecution: any = null;
      try {
        const { data } = await this.db.supabase
          .from('workflow_executions')
          .select('status, started_at')
          .eq('id', workflowExecutionId)
          .single();
        existingExecution = data;
      } catch (error) {
        this.logger.warn('Could not fetch execution before cancellation', {
          workflow_execution_id: workflowExecutionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // If already cancelled, return early
      if (existingExecution?.status === 'cancelled') {
        ctx.response.body = {
          success: true,
          message: 'Execution already cancelled',
          workflow_execution_id: workflowExecutionId,
          cancelled_steps: 0,
          request_id: requestId
        };
        return;
      }

      // Update workflow execution status to 'cancelled'
      try {
        const nowIso = new Date().toISOString();
        const startedAt = existingExecution?.started_at ? new Date(existingExecution.started_at).getTime() : null;
        const durationMs = startedAt ? Date.now() - startedAt : Date.now() - startTime;

        await this.db.updateWorkflowExecution(workflowExecutionId, {
          status: 'cancelled',
          finished_at: nowIso,
          end_time: nowIso,
          duration_ms: durationMs
        });

        // Also cancel any running steps
        const { data: steps } = await this.db.supabase
          .from('workflow_execution_steps')
          .select('*')
          .eq('execution_id', workflowExecutionId)
          .in('status', ['running', 'pending']);

        let cancelledSteps = 0;

        if (steps && steps.length > 0) {
          for (const step of steps) {
            const nextStatus = step.status === 'running' ? 'cancelled' : 'skipped';
            await this.db.updateWorkflowExecutionStep(workflowExecutionId, step.node_id, {
              status: nextStatus as any,
              completed_at: nowIso
            });
            cancelledSteps++;
          }
        }

        // Ensure any remaining pending steps are marked skipped to avoid dangling states
        const { data: remainingPending } = await this.db.supabase
          .from('workflow_execution_steps')
          .select('node_id')
          .eq('execution_id', workflowExecutionId)
          .eq('status', 'pending');

        if (remainingPending && remainingPending.length > 0) {
          for (const step of remainingPending) {
            await this.db.updateWorkflowExecutionStep(workflowExecutionId, step.node_id, {
              status: 'skipped',
              completed_at: nowIso
            });
            cancelledSteps++;
          }
        }

        this.logger.info('Execution cancelled successfully', {
          request_id: requestId,
          workflow_execution_id: workflowExecutionId,
          cancelled_steps: cancelledSteps
        });

        ctx.response.body = {
          success: true,
          message: 'Execution cancelled successfully',
          workflow_execution_id: workflowExecutionId,
          cancelled_steps: cancelledSteps,
          request_id: requestId
        };

      } catch (dbError) {
        this.logger.error('Database error during cancellation', {
          request_id: requestId,
          workflow_execution_id: workflowExecutionId,
          error: dbError.message || dbError
        });

        ctx.response.status = 500;
        ctx.response.body = {
          success: false,
          error: 'Failed to cancel execution',
          request_id: requestId
        };
      }

    } catch (error) {
      this.logger.error('Execution cancel request failed', {
        request_id: requestId,
        error: error.message || error
      });

      ctx.response.status = 500;
      ctx.response.body = {
        success: false,
        error: 'Internal server error',
        request_id: requestId
      };
    }
  }

  /**
   * Get processing status for a given agent run ID
   */
  private async getProcessingStatus(agentRunId: string): Promise<any> {
    // TODO: Query database for agent run status
    return {
      agent_run_id: agentRunId,
      status: 'completed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  // Email infrastructure operations

  private async sendEmailResponse(emailResponse: any, emailInfra: any): Promise<void> {
    // TODO: Implement email sending via SMTP
    this.logger.info('Sending email response', { 
      subject: emailResponse.subject,
      to: emailResponse.reply_to
    });
  }

  private async createEmailDraft(emailResponse: any, emailInfra: any): Promise<void> {
    // TODO: Implement draft creation
    this.logger.info('Creating email draft', { 
      subject: emailResponse.subject
    });
  }

  private async moveEmailToFolder(folderPath: string, emailInfra: any): Promise<void> {
    // TODO: Implement email folder movement
    this.logger.info('Moving email to folder', { folder: folderPath });
  }

  private async markEmailAsSeen(emailInfra: any): Promise<void> {
    // TODO: Implement mark as seen
    this.logger.info('Marking email as seen');
  }

  /**
   * Get or fallback to default email account ID
   */
  private getOrCreateEmailAccountId(emailAccountId?: string): string {
    // If a valid UUID is provided, use it
    if (emailAccountId && this.isValidUUID(emailAccountId)) {
      return emailAccountId;
    }
    
    // Otherwise use the first available email account as fallback
    return '114f25f5-09de-4414-9aae-c5db7212d783'; // Known valid email account ID
  }
  
  /**
   * Check if string is a valid UUID
   */
  private isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  /**
   * Get the router instance
   */
  getRouter(): Router {
    return this.router;
  }
}
