/**
 * Agent Manager
 * Orchestrates the 3-agent pipeline execution and manages agent lifecycles
 */

import { ParsingAgent, ParsingAgentInput, ParsingAgentOutput } from './parsing-agent.ts';
import { BusinessLogicAgent, BusinessLogicAgentInput, BusinessLogicAgentOutput } from './business-logic-agent.ts';
import { ActionExecutionAgent, ActionExecutionAgentInput, ActionExecutionAgentOutput } from './action-execution-agent.ts';
import { GuardrailExecutor, GuardrailDefinition } from '../workflow-engine/guardrail-executor.ts';
import { VariableManager } from '../workflow-engine/variable-manager.ts';
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
    pre_intent_guardrails?: Array<{
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
  private guardrailExecutor: GuardrailExecutor;
  private variableManager: VariableManager;
  private db: DatabaseQueries;
  private logger: Logger;

  constructor() {
    this.parsingAgent = new ParsingAgent();
    this.businessLogicAgent = new BusinessLogicAgent();
    this.actionExecutionAgent = new ActionExecutionAgent();
    this.guardrailExecutor = new GuardrailExecutor();
    this.variableManager = new VariableManager();
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
      // Load workflow graph (nodes + connections) to determine execution order
      let workflowNodes: any[] = [];
      let workflowConnections: any[] = [];
      let orderedSteps: any[] = [];
      if (workflowExecutionId) {
        try {
          const execution = await this.db.getWorkflowExecution(workflowExecutionId);
          if (execution?.workflow_id) {
            workflowNodes = await this.db.getWorkflowNodes(execution.workflow_id);
            workflowConnections = await this.db.getWorkflowConnections(execution.workflow_id);
            orderedSteps = this.buildExecutionOrder(workflowNodes, workflowConnections);
            this.logger.info('Workflow graph loaded', {
              nodes: workflowNodes.length,
              connections: workflowConnections.length,
              execution_order: orderedSteps.map(n => `${n.node_type}:${n.name}`)
            });
          }
        } catch (error) {
          this.logger.warn('Could not load workflow graph, using default pipeline order', { error: error.message });
        }
      }

      // Log pipeline start
      await this.logPipelineStart(agentRunId, context);

      let parsingOutput: ParsingAgentOutput | undefined;
      let businessLogicOutput: BusinessLogicAgentOutput | undefined;
      let actionExecutionOutput: ActionExecutionAgentOutput | undefined;
      let parsingTime = 0;
      let businessLogicTime = 0;
      let actionExecutionTime = 0;

      // Load trigger step output_data to use as execution variables for {{variable}} resolution
      let executionVariables: Record<string, any> = {};
      if (workflowExecutionId) {
        try {
          const execution = await this.db.getWorkflowExecution(workflowExecutionId);
          if (execution?.variables) {
            executionVariables = execution.variables;
          }
          const triggerOutputData = await this.db.getTriggerStepOutputData(workflowExecutionId);
          if (triggerOutputData) {
            executionVariables = { ...executionVariables, ...triggerOutputData };
          }
        } catch (error) {
          this.logger.warn('Could not load execution variables', { error: error instanceof Error ? error.message : String(error) });
        }
      }

      // Initialize step namespace for referencing previous step outputs: {{step.node_name.field}}
      executionVariables.step = executionVariables.step || {};

      const toSnakeCase = (name: string): string =>
        name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

      const registerStepOutput = (stepName: string, outputData: Record<string, any>) => {
        const key = toSnakeCase(stepName);
        executionVariables.step[key] = outputData;
      };

      // Walk through the workflow graph in order, executing each step
      for (const step of orderedSteps) {
        if (step.node_type === 'trigger') continue;

        if (step.node_type === 'guardrail') {
          const guardrailType = step.guardrail_type as string;
          const keyMap: Record<string, string> = {
            'subject_line': 'subject_line_guardrails',
            'pre_intent': 'pre_intent_guardrails',
            'post_intent': 'post_intent_guardrails',
            'final_check': 'final_check_guardrails'
          };
          const guardrailsKey = keyMap[guardrailType] || `${guardrailType}_guardrails`;
          const guardrailDefs = (context.guardrails as any)?.[guardrailsKey] as GuardrailDefinition[] | undefined;

          if (guardrailDefs && guardrailDefs.length > 0) {
            // Resolve {{variable}} placeholders in the node's prompt using execution variables
            const nodePrompt = step.prompt || '';
            const resolvedNodePrompt = nodePrompt ? this.variableManager.resolveVariables(
              { prompt: nodePrompt },
              executionVariables
            ).prompt as string : undefined;

            const guardrailOutput = await this.executeAndSaveGuardrailNode(
              guardrailType,
              guardrailDefs,
              { subject: context.email_content.subject, message_for_ai: context.email_content.message_for_ai },
              workflowExecutionId,
              step.id,
              resolvedNodePrompt || undefined,
              executionVariables
            );
            registerStepOutput(step.name, guardrailOutput);
            processingNotes.push(`Guardrail node "${step.name}" (${guardrailType}) evaluated`);
          } else {
            const skipOutput = { continue: true, message: 'No guardrails configured for this type' };
            if (workflowExecutionId) {
              await this.db.updateWorkflowExecutionStep(workflowExecutionId, step.id, {
                status: 'completed',
                output_data: skipOutput,
                started_at: new Date().toISOString(),
                completed_at: new Date().toISOString()
              });
            }
            registerStepOutput(step.name, skipOutput);
            processingNotes.push(`Guardrail node "${step.name}" skipped (no guardrails configured)`);
          }
          continue;
        }

        if (step.node_type === 'agent') {
          const nameLower = (step.name || '').toLowerCase();

          // Resolve {{variable}} placeholders in agent node's prompt if present
          let resolvedAgentPrompt: string | undefined;
          if (step.prompt && Object.keys(executionVariables).length > 0) {
            resolvedAgentPrompt = this.variableManager.resolveVariables(
              { prompt: step.prompt },
              executionVariables
            ).prompt as string;
          }

          if (nameLower.includes('parsing')) {
            processingNotes.push('Starting Parsing Agent');
            const parsingStartTime = Date.now();
            const parsingInput: ParsingAgentInput = {
              email_content: context.email_content,
              venue_prompts: { email_extractor: context.venue_prompts.parser || context.venue_prompts.email_extractor },
              guardrails: { intent_guardrails: context.guardrails.pre_intent_guardrails }
            };
            parsingOutput = await this.executeWithLogging('parsing', agentRunId, () => this.parsingAgent.process(parsingInput));
            parsingTime = Date.now() - parsingStartTime;
            processingNotes.push(`Parsing Agent completed in ${parsingTime}ms - Intent: ${parsingOutput.extraction_result.intent}`);
            this.logger.info('Parsing Agent completed', { agent_run_id: agentRunId, intent_type: parsingOutput.extraction_result.intent, processing_time_ms: parsingTime });
            const parsingStepOutput = {
              intent: parsingOutput.extraction_result?.intent,
              action: parsingOutput.extraction_result?.action,
              extracted_data: parsingOutput.extraction_result,
              guardrail_status: parsingOutput.guardrail_status
            };
            registerStepOutput(step.name, parsingStepOutput);
            if (workflowExecutionId) {
              try {
                await this.db.updateWorkflowExecutionStep(workflowExecutionId, step.id, {
                  status: 'completed',
                  input_data: {
                    subject: context.email_content.subject,
                    message: context.email_content.message,
                    message_for_ai: context.email_content.message_for_ai,
                    customer_email: context.email_content.customer_email,
                    first_name: context.email_content.first_name,
                    last_name: context.email_content.last_name,
                    parser_prompt: parsingInput.venue_prompts.parser || parsingInput.venue_prompts.email_extractor
                  },
                  output_data: parsingStepOutput,
                  started_at: new Date(Date.now() - parsingTime).toISOString(),
                  completed_at: new Date().toISOString(),
                  output_processing_time_ms: parsingTime,
                  output_confidence_score: parsingOutput.confidence_score
                });
              } catch (error) {
                this.logger.warn('Failed to update workflow step for Parsing Agent', { error: error.message || error });
              }
            }
          } else if (nameLower.includes('business')) {
            if (!parsingOutput) { this.logger.warn('Business Logic agent reached but no parsing output'); continue; }
            processingNotes.push('Starting Business Logic Agent');
            const businessLogicStartTime = Date.now();
            const businessLogicInput: BusinessLogicAgentInput = {
              parsing_output: parsingOutput,
              venue_settings: context.venue_settings,
              venue_prompts: { orchestrator: context.venue_prompts.business_logic || context.venue_prompts.orchestrator },
              guardrails: { post_intent_guardrails: context.guardrails.post_intent_guardrails },
              current_bookings: [],
              availability_data: null
            };
            businessLogicOutput = await this.executeWithLogging('business_logic', agentRunId, () => this.businessLogicAgent.process(businessLogicInput));
            businessLogicTime = Date.now() - businessLogicStartTime;
            processingNotes.push(`Business Logic Agent completed in ${businessLogicTime}ms - Decision: ${businessLogicOutput.decision.action_type}`);
            this.logger.info('Business Logic Agent completed', { agent_run_id: agentRunId, action_type: businessLogicOutput.decision.action_type, processing_time_ms: businessLogicTime });
            const businessLogicStepOutput = {
              action_type: businessLogicOutput.decision.action_type,
              reasoning: businessLogicOutput.decision.reasoning,
              confidence: businessLogicOutput.decision.confidence,
              requires_human_review: businessLogicOutput.decision.requires_human_review,
              refined_extraction: businessLogicOutput.refined_extraction,
              guardrail_status: businessLogicOutput.guardrail_status
            };
            registerStepOutput(step.name, businessLogicStepOutput);
            if (workflowExecutionId) {
              try {
                await this.db.updateWorkflowExecutionStep(workflowExecutionId, step.id, {
                  status: 'completed',
                  input_data: {
                    intent: parsingOutput.extraction_result?.intent,
                    action: parsingOutput.extraction_result?.action,
                    venue_name: context.venue_settings.venue_name,
                    business_logic_prompt: businessLogicInput.venue_prompts.business_logic
                  },
                  output_data: businessLogicStepOutput,
                  started_at: new Date(Date.now() - businessLogicTime).toISOString(),
                  completed_at: new Date().toISOString(),
                  output_processing_time_ms: businessLogicTime,
                  output_confidence_score: businessLogicOutput.decision.confidence
                });
              } catch (error) {
                this.logger.warn('Failed to update workflow step for Business Logic Agent', { error: error.message || error });
              }
            }
          } else if (nameLower.includes('action')) {
            if (!parsingOutput || !businessLogicOutput) { this.logger.warn('Action agent reached but missing prior outputs'); continue; }
            processingNotes.push('Starting Action Execution Agent');
            const actionExecutionStartTime = Date.now();
            const actionExecutionInput: ActionExecutionAgentInput = {
              business_logic_output: businessLogicOutput,
              original_email: context.email_content,
              customer_data: { first_name: parsingOutput.extraction_result.first_name, last_name: parsingOutput.extraction_result.last_name },
              workflowExecutionId: workflowExecutionId,
              venue_settings: context.venue_settings,
              venue_prompts: { execution_prompt: this.getExecutionPrompt(businessLogicOutput.decision.action_type, context.venue_prompts) },
              guardrails: { final_check_guardrails: context.guardrails.final_check_guardrails },
              email_infrastructure: context.email_infrastructure
            };
            actionExecutionOutput = await this.executeWithLogging('action_execution', agentRunId, () => this.actionExecutionAgent.process(actionExecutionInput));
            actionExecutionTime = Date.now() - actionExecutionStartTime;
            processingNotes.push(`Action Execution Agent completed in ${actionExecutionTime}ms - Status: ${actionExecutionOutput.final_status}`);
            this.logger.info('Action Execution Agent completed', { agent_run_id: agentRunId, final_status: actionExecutionOutput.final_status, processing_time_ms: actionExecutionTime });
            const actionStepOutput = {
              ai_response: actionExecutionOutput.ai_response,
              final_status: actionExecutionOutput.final_status,
              email_operations: actionExecutionOutput.email_operations,
              tool_executions: actionExecutionOutput.tool_executions?.map(t => ({
                tool_name: t.tool_name, success: t.success, execution_time_ms: t.execution_time_ms, error_message: t.error_message
              })),
              guardrail_status: actionExecutionOutput.guardrail_status,
              guardrail_violations: actionExecutionOutput.guardrail_violations
            };
            registerStepOutput(step.name, actionStepOutput);
            if (workflowExecutionId) {
              try {
                await this.db.updateWorkflowExecutionStep(workflowExecutionId, step.id, {
                  status: 'completed',
                  input_data: {
                    action_type: businessLogicOutput.decision.action_type,
                    reasoning: businessLogicOutput.decision.reasoning,
                    refined_extraction: businessLogicOutput.refined_extraction,
                    original_subject: context.email_content.subject,
                    customer_email: context.email_content.customer_email,
                    message_for_ai: context.email_content.message_for_ai,
                    venue_name: context.venue_settings.venue_name,
                    venue_id: context.venue_settings.venue_id,
                    execution_prompt: actionExecutionInput.venue_prompts.execution_prompt
                  },
                  output_data: actionStepOutput,
                  started_at: new Date(Date.now() - actionExecutionTime).toISOString(),
                  completed_at: new Date().toISOString(),
                  output_processing_time_ms: actionExecutionTime
                });
              } catch (error) {
                this.logger.warn('Failed to update workflow step for Action Execution Agent', { error: error.message || error });
              }
            }
            for (const toolExecution of actionExecutionOutput.tool_executions) {
              this.logger.info('Tool Execution Result', { agent_run_id: agentRunId, tool_name: toolExecution.tool_name, success: toolExecution.success });
            }
          } else {
            this.logger.warn('Unknown agent node, skipping', { name: step.name, id: step.id });
          }
          continue;
        }
      }

      // Fallback: if no workflow graph was loaded, run the default 3-agent pipeline
      if (orderedSteps.length === 0) {
        this.logger.info('No workflow graph available, running default 3-agent pipeline');
        const parsingInput: ParsingAgentInput = {
          email_content: context.email_content,
          venue_prompts: { email_extractor: context.venue_prompts.parser || context.venue_prompts.email_extractor },
          guardrails: { intent_guardrails: context.guardrails.intent_guardrails }
        };
        parsingOutput = await this.executeWithLogging('parsing', agentRunId, () => this.parsingAgent.process(parsingInput));
        parsingTime = Date.now() - startTime;

        const businessLogicInput: BusinessLogicAgentInput = {
          parsing_output: parsingOutput,
          venue_settings: context.venue_settings,
          venue_prompts: { orchestrator: context.venue_prompts.business_logic || context.venue_prompts.orchestrator },
          guardrails: { post_intent_guardrails: context.guardrails.post_intent_guardrails },
          current_bookings: [],
          availability_data: null
        };
        const blStart = Date.now();
        businessLogicOutput = await this.executeWithLogging('business_logic', agentRunId, () => this.businessLogicAgent.process(businessLogicInput));
        businessLogicTime = Date.now() - blStart;

        const actionExecutionInput: ActionExecutionAgentInput = {
          business_logic_output: businessLogicOutput,
          original_email: context.email_content,
          customer_data: { first_name: parsingOutput.extraction_result.first_name, last_name: parsingOutput.extraction_result.last_name },
          workflowExecutionId: workflowExecutionId,
          venue_settings: context.venue_settings,
          venue_prompts: { execution_prompt: this.getExecutionPrompt(businessLogicOutput.decision.action_type, context.venue_prompts) },
          guardrails: { final_check_guardrails: context.guardrails.final_check_guardrails },
          email_infrastructure: context.email_infrastructure
        };
        const aeStart = Date.now();
        actionExecutionOutput = await this.executeWithLogging('action_execution', agentRunId, () => this.actionExecutionAgent.process(actionExecutionInput));
        actionExecutionTime = Date.now() - aeStart;
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

  private buildExecutionOrder(nodes: any[], connections: any[]): any[] {
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const nodeMap = new Map<string, any>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      adjacency.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const conn of connections) {
      const src = conn.source_node_id || conn.sourceNodeId;
      const tgt = conn.target_node_id || conn.targetNodeId;
      if (src && tgt && adjacency.has(src)) {
        adjacency.get(src)!.push(tgt);
        inDegree.set(tgt, (inDegree.get(tgt) || 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(nodeId);
    }

    const ordered: any[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = nodeMap.get(nodeId);
      if (node) ordered.push(node);

      for (const neighbor of (adjacency.get(nodeId) || [])) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return ordered;
  }

  private async executeAndSaveGuardrailNode(
    guardrailType: string,
    guardrails: GuardrailDefinition[],
    content: { subject: string; message_for_ai: string },
    workflowExecutionId?: string,
    guardrailNodeId?: string,
    nodePromptTemplate?: string,
    executionVariables?: Record<string, any>
  ): Promise<Record<string, any>> {
    const startTime = Date.now();

    try {
      if (workflowExecutionId && guardrailNodeId) {
        await this.db.updateWorkflowExecutionStep(workflowExecutionId, guardrailNodeId, {
          status: 'running',
          started_at: new Date().toISOString()
        });
      }

      const result = await this.guardrailExecutor.executeGuardrails(guardrails, {
        guardrail_type: guardrailType,
        content_to_evaluate: content,
        node_prompt_template: nodePromptTemplate,
        execution_variables: executionVariables
      });

      const duration = Date.now() - startTime;

      const outputData = {
        continue: result.continue,
        guardrail_type: guardrailType,
        guardrails_evaluated: result.individual_results.length,
        individual_results: result.individual_results,
        violation: result.continue ? null : {
          guardrail_name: result.guardrail_name,
          confidence: result.confidence,
          threshold: result.guardrail_threshold
        }
      };

      if (workflowExecutionId && guardrailNodeId) {
        await this.db.updateWorkflowExecutionStep(workflowExecutionId, guardrailNodeId, {
          status: 'completed',
          input_data: {
            guardrail_type: guardrailType,
            guardrail_count: guardrails.length,
            guardrail_names: guardrails.map(g => g.name)
          },
          output_data: outputData,
          completed_at: new Date().toISOString(),
          output_processing_time_ms: duration
        });

        await this.db.createGuardrailExecutionSteps(
          workflowExecutionId,
          guardrailNodeId,
          result.individual_results.map((r, _i) => ({
            guardrail_name: r.guardrail_name,
            confidence: r.confidence,
            guardrail_threshold: r.guardrail_threshold,
            passed: r.confidence < r.guardrail_threshold,
            started_at: new Date(startTime).toISOString(),
            completed_at: new Date().toISOString()
          }))
        );
      }

      this.logger.info(`Guardrail node executed: ${guardrailType}`, {
        continue: result.continue,
        evaluated: result.individual_results.length,
        duration_ms: duration
      });

      return outputData;
    } catch (error) {
      this.logger.error(`Guardrail node execution failed: ${guardrailType}`, error);
      if (workflowExecutionId && guardrailNodeId) {
        await this.db.updateWorkflowExecutionStep(workflowExecutionId, guardrailNodeId, {
          status: 'failed',
          error_details: { message: error instanceof Error ? error.message : String(error) },
          completed_at: new Date().toISOString()
        });
      }
      return { continue: true, error: error instanceof Error ? error.message : String(error) };
    }
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