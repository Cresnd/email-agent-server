/**
 * Agent Manager
 * Orchestrates the 3-agent pipeline execution and manages agent lifecycles
 */

import { ParsingAgent, ParsingAgentInput, ParsingAgentOutput } from './parsing-agent.ts';
import { BusinessLogicAgent, BusinessLogicAgentInput, BusinessLogicAgentOutput } from './business-logic-agent.ts';
import { ActionExecutionAgent, ActionExecutionAgentInput, ActionExecutionAgentOutput } from './action-execution-agent.ts';
import { DatabaseQueries } from '../database/queries.ts';
import { Logger } from '../utils/logger.ts';

export interface EmailProcessingContext {
  email_content: {
    subject: string;
    message: string;
    message_for_ai: string;
    customer_email: string;
    first_name: string | null;
    last_name: string | null;
    attachments?: string;
    received_at: string;
    conversation_id: string;
  };
  venue_settings: {
    venue_id: string;
    venue_name: string;
    venue_address: string;
    venue_description: string;
    venue_timezone: string;
    organization_id: string;
    organization_name: string;
    finance_email: string | null;
  };
  venue_prompts: {
    parser?: {
      prompt: string;
      checksum: string;
    };
    business_logic?: {
      prompt: string;
      checksum: string;
    };
    make_booking?: {
      prompt: string;
      checksum: string;
    };
    edit_booking?: {
      prompt: string;
      checksum: string;
    };
    cancel_booking?: {
      prompt: string;
      checksum: string;
    };
    find_booking?: {
      prompt: string;
      checksum: string;
    };
    // Legacy support
    email_extractor?: {
      prompt: string;
      checksum: string;
    };
    orchestrator?: {
      prompt: string;
      checksum: string;
    };
  };
  guardrails: {
    intent_guardrails?: Array<{
      name: string;
      prompt: string;
      threshold: number;
      folder_path?: string;
      mark_as_seen?: boolean;
    }>;
    final_check_guardrails?: Array<{
      name: string;
      prompt: string;
      threshold: number;
      folder_path?: string;
      mark_as_seen?: boolean;
    }>;
    post_intent_guardrails?: Array<{
      name: string;
      prompt: string;
      threshold: number;
      folder_path?: string;
      mark_as_seen?: boolean;
    }>;
    subject_line_guardrails?: Array<{
      name: string;
      prompt: string;
      threshold: number;
      folder_path?: string;
      mark_as_seen?: boolean;
    }>;
  };
  email_infrastructure: {
    email_account: string;
    smtp_settings: any;
    imap_settings: any;
    folders: any;
  };
}

export interface AgentPipelineResult {
  success: boolean;
  agent_run_id: string;
  
  // Agent outputs
  parsing_output?: ParsingAgentOutput;
  business_logic_output?: BusinessLogicAgentOutput;
  action_execution_output?: ActionExecutionAgentOutput;
  
  // Pipeline metrics
  total_execution_time_ms: number;
  agent_execution_times: {
    parsing_agent_ms: number;
    business_logic_agent_ms: number;
    action_execution_agent_ms: number;
  };
  
  // Error handling
  failed_at_step?: 'parsing' | 'business_logic' | 'action_execution';
  error_message?: string;
  
  // Audit trail
  created_at: string;
  updated_at: string;
  processing_notes: string[];
}

export class AgentManager {
  private parsingAgent: ParsingAgent;
  private businessLogicAgent: BusinessLogicAgent;
  private actionExecutionAgent: ActionExecutionAgent;
  private db: DatabaseQueries;
  private logger: Logger;

  constructor() {
    this.parsingAgent = new ParsingAgent();
    this.businessLogicAgent = new BusinessLogicAgent();
    this.actionExecutionAgent = new ActionExecutionAgent();
    this.db = new DatabaseQueries();
    this.logger = new Logger('AgentManager');
  }

