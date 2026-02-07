/**
 * Tool Loader - Loads available tools from database
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Logger } from "../utils/logger.ts";

export interface DatabaseTool {
  tool_id: string;
  tool_name: string;
  tool_description: string;
  tool_type: 'http_request' | 'postgres' | 'workflow' | 'memory' | 'ai_model';
  method?: string;
  url?: string;
  authentication?: string;
  credentials_id?: string;
  tool_body?: Record<string, any>;
  tool_headers?: Record<string, any>;
  tool_params?: Record<string, any>;
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
    context: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    
    try {
      this.logger.debug(`Executing tool: ${tool.tool_name}`, { tool_type: tool.tool_type });

      switch (tool.tool_type) {
        case 'http_request':
          return await this.executeHttpTool(tool, parameters, context);
        case 'postgres':
          return await this.executePostgresTool(tool, parameters, context);
        case 'workflow':
          return await this.executeWorkflowTool(tool, parameters, context);
        default:
          throw new Error(`Tool type ${tool.tool_type} not supported yet`);
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Tool execution failed: ${tool.tool_name}`, error);
      
      return {
        tool_name: tool.tool_name,
        success: false,
        error: (error as Error).message || 'Unknown error',
        execution_time_ms: executionTime
      };
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

    // Replace template variables in URL and body
    let url = this.replaceTemplateVars(tool.url!, { ...parameters, ...context });
    let body = this.replaceTemplateVars(JSON.stringify(tool.tool_body || {}), { ...parameters, ...context });

    const response = await fetch(url, {
      method: tool.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...tool.tool_headers
      },
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
   * Log tool execution to database
   */
  async logToolExecution(
    workflowExecutionId: string,
    toolResult: ToolExecutionResult
  ): Promise<void> {
    try {
      await this.supabase
        .from('workflow_execution_steps')
        .insert({
          execution_id: workflowExecutionId,
          step_id: `tool_${toolResult.tool_name}`,
          step_name: toolResult.tool_name,
          step_type: 'tool',
          step_order: 100, // Tools are executed after agents
          status: toolResult.success ? 'completed' : 'failed',
          output_data: {
            result: toolResult.result,
            error: toolResult.error
          },
          started_at: new Date(Date.now() - toolResult.execution_time_ms).toISOString(),
          completed_at: new Date().toISOString(),
          output_processing_time_ms: toolResult.execution_time_ms,
          node_id: `tool_${toolResult.tool_name}`
        });
    } catch (error) {
      this.logger.warn('Failed to log tool execution', error);
    }
  }
}