/**
 * Tool Loader - Loads available tools from database
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Logger } from "../utils/logger.ts";

export interface DatabaseTool {
  id: string;
  tool_name: string;
  tool_description: string;
  tool_type: 'http_request' | 'postgres' | 'postgresTool' | 'httpRequestTool' | 'workflow' | 'memory' | 'ai_model' | 'edge_function';
  method?: string;
  url?: string;
  authentication?: string;
  credentials_id?: string;
  tool_body?: Record<string, any>;
  tool_headers?: Record<string, any>;
  tool_params?: Record<string, any>;
  workflow_template_id?: string;
}

export interface ToolExecutionResult {
  tool_name: string;
  success: boolean;
  result?: any;
  error?: string;
  execution_time_ms: number;
}

export class ToolLoader {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.logger = new Logger('ToolLoader');
  }

  /**
   * Load all available tools from database
   */
  async loadAvailableTools(): Promise<DatabaseTool[]> {
    const { data: tools, error } = await this.supabase
      .from('workflow_tools')
      .select('*')
      .order('tool_name');

    if (error) {
      this.logger.error('Failed to load tools from database', error);
      return [];
    }

    return tools || [];
  }

  /**
   * Get specific tools by names
   */
  async getToolsByNames(toolNames: string[]): Promise<DatabaseTool[]> {
    const { data: tools, error } = await this.supabase
      .from('workflow_tools')
      .select('*')
      .in('tool_name', toolNames);

    if (error) {
      this.logger.error('Failed to get tools by names', error);
      return [];
    }

    return tools || [];
  }

  /**
   * Execute a tool based on its configuration
   */
  async executeTool(
    tool: DatabaseTool, 
    parameters: Record<string, any>, 
    context: Record<string, any>,
    workflowExecutionId?: string
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    let toolStepId: string | null = null;
    
    try {
      this.logger.debug(`Executing tool: ${tool.tool_name}`, { tool_type: tool.tool_type });

      // Step 1: Create tool step as 'pending' if workflowExecutionId provided
      if (workflowExecutionId) {
        toolStepId = await this.createPendingToolStep(workflowExecutionId, tool, { ...parameters, ...context });
      }

      // Step 2: Update to 'running' before execution starts
      if (workflowExecutionId && toolStepId) {
        await this.updateToolStepStatus(toolStepId, 'running', new Date().toISOString());
      }

      let result: ToolExecutionResult;
      switch (tool.tool_type) {
        case 'http_request':
          result = await this.executeHttpTool(tool, parameters, context);
          break;
        case 'postgres':
        case 'postgresTool':
          result = await this.executePostgresTool(tool, parameters, context);
          break;
        case 'edge_function':
          result = await this.executeEdgeFunctionTool(tool, parameters, context);
          break;
        case 'workflow':
          result = await this.executeWorkflowTool(tool, parameters, context);
          break;
        default:
          throw new Error(`Tool type ${tool.tool_type} not supported yet`);
      }
      
      // Step 3: Update to 'completed' after successful execution
      if (workflowExecutionId && toolStepId) {
        await this.updateToolStepCompletion(toolStepId, result);
      }
      
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Tool execution failed: ${tool.tool_name}`, error);
      
      const result = {
        tool_name: tool.tool_name,
        success: false,
        error: (error as Error).message || 'Unknown error',
        execution_time_ms: executionTime
      };
      
      // Step 3: Update to 'failed' after error
      if (workflowExecutionId && toolStepId) {
        await this.updateToolStepCompletion(toolStepId, result);
      }
      
      return result;
    }
  }

  /**
   * Execute HTTP request tool
   */
  private async executeHttpTool(
    tool: DatabaseTool, 
    parameters: Record<string, any>, 
    context: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    // Add service role key to context for replacement
    const enrichedContext = {
      ...context,
      ...parameters,
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      database_project_ref: 'qaymciaujneyqhsbycmp' // Add the project ref
    };

    // Replace template variables in URL, headers, and body
    let url = this.replaceTemplateVars(tool.url!, enrichedContext);
    let body = this.replaceTemplateVars(JSON.stringify(tool.tool_body || {}), enrichedContext);
    
    // Process headers with template variables
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (tool.tool_headers) {
      for (const [key, value] of Object.entries(tool.tool_headers)) {
        headers[key] = this.replaceTemplateVars(String(value), enrichedContext);
      }
    }

    this.logger.debug(`Executing HTTP tool: ${tool.tool_name}`, {
      url,
      method: tool.method || 'POST',
      headers: { ...headers, Authorization: headers.Authorization ? '[REDACTED]' : undefined }
    });

    const response = await fetch(url, {
      method: tool.method || 'POST',
      headers,
      body: body !== '{}' ? body : undefined
    });

    const result = await response.json();
    const executionTime = Date.now() - startTime;

    return {
      tool_name: tool.tool_name,
      success: response.ok,
      result: result,
      error: !response.ok ? result.message || 'HTTP request failed' : undefined,
      execution_time_ms: executionTime
    };
  }

  /**
   * Execute Postgres tool
   */
  private async executePostgresTool(
    tool: DatabaseTool, 
    parameters: Record<string, any>, 
    context: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    const query = this.replaceTemplateVars(tool.tool_body?.query || '', { ...parameters, ...context });
    
    // Log the generated SQL for debugging
    this.logger.debug(`Executing Postgres tool: ${tool.tool_name}`, {
      original_query: tool.tool_body?.query,
      generated_query: query,
      parameters,
      context_keys: Object.keys(context)
    });
    
    const { data, error } = await this.supabase.rpc('exec_sql', {
      sql_query: query
    });

    const executionTime = Date.now() - startTime;

    return {
      tool_name: tool.tool_name,
      success: !error,
      result: data,
      error: error?.message,
      execution_time_ms: executionTime
    };
  }

  /**
   * Execute Edge Function tool
   */
  private async executeEdgeFunctionTool(
    tool: DatabaseTool, 
    parameters: Record<string, any>, 
    context: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    // Add service role key to context for replacement
    const enrichedContext = {
      ...context,
      ...parameters,
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      database_project_ref: 'qaymciaujneyqhsbycmp'
    };

    // Replace template variables in URL and body
    let url = this.replaceTemplateVars(tool.url!, enrichedContext);
    let body = this.replaceTemplateVars(JSON.stringify(tool.tool_body || {}), enrichedContext);
    
    // Process headers with template variables
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
    };
    
    if (tool.tool_headers) {
      for (const [key, value] of Object.entries(tool.tool_headers)) {
        headers[key] = this.replaceTemplateVars(String(value), enrichedContext);
      }
    }

    this.logger.debug(`Executing Edge Function tool: ${tool.tool_name}`, {
      url,
      method: tool.method || 'POST'
    });

    const response = await fetch(url, {
      method: tool.method || 'POST',
      headers,
      body: body !== '{}' ? body : undefined
    });

    const result = await response.json();
    const executionTime = Date.now() - startTime;

    return {
      tool_name: tool.tool_name,
      success: response.ok,
      result: result,
      error: !response.ok ? result.message || 'Edge function request failed' : undefined,
      execution_time_ms: executionTime
    };
  }

  /**
   * Execute workflow tool (n8n workflow call)
   */
  private async executeWorkflowTool(
    tool: DatabaseTool, 
    parameters: Record<string, any>, 
    context: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    
    // This would call n8n workflow - placeholder for now
    this.logger.info(`Would execute n8n workflow: ${tool.url}`, { parameters });
    
    const executionTime = Date.now() - startTime;
    
    return {
      tool_name: tool.tool_name,
      success: true,
      result: { message: `Workflow ${tool.tool_name} executed successfully` },
      execution_time_ms: executionTime
    };
  }

  /**
   * Replace template variables in strings
   */
  private replaceTemplateVars(template: string, vars: Record<string, any>): string {
    let result = template;
    
    // Replace {{variable}} patterns
    for (const [key, value] of Object.entries(vars)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, String(value || ''));
    }
    
    return result;
  }

  /**
   * Extract variables used in a template string
   */
  private extractUsedVariables(template: string, context: Record<string, any>): Record<string, any> {
    const usedVars: Record<string, any> = {};
    const varPattern = /\{\{(\w+)\}\}/g;
    let match;
    
    while ((match = varPattern.exec(template)) !== null) {
      const varName = match[1];
      if (context[varName] !== undefined) {
        usedVars[varName] = context[varName];
      }
    }
    
    return usedVars;
  }

  /**
   * Create a pending tool step before execution starts
   */
  private async createPendingToolStep(
    workflowExecutionId: string,
    tool: DatabaseTool,
    context: Record<string, any>
  ): Promise<string> {
    try {
      // Extract only the variables that were actually used by this tool
      let inputData: Record<string, any> = {};
      
      if ((tool.tool_type === 'postgres' || tool.tool_type === 'postgresTool') && tool.tool_body?.query) {
        inputData = this.extractUsedVariables(tool.tool_body.query, context);
      } else if (tool.tool_type === 'http_request' || tool.tool_type === 'httpRequestTool') {
        // Extract variables from URL and body
        if (tool.url) {
          Object.assign(inputData, this.extractUsedVariables(tool.url, context));
        }
        if (tool.tool_body) {
          Object.assign(inputData, this.extractUsedVariables(JSON.stringify(tool.tool_body), context));
        }
      }

      // Get the highest step_order to add the tool step after existing steps
      const { data: maxOrderData } = await this.supabase
        .from('workflow_execution_steps')
        .select('step_order')
        .eq('execution_id', workflowExecutionId)
        .order('step_order', { ascending: false })
        .limit(1)
        .single();

      const nextStepOrder = (maxOrderData?.step_order || 0) + 1;

      // Insert a new tool workflow step as 'pending'
      const { data, error } = await this.supabase
        .from('workflow_execution_steps')
        .insert({
          execution_id: workflowExecutionId,
          step_order: nextStepOrder,
          step_type: 'tool',
          step_name: tool.tool_name,
          node_id: tool.id || `tool_${tool.tool_name}`,
          status: 'pending',
          input_data: inputData
        })
        .select('id')
        .single();

      if (error) {
        throw new Error(`Failed to create pending tool step: ${error.message}`);
      }

      return data.id;
    } catch (error) {
      this.logger.warn('Failed to create pending tool step', error);
      throw error;
    }
  }

  /**
   * Update tool step status (to 'running')
   */
  private async updateToolStepStatus(
    toolStepId: string,
    status: 'running',
    startedAt: string
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('workflow_execution_steps')
        .update({
          status: status,
          started_at: startedAt
        })
        .eq('id', toolStepId);

      if (error) {
        throw new Error(`Failed to update tool step status: ${error.message}`);
      }
    } catch (error) {
      this.logger.warn('Failed to update tool step status', error);
    }
  }

  /**
   * Update tool step completion (to 'completed' or 'failed')
   */
  private async updateToolStepCompletion(
    toolStepId: string,
    toolResult: ToolExecutionResult
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('workflow_execution_steps')
        .update({
          status: toolResult.success ? 'completed' : 'failed',
          output_data: {
            result: toolResult.result,
            error: toolResult.error
          },
          completed_at: new Date().toISOString(),
          output_processing_time_ms: toolResult.execution_time_ms
        })
        .eq('id', toolStepId);

      if (error) {
        throw new Error(`Failed to update tool step completion: ${error.message}`);
      }
    } catch (error) {
      this.logger.warn('Failed to update tool step completion', error);
    }
  }

  /**
   * Log tool execution to database with only used variables (DEPRECATED - replaced by lifecycle methods)
   */
  async logToolExecution(
    workflowExecutionId: string,
    toolResult: ToolExecutionResult,
    tool?: DatabaseTool,
    context?: Record<string, any>
  ): Promise<void> {
    // This method is deprecated in favor of the new lifecycle tracking
    // Keeping for backward compatibility but will not be used
    this.logger.debug('logToolExecution called but using new lifecycle tracking instead');
  }
}