  /**
   * Initialize the agent manager
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Agent Manager...');
    
    try {
      // Initialize database connection for logging
      // No specific initialization needed for agents as they're stateless
      
      this.logger.info('Agent Manager initialized successfully', {
        agents_loaded: ['parsing', 'business_logic', 'action_execution']
      });
      
    } catch (error) {
      this.logger.error('Failed to initialize Agent Manager', error);
      throw error;
    }
  }

  /**
   * Execute the complete 3-agent pipeline for email processing
   */
  async processPipeline(context: EmailProcessingContext, workflowExecutionId?: string): Promise<AgentPipelineResult> {
    const agentRunId = this.generateRunId();
    const startTime = Date.now();
    const processingNotes: string[] = [];
    
    this.logger.info('Starting agent pipeline execution', {
      agent_run_id: agentRunId,
      customer_email: context.email_content.customer_email,
      venue_id: context.venue_settings.venue_id
    });

    try {
      // Log pipeline start
      await this.logPipelineStart(agentRunId, context);
      
      // AGENT 1: Parsing Agent
      processingNotes.push('Starting Parsing Agent (Agent 1)');
      this.logger.info('Agent 1 - Parsing Agent starting', { 
        agent_run_id: agentRunId,
        venue_guardrails_count: Object.keys(context.guardrails || {}).length
      });
      const parsingStartTime = Date.now();
      
      const parsingInput: ParsingAgentInput = {
        email_content: context.email_content,
        venue_prompts: {
          email_extractor: context.venue_prompts.parser || context.venue_prompts.email_extractor
        },
        guardrails: {
          intent_guardrails: context.guardrails.intent_guardrails
        }
      };

      const parsingOutput = await this.executeWithLogging(
        'parsing',
        agentRunId,
        () => this.parsingAgent.process(parsingInput)
      );
      
      const parsingTime = Date.now() - parsingStartTime;
      processingNotes.push(`Parsing Agent completed in ${parsingTime}ms - Intent: ${parsingOutput.extraction_result.intent}`);
      
      this.logger.info('Agent 1 - Parsing Agent completed', {
        agent_run_id: agentRunId,
        intent_type: parsingOutput.extraction_result.intent,
        guardrail_status: parsingOutput.guardrail_status,
        processing_time_ms: parsingTime,
        guardrail_violations: parsingOutput.guardrail_violations?.length || 0
      });

      // Update workflow step for Parsing Agent
      if (workflowExecutionId) {
        try {
          const nodeId = await this.db.getNodeIdByStepName(workflowExecutionId, 'Parsing Agent');
          if (nodeId) {
            await this.db.updateWorkflowExecutionStep(workflowExecutionId, nodeId, {
            status: 'completed',
            input_data: {
              // Only data the Parsing Agent actually uses
              subject: context.email_content.subject,
              message: context.email_content.message,
              message_for_ai: context.email_content.message_for_ai,
              customer_email: context.email_content.customer_email,
              first_name: context.email_content.first_name,
              last_name: context.email_content.last_name,
              // The parser prompt is the key input for this agent
              parser_prompt: parsingInput.venue_prompts.parser || parsingInput.venue_prompts.email_extractor
            },
            output_data: {
              // Only the actual output from this agent
              intent: parsingOutput.extraction_result?.intent,
              action: parsingOutput.extraction_result?.action,
              extracted_data: parsingOutput.extraction_result,
              guardrail_status: parsingOutput.guardrail_status
            },
            started_at: new Date(Date.now() - parsingTime).toISOString(),
            completed_at: new Date().toISOString(),
            output_processing_time_ms: parsingTime,
            output_confidence_score: parsingOutput.confidence_score
            });
          }
        } catch (error) {
          this.logger.warn('Failed to update workflow step for Parsing Agent', {
            error: error.message || error,
            workflowExecutionId
          });
        }
      }

      // Log detailed guardrail violations for monitoring
      if (parsingOutput.guardrail_violations && parsingOutput.guardrail_violations.length > 0) {
        for (const violation of parsingOutput.guardrail_violations) {
          this.logger.warn('GUARDRAIL VIOLATION - Parsing Agent', {
            agent_run_id: agentRunId,
            guardrail_name: violation.guardrail_name,
            violation_type: violation.violation_type,
            confidence: violation.confidence,
            reasoning: violation.reasoning,
            stage: 'parsing'
          });
        }
      }

      // AGENT 2: Business Logic Agent  
      processingNotes.push('Starting Business Logic Agent (Agent 2)');
      const businessLogicStartTime = Date.now();
      
      const businessLogicInput: BusinessLogicAgentInput = {
        parsing_output: parsingOutput,
        venue_settings: context.venue_settings,
        venue_prompts: {
          orchestrator: context.venue_prompts.business_logic || context.venue_prompts.orchestrator
        },
        guardrails: {
          post_intent_guardrails: context.guardrails.post_intent_guardrails
        },
        current_bookings: [], // TODO: Fetch from availability API
        availability_data: null // TODO: Fetch from availability API
      };

      const businessLogicOutput = await this.executeWithLogging(
        'business_logic',
        agentRunId,
        () => this.businessLogicAgent.process(businessLogicInput)
      );
      
      const businessLogicTime = Date.now() - businessLogicStartTime;
      processingNotes.push(`Business Logic Agent completed in ${businessLogicTime}ms - Decision: ${businessLogicOutput.decision.action_type}`);

      this.logger.info('Agent 2 - Business Logic Agent completed', {
        agent_run_id: agentRunId,
        action_type: businessLogicOutput.decision.action_type,
        reasoning: businessLogicOutput.decision.reasoning,
        confidence: businessLogicOutput.decision.confidence,
        requires_human_review: businessLogicOutput.decision.requires_human_review,
        guardrail_status: businessLogicOutput.guardrail_status,
        processing_time_ms: businessLogicTime
      });

      // Update workflow step for Business Logic Agent
      if (workflowExecutionId) {
        try {
          const nodeId = await this.db.getNodeIdByStepName(workflowExecutionId, 'Business Logic Agent');
          if (nodeId) {
            await this.db.updateWorkflowExecutionStep(workflowExecutionId, nodeId, {
            status: 'completed',
            input_data: {
              // Only data the Business Logic Agent actually uses
              intent: parsingOutput.extraction_result?.intent,
              action: parsingOutput.extraction_result?.action,
              venue_name: context.venue_settings.venue_name,
              // The business logic prompt is the key input
              business_logic_prompt: businessLogicInput.venue_prompts.business_logic
            },
            output_data: {
              // Only the actual output from this agent
              action_type: businessLogicOutput.decision.action_type,
              reasoning: businessLogicOutput.decision.reasoning,
              confidence: businessLogicOutput.decision.confidence,
              requires_human_review: businessLogicOutput.decision.requires_human_review,
              refined_extraction: businessLogicOutput.refined_extraction,
              guardrail_status: businessLogicOutput.guardrail_status
            },
            started_at: new Date(Date.now() - businessLogicTime).toISOString(),
            completed_at: new Date().toISOString(),
            output_processing_time_ms: businessLogicTime,
            output_confidence_score: businessLogicOutput.decision.confidence
            });
          }
        } catch (error) {
          this.logger.warn('Failed to update workflow step for Business Logic Agent', {
            error: error.message || error,
            workflowExecutionId
          });
        }
      }

      // Log detailed guardrail violations for Business Logic Agent
      if (businessLogicOutput.guardrail_violations && businessLogicOutput.guardrail_violations.length > 0) {
        for (const violation of businessLogicOutput.guardrail_violations) {
          this.logger.warn('GUARDRAIL VIOLATION - Business Logic Agent', {
            agent_run_id: agentRunId,
            guardrail_name: violation.guardrail_name,
            violation_type: violation.violation_type,
            confidence: violation.confidence,
            reasoning: violation.reasoning,
            stage: 'business_logic'
          });
        }
      }

      // AGENT 3: Action Execution Agent
      processingNotes.push('Starting Action Execution Agent (Agent 3)');
      const actionExecutionStartTime = Date.now();
      
      const actionExecutionInput: ActionExecutionAgentInput = {
        business_logic_output: businessLogicOutput,
        original_email: context.email_content,
        customer_data: {
          first_name: parsingOutput.extraction_result.first_name,
          last_name: parsingOutput.extraction_result.last_name
        },
        workflowExecutionId: workflowExecutionId, // Pass workflow ID for tool logging
        venue_settings: context.venue_settings,
        venue_prompts: {
          execution_prompt: this.getExecutionPrompt(businessLogicOutput.decision.action_type, context.venue_prompts)
        },
        guardrails: {
          final_check_guardrails: context.guardrails.final_check_guardrails
        },
        email_infrastructure: context.email_infrastructure
      };

      const actionExecutionOutput = await this.executeWithLogging(
        'action_execution',
        agentRunId,
        () => this.actionExecutionAgent.process(actionExecutionInput)
      );
      
      const actionExecutionTime = Date.now() - actionExecutionStartTime;
      processingNotes.push(`Action Execution Agent completed in ${actionExecutionTime}ms - Status: ${actionExecutionOutput.final_status}`);

      this.logger.info('Agent 3 - Action Execution Agent completed', {
        agent_run_id: agentRunId,
        final_status: actionExecutionOutput.final_status,
        guardrail_status: actionExecutionOutput.guardrail_status,
        email_operations: actionExecutionOutput.email_operations,
        tools_executed: actionExecutionOutput.tool_executions.length,
        processing_time_ms: actionExecutionTime
      });

      // Update workflow step for Action Execution Agent
      if (workflowExecutionId) {
        try {
          const nodeId = await this.db.getNodeIdByStepName(workflowExecutionId, 'Action Execution Agent');
          if (nodeId) {
            await this.db.updateWorkflowExecutionStep(workflowExecutionId, nodeId, {
            status: 'completed',
            input_data: {
              // Only data the Action Execution Agent actually uses
              action_type: businessLogicOutput.decision.action_type,
              reasoning: businessLogicOutput.decision.reasoning,
              refined_extraction: businessLogicOutput.refined_extraction,
              original_subject: context.email_content.subject,
              customer_email: context.email_content.customer_email,
              message_for_ai: context.email_content.message_for_ai,
              venue_name: context.venue_settings.venue_name,
              venue_id: context.venue_settings.venue_id,
              // The execution prompt is the key input
              execution_prompt: actionExecutionInput.venue_prompts.execution_prompt
            },
            output_data: {
              // Only the actual output from this agent
              ai_response: actionExecutionOutput.ai_response,
              final_status: actionExecutionOutput.final_status,
              email_operations: actionExecutionOutput.email_operations,
              tool_executions: actionExecutionOutput.tool_executions?.map(t => ({
                tool_name: t.tool_name,
                success: t.success,
                execution_time_ms: t.execution_time_ms,
                error_message: t.error_message
              })),
              guardrail_status: actionExecutionOutput.guardrail_status,
              guardrail_violations: actionExecutionOutput.guardrail_violations
            },
            started_at: new Date(Date.now() - actionExecutionTime).toISOString(),
            completed_at: new Date().toISOString(),
            output_processing_time_ms: actionExecutionTime
            });
          }
        } catch (error) {
          this.logger.warn('Failed to update workflow step for Action Execution Agent', {
            error: error.message || error,
            workflowExecutionId
          });
        }
      }

      // Log detailed guardrail violations for Action Execution Agent
      if (actionExecutionOutput.guardrail_violations && actionExecutionOutput.guardrail_violations.length > 0) {
        for (const violation of actionExecutionOutput.guardrail_violations) {
          this.logger.warn('GUARDRAIL VIOLATION - Action Execution Agent', {
            agent_run_id: agentRunId,
            guardrail_name: violation.guardrail_name,
            violation_type: violation.violation_type,
            confidence: violation.confidence,
            reasoning: violation.reasoning,
            stage: 'action_execution'
          });
        }
      }

      // Log tool execution details
      for (const toolExecution of actionExecutionOutput.tool_executions) {
        this.logger.info('Tool Execution Result', {
          agent_run_id: agentRunId,
          tool_name: toolExecution.tool_name,
          success: toolExecution.success,
          execution_time_ms: toolExecution.execution_time_ms,
          error_message: toolExecution.error_message
        });
      }

      const totalExecutionTime = Date.now() - startTime;
      
      const result: AgentPipelineResult = {
        success: true,
        agent_run_id: agentRunId,
        parsing_output: parsingOutput,
        business_logic_output: businessLogicOutput,
        action_execution_output: actionExecutionOutput,
        total_execution_time_ms: totalExecutionTime,
        agent_execution_times: {
          parsing_agent_ms: parsingTime,
          business_logic_agent_ms: businessLogicTime,
          action_execution_agent_ms: actionExecutionTime
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        processing_notes: processingNotes
      };

      // Log successful completion
      await this.logPipelineCompletion(agentRunId, result);
      
      this.logger.info('Agent pipeline completed successfully', {
        agent_run_id: agentRunId,
        total_time_ms: totalExecutionTime,
        final_status: actionExecutionOutput.final_status
      });

      return result;

    } catch (error) {
      const totalExecutionTime = Date.now() - startTime;
      const failedStep = this.determineFailedStep(error);
      
      const failureResult: AgentPipelineResult = {
        success: false,
        agent_run_id: agentRunId,
        total_execution_time_ms: totalExecutionTime,
        agent_execution_times: {
          parsing_agent_ms: 0,
          business_logic_agent_ms: 0,
          action_execution_agent_ms: 0
        },
        failed_at_step: failedStep,
        error_message: error instanceof Error ? error.message : String(error),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        processing_notes: [...processingNotes, `Pipeline failed: ${error}`]
      };

      // Log failure
      await this.logPipelineFailure(agentRunId, failureResult);
      
      this.logger.error('Agent pipeline failed', error, {
        agent_run_id: agentRunId,
        failed_at_step: failedStep,
        total_time_ms: totalExecutionTime
      });

      return failureResult;
    }
  }

  /**
   * Execute an agent with comprehensive logging
   */
  private async executeWithLogging<T>(
    agentType: 'parsing' | 'business_logic' | 'action_execution',
    agentRunId: string,
    agentFunction: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      // Log agent start
      await this.logAgentStart(agentRunId, agentType);
      
      // Execute agent
      const result = await agentFunction();
      
      const executionTime = Date.now() - startTime;
      
      // Log agent success
      await this.logAgentSuccess(agentRunId, agentType, result, executionTime);
      
      return result;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // Log agent failure
      await this.logAgentFailure(agentRunId, agentType, error, executionTime);
      
      throw error;
    }
  }

