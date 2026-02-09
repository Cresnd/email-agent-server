/**
 * Individual step execution processor
 * Handles the execution of different types of workflow steps
 */

import { ExecutionContext } from './executor.ts';
import { GuardrailExecutor, GuardrailDefinition } from './guardrail-executor.ts';

export interface StepResult {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export class StepProcessor {
  private guardrailExecutor: GuardrailExecutor;

  constructor() {
    this.guardrailExecutor = new GuardrailExecutor();
  }

  /**
   * Execute a workflow step based on its type
   */
  async executeStep(
    stepType: string,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<StepResult> {
    
    const input = { ...config };
    let output: Record<string, unknown> = {};

    switch (stepType) {
      case 'email_classifier':
        output = await this.executeEmailClassifier(config, context);
        break;
        
      case 'agent_selector':
        output = await this.executeAgentSelector(config, context);
        break;
        
      case 'agent_executor':
        output = await this.executeAgentExecutor(config, context);
        break;
        
      case 'condition':
        output = await this.executeCondition(config, context);
        break;
        
      case 'webhook':
        output = await this.executeWebhook(config, context);
        break;
        
      case 'delay':
        output = await this.executeDelay(config, context);
        break;

      case 'guardrail':
        output = await this.executeGuardrail(config, context);
        break;

      case 'send':
        output = await this.executeSend(config, context);
        break;
        
      default:
        throw new Error(`Unknown step type: ${stepType}`);
    }

    return { input, output };
  }

  /**
   * Execute email classification step
   */
  private async executeEmailClassifier(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    
    const emailData = context.variables.email as any;
    if (!emailData) {
      throw new Error('No email data available for classification');
    }

    // Extract email content for analysis
    const emailContent = {
      subject: emailData.subject || '',
      body: emailData.body || emailData.text || '',
      from: emailData.from || '',
      to: emailData.to || '',
      cc: emailData.cc || '',
      bcc: emailData.bcc || ''
    };

    // TODO: Implement actual AI classification
    // For now, return mock classification
    const classification = await this.classifyEmail(emailContent);

    return {
      classification: classification.category,
      confidence: classification.confidence,
      entities: classification.entities,
      intent: classification.intent,
      priority: classification.priority,
      requires_response: classification.requires_response,
      urgency: classification.urgency
    };
  }

  /**
   * Execute agent selection step
   */
  private async executeAgentSelector(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    
    const classification = context.variables.classification as any;
    const selectionRules = config.selection_rules as any[] || [];

    // Select appropriate agent based on classification and rules
    let selectedAgent = null;
    
    for (const rule of selectionRules) {
      if (this.matchesRule(classification, rule.criteria)) {
        selectedAgent = rule.agent;
        break;
      }
    }

    // Default agent if no rules match
    if (!selectedAgent) {
      selectedAgent = config.default_agent || 'general_assistant';
    }

    return {
      selected_agent: selectedAgent,
      selection_reason: 'Rule-based selection',
      agent_config: config.agent_configs?.[selectedAgent] || {}
    };
  }

  /**
   * Execute agent execution step
   */
  private async executeAgentExecutor(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    
    const agentType = context.variables.selected_agent as string;
    const emailData = context.variables.email as any;
    const classification = context.variables.classification as any;

    // Prepare agent input
    const agentInput = {
      email: emailData,
      classification,
      venue_context: context.venueId ? await this.getVenueContext(context.venueId) : null,
      config: config
    };

    // TODO: Implement actual agent execution
    // This would integrate with existing AI agent infrastructure
    const agentResult = await this.executeAgent(agentType, agentInput);

    return {
      agent_response: agentResult.response,
      actions_taken: agentResult.actions,
      confidence: agentResult.confidence,
      execution_time: agentResult.execution_time,
      status: agentResult.status
    };
  }

  /**
   * Execute condition evaluation step
   */
  private async executeCondition(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    
    const conditionType = config.condition_type as string;
    const conditionValue = config.condition_value;
    const variableName = config.variable_name as string;
    
    const variableValue = context.variables[variableName];
    let result = false;

    switch (conditionType) {
      case 'equals':
        result = variableValue === conditionValue;
        break;
      case 'not_equals':
        result = variableValue !== conditionValue;
        break;
      case 'greater_than':
        result = Number(variableValue) > Number(conditionValue);
        break;
      case 'less_than':
        result = Number(variableValue) < Number(conditionValue);
        break;
      case 'contains':
        result = String(variableValue).includes(String(conditionValue));
        break;
      case 'exists':
        result = variableValue !== undefined && variableValue !== null;
        break;
      default:
        throw new Error(`Unknown condition type: ${conditionType}`);
    }

    return {
      condition: result,
      variable_value: variableValue,
      condition_value: conditionValue,
      condition_type: conditionType
    };
  }

  /**
   * Execute webhook call step
   */
  private async executeWebhook(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    
    const url = config.url as string;
    const method = (config.method as string) || 'POST';
    const headers = config.headers as Record<string, string> || {};
    const body = config.body || context.variables;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body)
      });

