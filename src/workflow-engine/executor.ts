/**
 * Main workflow execution engine for the email agent system
 * Handles deterministic execution of workflows with real-time monitoring
 */

import { StepProcessor } from './step-processor.ts';
import { VariableManager } from './variable-manager.ts';
import { RetryManager } from './retry-manager.ts';

export interface WorkflowStep {
  id: string;
  type: 'email_classifier' | 'agent_selector' | 'agent_executor' | 'condition' | 'webhook' | 'delay' | 'guardrail' | 'send';
  name: string;
  config: Record<string, unknown>;
  nextSteps: string[];
  onError?: string; // Step ID to jump to on error
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  organizationId: string;
  venueId?: string;
  triggers: {
    type: 'email_received' | 'manual' | 'webhook' | 'schedule';
    config: Record<string, unknown>;
  }[];
  steps: WorkflowStep[];
  variables: Record<string, unknown>;
  settings: {
    timeout: number; // Max execution time in ms
    maxRetries: number;
    retryDelay: number;
  };
}

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  organizationId: string;
  venueId?: string;
  triggerData: Record<string, unknown>;
  variables: Record<string, unknown>;
  currentStep: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  error?: string;
  stepHistory: {
    stepId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    startTime: Date;
    endTime?: Date;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    error?: string;
  }[];
}

export class WorkflowExecutor {
  private stepProcessor: StepProcessor;
  private variableManager: VariableManager;
  private retryManager: RetryManager;

  constructor() {
    this.stepProcessor = new StepProcessor();
    this.variableManager = new VariableManager();
    this.retryManager = new RetryManager();
  }

  /**
   * Execute a workflow with the given trigger data
   */
  async executeWorkflow(
    workflow: WorkflowDefinition,
    triggerData: Record<string, unknown>,
    executionId?: string
  ): Promise<ExecutionContext> {
    const context: ExecutionContext = {
      workflowId: workflow.id,
      executionId: executionId || crypto.randomUUID(),
      organizationId: workflow.organizationId,
      venueId: workflow.venueId,
      triggerData,
      variables: { ...workflow.variables, ...triggerData },
      currentStep: workflow.steps[0]?.id || '',
      status: 'running',
      startTime: new Date(),
      stepHistory: []
    };

    try {
      // Initialize variables with trigger data
      this.variableManager.initializeContext(context);

      // Start execution from first step
      await this.executeSteps(workflow, context);
      
      context.status = 'completed';
      context.endTime = new Date();

      // Emit completion event
      await this.emitExecutionEvent(context, 'workflow_completed');

    } catch (error) {
      context.status = 'failed';
      context.endTime = new Date();
      context.error = error instanceof Error ? error.message : String(error);
      
      // Emit failure event
      await this.emitExecutionEvent(context, 'workflow_failed');
      
      throw error;
    }

    return context;
  }

  /**
   * Execute workflow steps sequentially
   */
  private async executeSteps(
    workflow: WorkflowDefinition, 
    context: ExecutionContext
  ): Promise<void> {
    const stepMap = new Map(workflow.steps.map(step => [step.id, step]));
    let currentStepId = context.currentStep;

    while (currentStepId) {
      const step = stepMap.get(currentStepId);
      if (!step) {
        throw new Error(`Step not found: ${currentStepId}`);
      }

      context.currentStep = currentStepId;
      await this.emitExecutionEvent(context, 'step_started');

      try {
        const stepResult = await this.executeStep(step, context, workflow.settings);
        
        // Update step history
        context.stepHistory.push({
          stepId: step.id,
          status: 'completed',
          startTime: new Date(),
          endTime: new Date(),
          input: stepResult.input,
          output: stepResult.output
        });

        await this.emitExecutionEvent(context, 'step_completed');

        // Determine next step
        currentStepId = this.getNextStep(step, stepResult.output, stepMap);

      } catch (error) {
        // Update step history with error
        context.stepHistory.push({
          stepId: step.id,
          status: 'failed',
          startTime: new Date(),
          endTime: new Date(),
          error: error instanceof Error ? error.message : String(error)
        });

        await this.emitExecutionEvent(context, 'step_failed');

        // Handle error - either retry or jump to error step
        if (step.onError) {
          currentStepId = step.onError;
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep,
    context: ExecutionContext,
    settings: WorkflowDefinition['settings']
  ): Promise<{ input: Record<string, unknown>; output: Record<string, unknown> }> {
    
    // Resolve variables in step config
    const resolvedConfig = this.variableManager.resolveVariables(
      step.config,
      context.variables
    );

    // Execute step with retry logic
    return await this.retryManager.executeWithRetry(
      async () => {
        return await this.stepProcessor.executeStep(step.type, resolvedConfig, context);
      },
      settings.maxRetries,
      settings.retryDelay
    );
  }

  /**
   * Determine the next step based on step configuration and output
   */
  private getNextStep(
    currentStep: WorkflowStep,
    stepOutput: Record<string, unknown>,
    stepMap: Map<string, WorkflowStep>
  ): string | null {
    
    // If it's a condition step, evaluate the condition
    if (currentStep.type === 'condition') {
      const condition = stepOutput.condition as boolean;
      const nextSteps = currentStep.nextSteps;
      
      if (condition && nextSteps[0]) {
        return nextSteps[0]; // True branch
      } else if (!condition && nextSteps[1]) {
        return nextSteps[1]; // False branch
      }
      return null; // End workflow
    }

    // For other steps, take the first next step or end
    return currentStep.nextSteps[0] || null;
  }

  /**
   * Emit real-time execution events
   */
  private async emitExecutionEvent(
    context: ExecutionContext,
    eventType: 'workflow_started' | 'workflow_completed' | 'workflow_failed' | 
              'step_started' | 'step_completed' | 'step_failed'
  ): Promise<void> {
    // This will be connected to WebSocket broadcasting
    // For now, log the event
    console.log(`[${new Date().toISOString()}] ${eventType}:`, {
      workflowId: context.workflowId,
      executionId: context.executionId,
      currentStep: context.currentStep,
      status: context.status
    });

    // TODO: Implement real-time event broadcasting
    // await this.eventPublisher.publish(eventType, context);
  }

  /**
   * Cancel a running workflow execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    // TODO: Implement execution cancellation
    console.log(`Cancelling execution: ${executionId}`);
  }

  /**
   * Get execution status
   */
  async getExecutionStatus(executionId: string): Promise<ExecutionContext | null> {
    // TODO: Implement status retrieval from database
    return null;
  }
}