  /**
   * Generate a unique run ID for pipeline execution
   */
  private generateRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Determine which step the pipeline failed at based on error
   */
  private determineFailedStep(error: any): 'parsing' | 'business_logic' | 'action_execution' {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('parsing') || errorMessage.includes('intent')) {
      return 'parsing';
    } else if (errorMessage.includes('business') || errorMessage.includes('decision')) {
      return 'business_logic';
    } else {
      return 'action_execution';
    }
  }

  /**
   * Get the appropriate execution prompt based on action type
   */
  private getExecutionPrompt(actionType: string, venuePrompts: EmailProcessingContext['venue_prompts']): { prompt: string; checksum: string } | undefined {
    // Try the execution prompt first, then fallback to action type specific prompts
    return venuePrompts.execution || venuePrompts.make_booking || venuePrompts[actionType];
  }

  // Database logging methods

  private async logPipelineStart(agentRunId: string, context: EmailProcessingContext): Promise<void> {
    try {
      // TODO: Log to database using this.db
      this.logger.debug('Pipeline start logged', { agent_run_id: agentRunId });
    } catch (error) {
      this.logger.warn('Failed to log pipeline start', error);
    }
  }

  private async logPipelineCompletion(agentRunId: string, result: AgentPipelineResult): Promise<void> {
    try {
      // TODO: Log to database using this.db
      this.logger.debug('Pipeline completion logged', { agent_run_id: agentRunId });
    } catch (error) {
      this.logger.warn('Failed to log pipeline completion', error);
    }
  }

  private async logPipelineFailure(agentRunId: string, result: AgentPipelineResult): Promise<void> {
    try {
      // TODO: Log to database using this.db
      this.logger.debug('Pipeline failure logged', { agent_run_id: agentRunId });
    } catch (error) {
      this.logger.warn('Failed to log pipeline failure', error);
    }
  }

  private async logAgentStart(agentRunId: string, agentType: string): Promise<void> {
    try {
      // TODO: Log to agent_steps table using this.db
      this.logger.debug(`${agentType} agent start logged`, { agent_run_id: agentRunId });
    } catch (error) {
      this.logger.warn(`Failed to log ${agentType} agent start`, error);
    }
  }

  private async logAgentSuccess(agentRunId: string, agentType: string, result: any, executionTime: number): Promise<void> {
    try {
      // TODO: Log to agent_steps table using this.db
      this.logger.debug(`${agentType} agent success logged`, { 
        agent_run_id: agentRunId,
        execution_time_ms: executionTime
      });
    } catch (error) {
      this.logger.warn(`Failed to log ${agentType} agent success`, error);
    }
  }

  private async logAgentFailure(agentRunId: string, agentType: string, error: any, executionTime: number): Promise<void> {
    try {
      // TODO: Log to agent_steps table using this.db
      this.logger.debug(`${agentType} agent failure logged`, { 
        agent_run_id: agentRunId,
        execution_time_ms: executionTime,
        error_message: error instanceof Error ? error.message : String(error)
      });
    } catch (error) {
      this.logger.warn(`Failed to log ${agentType} agent failure`, error);
    }
  }
}