      const responseData = await response.text();
      let parsedResponse = responseData;
      
      try {
        parsedResponse = JSON.parse(responseData);
      } catch {
        // Keep as string if not valid JSON
      }

      return {
        status_code: response.status,
        response: parsedResponse,
        headers: Object.fromEntries(response.headers.entries()),
        success: response.ok
      };

    } catch (error) {
      throw new Error(`Webhook execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute delay step
   */
  private async executeDelay(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    
    const delayMs = Number(config.delay_ms) || 1000;
    
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    return {
      delayed_ms: delayMs,
      timestamp: new Date().toISOString()
    };
  }

  // Helper methods

  private async classifyEmail(emailContent: any): Promise<{
    category: string;
    confidence: number;
    entities: any[];
    intent: string;
    priority: string;
    requires_response: boolean;
    urgency: string;
  }> {
    // TODO: Implement actual AI classification logic
    // This is a mock implementation
    const mockClassifications = [
      { category: 'booking_request', intent: 'make_reservation', priority: 'high' },
      { category: 'booking_modification', intent: 'modify_reservation', priority: 'medium' },
      { category: 'cancellation', intent: 'cancel_reservation', priority: 'high' },
      { category: 'inquiry', intent: 'ask_question', priority: 'medium' },
      { category: 'complaint', intent: 'report_issue', priority: 'high' },
      { category: 'compliment', intent: 'give_feedback', priority: 'low' }
    ];

    const classification = mockClassifications[Math.floor(Math.random() * mockClassifications.length)];
    
    return {
      category: classification.category,
      confidence: 0.85 + Math.random() * 0.15, // 85-100%
      entities: [], // TODO: Extract entities from email
      intent: classification.intent,
      priority: classification.priority,
      requires_response: ['booking_request', 'cancellation', 'complaint', 'inquiry'].includes(classification.category),
      urgency: classification.priority === 'high' ? 'urgent' : 'normal'
    };
  }

  private matchesRule(classification: any, criteria: any): boolean {
    // Simple rule matching logic
    for (const [key, value] of Object.entries(criteria)) {
      if (classification[key] !== value) {
        return false;
      }
    }
    return true;
  }

  private async executeAgent(agentType: string, input: any): Promise<{
    response: string;
    actions: string[];
    confidence: number;
    execution_time: number;
    status: string;
  }> {
    // TODO: Integrate with existing agent infrastructure
    const startTime = Date.now();
    
    // Mock agent execution
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
    
    return {
      response: `Agent ${agentType} processed the email successfully.`,
      actions: ['email_classified', 'response_generated'],
      confidence: 0.9,
      execution_time: Date.now() - startTime,
      status: 'completed'
    };
  }

  private async getVenueContext(venueId: string): Promise<any> {
    // TODO: Fetch venue context from database
    return {
      venue_id: venueId,
      name: 'Mock Venue',
      settings: {}
    };
  }

  private async executeGuardrail(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const guardrailType = config.guardrail_type as string;
    const guardrailsKey = `${guardrailType}_guardrails`;
    const guardrails = (context.variables.guardrails as any)?.[guardrailsKey] as GuardrailDefinition[] | undefined;

    if (!guardrails || guardrails.length === 0) {
      return { continue: true, guardrail_type: guardrailType, message: 'No guardrails configured' };
    }

    const emailData = context.variables.email as any;
    const result = await this.guardrailExecutor.executeGuardrails(guardrails, {
      guardrail_type: guardrailType,
      system_prompt: config.system_prompt as string | undefined,
      model: config.model as string | undefined,
      content_to_evaluate: {
        subject: emailData?.subject || '',
        message_for_ai: emailData?.message_for_ai || emailData?.body || ''
      }
    });

    return {
      ...result,
      guardrail_type: guardrailType,
      guardrails_evaluated: guardrails.length
    };
  }

  /**
   * Execute send email step
   */
  private async executeSend(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    
    // Extract required data from context
    const triggerData = context.triggerData as any;
    const lastStepOutput = context.stepHistory[context.stepHistory.length - 1]?.output;
    
    // Get customer email from trigger node's output_data
    const customerEmail = triggerData?.customer_email || triggerData?.from || '';
    
    // Get HTML message from the last executed node's output_data
    const bodyHtml = lastStepOutput?.body_html || lastStepOutput?.ai_response?.body_html || '';
    
    // Extract email data from execution context
    const emailData = {
      to: customerEmail,
      body_html: bodyHtml,
      venue_id: context.venueId || '',
      subject: config.subject as string || triggerData?.subject || 'Re: Your inquiry',
      from: config.from as string || triggerData?.venue_email || '',
      inReplyTo: triggerData?.message_id || '',
      references: triggerData?.references || '',
      folder_path: config.folder_path as string || 'Sent',
      attachments: config.attachments as string || '',
      outlook_id: triggerData?.outlook_id || ''
    };

    // Validate required fields
    if (!emailData.to) {
      throw new Error('Send node: No recipient email address found in trigger data');
    }
    
    if (!emailData.body_html) {
      throw new Error('Send node: No email content found in previous step output');
    }

    // Determine email service based on outlook_id presence
    const isOutlook = !!emailData.outlook_id;
    const baseUrl = 'http://172.17.0.1:3005'; // Email service base URL
    const endpoint = isOutlook ? '/outlook/reply' : '/smtp/send';
    const url = `${baseUrl}${endpoint}`;

    try {
      // Prepare request payload based on service type
      let requestPayload: any;
      
      if (isOutlook) {
        requestPayload = {
          outlook_id: emailData.outlook_id,
          to: emailData.to,
          subject: emailData.subject,
          body_html: emailData.body_html,
          inReplyTo: emailData.inReplyTo,
          references: emailData.references,
          folder_path: emailData.folder_path,
          attachments: emailData.attachments
        };
      } else {
        requestPayload = {
          venue_id: emailData.venue_id,
          to: emailData.to,
          subject: emailData.subject,
          body_html: emailData.body_html,
          from: emailData.from,
          folder_path: emailData.folder_path,
          attachments: emailData.attachments
        };
      }

      // Send email via appropriate endpoint
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Email sending failed (${response.status}): ${errorText}`);
      }

      const responseData = await response.json();

      return {
        status: 'sent',
        service: isOutlook ? 'outlook' : 'smtp',
        to: emailData.to,
        subject: emailData.subject,
        message_id: responseData.message_id || '',
        sent_at: new Date().toISOString(),
        response_data: responseData
      };

    } catch (error) {
      throw new Error(`Send node execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}