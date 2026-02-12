/**
 * Database Queries Module
 * Replicates the exact n8n database queries for email preprocessing flow
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Logger } from "../utils/logger.ts";

export class DatabaseQueries {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.logger = new Logger('DatabaseQueries');
  }

  /**
   * Phase 2.1: Venue Configuration Query
   * Gets email infrastructure, delay settings, ignored emails/domains, 
   * sorting rules, workflows, and finance email
   */
  async getVenueConfiguration(venueId: string): Promise<any> {
    this.logger.debug('Querying venue configuration', { venue_id: venueId });

    // Direct query using proper Supabase client methods
    const { data: venueData, error: venueError } = await this.supabase
      .from('venue')
      .select(`
        id,
        email_delay,
        organizationid,
        emails_to_ignore!venue_id (email_address, domain),
        email_sorting_rules!venue_id (email_address, folder_path, mark_as_seen),
        emailtovenue!venueid (email, purpose)
      `)
      .eq('id', venueId)
      .single();

    if (venueError) {
      this.logger.error('Venue configuration query failed', venueError, { venue_id: venueId });
      throw new Error(`Venue configuration query failed: ${venueError.message}`);
    }

    // Get standard sorting rules by organization
    const { data: standardRules, error: rulesError } = await this.supabase
      .from('standard_sorting_rules')
      .select('type, folder_path, mark_as_seen')
      .eq('venue_id', venueId);

    if (rulesError) {
      this.logger.warn(`Could not fetch standard sorting rules: ${rulesError.message}`, {
        venue_id: venueId,
        organization_id: venueData.organizationid
      });
    }

    // Process the data
    const emailAddressesIgnore = venueData.emails_to_ignore?.map((e: any) => e.email_address).filter(Boolean) || [];
    const domainsIgnore = venueData.emails_to_ignore?.map((e: any) => e.domain).filter(Boolean) || [];
    
    return {
      email_addresses_ignore: emailAddressesIgnore,
      domains_ignore: domainsIgnore,
      email_sorting_rules: venueData.email_sorting_rules || [],
      standard_sorting_rules: standardRules || [],
      workflows: [], // Placeholder
      finance_email: venueData.emailtovenue?.find((e: any) => e.purpose === 'finance')?.email || '',
      email_infrastructure: {
        type: 'supabase',
        project_ref: 'qaymciaujneyqhsbycmp'
      },
      email_delay: venueData.email_delay || 0
    };
  }

  /**
   * Phase 2.2: Venue & Organization Details Query  
   * Gets venue info and resolves dashboard session if exists
   */
  async getVenueAndOrganizationDetails(venueId: string): Promise<any> {
    this.logger.debug('Querying venue and organization details', { venue_id: venueId });

    const { data: venueData, error: venueError } = await this.supabase
      .from('venue')
      .select(`
        id,
        name,
        address,
        description,
        timezone,
        organizationid,
        organization!inner (
          name
        )
      `)
      .eq('id', venueId)
      .single();

    if (venueError) {
      this.logger.error('Venue details query failed', venueError, { venue_id: venueId });
      throw new Error(`Venue details query failed: ${venueError.message}`);
    }

    return {
      venue_name: venueData.name,
      venue_address: venueData.address,
      venue_description: venueData.description,
      venue_timezone: venueData.timezone,
      organization_id: venueData.organizationid,
      organization_name: venueData.organization?.name
    };
  }

  async getVenueAndSessionDetails(venueId: string, customerEmail: string): Promise<any> {
    this.logger.debug('Querying venue and session details', { venue_id: venueId, customer_email: customerEmail });

    // Get venue and organization details
    const { data: venueData, error: venueError } = await this.supabase
      .from('venue')
      .select(`
        id,
        name,
        address,
        description,
        timezone,
        organizationid,
        organization!inner (
          name
        )
      `)
      .eq('id', venueId)
      .single();

    if (venueError) {
      this.logger.error('Venue details query failed', venueError, { venue_id: venueId });
      throw new Error(`Venue details query failed: ${venueError.message}`);
    }

    // Get latest dashboard session for customer
    const { data: sessionData, error: sessionError } = await this.supabase
      .from('dashboardsession')
      .select('id, customerphonenumber')
      .eq('venue_id', venueId)
      .ilike('customeremail', customerEmail.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Don't throw error for missing session - it's optional
    if (sessionError && sessionError.code !== 'PGRST116') {
      this.logger.warn(`Dashboard session query warning: ${sessionError.message}`, {
        venue_id: venueId,
        customer_email: customerEmail
      });
    }

    return {
      session_id: sessionData?.id || null,
      phone_number: sessionData?.customerphonenumber || null,
      venue_name: venueData.name,
      venue_address: venueData.address,
      venue_description: venueData.description,
      venue_timezone: venueData.timezone,
      organization_id: venueData.organizationid,
      organization_name: venueData.organization.name
    };
  }

  /**
   * Phase 2.3: Prompts & Guardrails Query
   * Gets venue-specific prompts and guardrails by type
   */
  async getVenuePromptsAndGuardrails(venueId: string): Promise<any> {
    this.logger.debug('Querying venue prompts and guardrails', { venue_id: venueId });

    // Get venue prompts
    const { data: promptData, error: promptError } = await this.supabase
      .from('venue_compiled_prompt_link')
      .select(`
        venue_compiled_prompt!inner (
          content,
          prompt_category_id,
          prompt_category!inner (
            name
          ),
          prompt_category_to_section!inner (
            prompt_section!inner (
              name
            )
          )
        )
      `)
      .eq('venue_id', venueId);

    if (promptError) {
      this.logger.warn(`Prompts query failed: ${promptError.message}`, { venue_id: venueId });
    }

    // Get venue guardrails  
    const { data: guardrailData, error: guardrailError } = await this.supabase
      .from('venue_guardrail')
      .select(`
        threshold,
        folder_path,
        mark_as_seen,
        guardrail_template!inner (
          name,
          prompt,
          default_threshold
        )
      `)
      .eq('venue_id', venueId)
      .eq('active', true)
      .eq('guardrail_template.active', true);

    if (guardrailError) {
      this.logger.warn(`Guardrails query failed: ${guardrailError.message}`, { venue_id: venueId });
    }

    // Process prompts into keyed object
    const venuePrompts: Record<string, any> = {};
    if (promptData) {
      promptData.forEach((item: any) => {
        const vcp = item.venue_compiled_prompt;
        const sectionName = vcp.prompt_category_to_section[0]?.prompt_section?.name || 'general';
        const categoryName = vcp.prompt_category?.name || 'default';
        const key = `${sectionName}_${categoryName}`;
        
        venuePrompts[key] = {
          content: vcp.content,
          section: sectionName,
          category: categoryName
        };
      });
    }

    // Process guardrails into keyed object
    const guardrails: Record<string, any> = {};
    if (guardrailData) {
      guardrailData.forEach((item: any) => {
        const template = item.guardrail_template;
        const key = `${template.name}_guardrails`;
        
        guardrails[key] = {
          name: template.name,
          prompt: template.prompt,
          threshold: item.threshold || template.default_threshold || 0.7,
          folder_path: item.folder_path || '/blocked',
          mark_as_seen: item.mark_as_seen !== null ? item.mark_as_seen : true
        };
      });
    }

    return {
      venue_prompts: venuePrompts,
      guardrails: guardrails
    };
  }

  /**
   * Log email processing to email_processing_log table
   */
  async logEmailProcessing(logData: {
    id: string;
    email_account_id?: string;
    organization_id?: string;
    venue_id?: string;
    email_uid?: string;
    email_subject?: string;
    email_from?: string;
    email_to?: string;
    email_date?: string;
    processing_status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored' | 'cancelled';
    error_message?: string;
    processing_time_ms?: number;
    processed_at: string;
  }): Promise<void> {
    
    const { error } = await this.supabase
      .from('email_processing_log')
      .insert({
        id: logData.id,
        email_account_id: logData.email_account_id,
        organization_id: logData.organization_id,
        venue_id: logData.venue_id,
        email_uid: logData.email_uid,
        email_subject: logData.email_subject,
        email_from: logData.email_from,
        email_to: logData.email_to,
        email_date: logData.email_date,
        processing_status: logData.processing_status,
        error_message: logData.error_message,
        processed_at: logData.processed_at
      });

    if (error) {
      throw new Error(`Failed to log email processing: ${error.message}`);
    }
  }

  /**
   * Create workflow execution record
   */
  async createWorkflowExecution(executionData: {
    id: string;
    workflow_id: string;
    organization_id: string;
    venue_id?: string;
    parent_execution?: string | null;
    started_at?: string;
    customer_email?: string;
    subject?: string;
    trigger_type: string;
    trigger_data: any;
    variables: any;
  }): Promise<void> {
    
    const { error } = await this.supabase
      .from('workflow_executions')
      .insert({
        id: executionData.id,
        workflow_id: executionData.workflow_id,
        organization_id: executionData.organization_id,
        venue_id: executionData.venue_id,
        parent_execution: executionData.parent_execution,
        started_at: executionData.started_at,
        customer_email: executionData.customer_email,
        subject: executionData.subject,
        trigger_type: executionData.trigger_type,
        trigger_data: executionData.trigger_data,
        variables: executionData.variables,
        status: 'pending'
      });

    if (error) {
      throw new Error(`Failed to create workflow execution: ${error.message}`);
    }
  }

  /**
   * Update workflow execution status
   */
  async updateWorkflowExecution(
    executionId: string,
    updates: {
      status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      current_step?: string;
      variables?: any;
      error_message?: string;
      end_time?: string;
    }
  ): Promise<void> {
    
    // Avoid downgrading a cancelled execution back to running/completed
    if (updates.status && updates.status !== 'cancelled') {
      const { data: current, error: fetchError } = await this.supabase
        .from('workflow_executions')
        .select('status')
        .eq('id', executionId)
        .single();

      if (!fetchError && current?.status === 'cancelled') {
        this.logger.info('Skipping execution update because it is already cancelled', {
          execution_id: executionId,
          attempted_status: updates.status
        });
        return;
      }
    }

    const { error } = await this.supabase
      .from('workflow_executions')
      .update(updates)
      .eq('id', executionId);

    if (error) {
      throw new Error(`Failed to update workflow execution: ${error.message}`);
    }
  }

  /**
   * Create workflow step execution record
   */
  async createStepExecution(stepData: {
    id: string;
    execution_id: string;
    step_id: string;
    step_name: string;
    step_type: string;
    execution_order: number;
    node_id?: string;
    input_data?: any;
  }): Promise<void> {
    
    const { error } = await this.supabase
      .from('workflow_step_executions')
      .insert({
        id: stepData.id,
        execution_id: stepData.execution_id,
        step_id: stepData.step_id,
        step_name: stepData.step_name,
        step_type: stepData.step_type,
        execution_order: stepData.execution_order,
        node_id: stepData.node_id,
        input_data: stepData.input_data,
        status: 'pending'
      });

    if (error) {
      throw new Error(`Failed to create step execution: ${error.message}`);
    }
  }

  /**
   * Update workflow step execution
   */
  async updateStepExecution(
    stepExecutionId: string,
    updates: {
      status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
      output_data?: any;
      error_message?: string;
      end_time?: string;
      retry_count?: number;
    }
  ): Promise<void> {
    
    const { error } = await this.supabase
      .from('workflow_step_executions')
      .update(updates)
      .eq('id', stepExecutionId);

    if (error) {
      throw new Error(`Failed to update step execution: ${error.message}`);
    }
  }

  /**
   * Get workflow execution details
   */
  async getWorkflowExecution(executionId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .select(`
        *,
        workflow_step_executions (
          id,
          step_id,
          step_name,
          step_type,
          status,
          input_data,
          output_data,
          error_message,
          start_time,
          end_time,
          retry_count,
          execution_order
        )
      `)
      .eq('id', executionId)
      .single();

    if (error) {
      throw new Error(`Failed to get workflow execution: ${error.message}`);
    }

    return data;
  }

  /**
   * Get email processing statistics
   */
  async getEmailProcessingStats(venueId: string, dateFrom?: string, dateTo?: string): Promise<any> {
    let query = this.supabase
      .from('email_processing_log')
      .select('processing_status, count(*)', { count: 'exact' })
      .eq('venue_id', venueId);

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get email processing stats: ${error.message}`);
    }

    return data;
  }

  /**
   * Get venue prompts and guardrails using new type-based system
   */
  async getVenuePromptsAndGuardrailsByType(venueId: string): Promise<any> {
    this.logger.debug('Querying venue prompts and guardrails by type', { venue_id: venueId });

    try {
      // Get venue prompts with types
      const { data: promptData, error: promptError } = await this.supabase
        .from('venue_compiled_prompt')
        .select(`
          compiled_prompt,
          checksum,
          template_id,
          prompt_template!inner (
            id,
            type,
            name
          )
        `)
        .eq('venue_id', venueId);

      if (promptError) {
        this.logger.warn(`Venue prompts query failed: ${promptError.message}`, { venue_id: venueId });
      }

      // Get venue guardrails
      const { data: guardrailData, error: guardrailError } = await this.supabase
        .from('venue_guardrail')
        .select(`
          threshold,
          folder_path,
          mark_as_seen,
          guardrail_template!inner (
            type,
            name,
            prompt,
            default_threshold
          )
        `)
        .eq('venue_id', venueId)
        .eq('is_enabled', true);

      if (guardrailError) {
        this.logger.warn(`Venue guardrails query failed: ${guardrailError.message}`, { venue_id: venueId });
      }

      // Process prompts by type - keyed by template.type as objects {prompt, checksum}
      const venuePrompts: Record<string, any> = {};
      if (promptData) {
        promptData.forEach((item: any) => {
          const type = item.prompt_template.type;
          if (type) {
            venuePrompts[type] = {
              prompt: item.compiled_prompt,
              checksum: item.checksum,
              template_id: item.template_id || item.prompt_template.id
            };
          }
        });
      }

      // Process guardrails by type
      const guardrails: Record<string, any> = {};
      if (guardrailData) {
        const groupedByType: Record<string, any[]> = {};
        
        guardrailData.forEach((item: any) => {
          const type = item.guardrail_template.type;
          if (type) {
            if (!groupedByType[type]) {
              groupedByType[type] = [];
            }
            groupedByType[type].push({
              name: item.guardrail_template.name,
              prompt: item.guardrail_template.prompt,
              threshold: item.threshold || item.guardrail_template.default_threshold || 0.7,
              folder_path: item.folder_path,
              mark_as_seen: item.mark_as_seen
            });
          }
        });

        // Convert to the expected format with _guardrails suffix
        Object.keys(groupedByType).forEach(type => {
          guardrails[`${type}_guardrails`] = groupedByType[type];
        });
      }

      this.logger.info('Type-based venue prompts loaded', {
        venue_id: venueId,
        prompt_types: Object.keys(venuePrompts),
        guardrail_types: Object.keys(guardrails),
        prompts_count: Object.keys(venuePrompts).length
      });

      return {
        venue_prompts: venuePrompts,
        guardrails: guardrails
      };

    } catch (error) {
      this.logger.error('Type-based prompts query failed', error, { venue_id: venueId });
      return { venue_prompts: {}, guardrails: {} };
    }
  }

  /**
   * Get venue's assigned workflow for email processing
   */
  async getVenueEmailWorkflow(venueId: string): Promise<string | null> {
    this.logger.debug('Getting venue email workflow', { venue_id: venueId });
    
    const { data, error } = await this.supabase
      .from('venue_to_workflow')
      .select('workflow_id')
      .eq('venue_id', venueId)
      .eq('type', 'email_agent')
      .single();
    
    if (error) {
      this.logger.warn('No email workflow assigned to venue, using default', { venue_id: venueId, error: error.message });
      return '00000000-0000-0000-0000-000000000001'; // Default fallback
    }
    
    return data?.workflow_id || '00000000-0000-0000-0000-000000000001';
  }

  /**
   * Execute raw SQL query (for complex queries)
   */
  async executeQuery(sql: string, params: any[] = []): Promise<any> {
    const { data, error } = await this.supabase.rpc('exec_sql', {
      sql_query: sql,
      params
    });

    if (error) {
      throw new Error(`Query execution failed: ${error.message}`);
    }

    return data;
  }

  /**
   * Get workflow template with nodes and connections
   */
  async getWorkflowTemplate(templateId: string): Promise<any> {
    this.logger.debug('Getting workflow template', { template_id: templateId });

    // Get template details
    const { data: template, error: templateError } = await this.supabase
      .from('workflow_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError) {
      throw new Error(`Failed to get workflow template: ${templateError.message}`);
    }

    // Get nodes
    const { data: nodes, error: nodesError } = await this.supabase
      .from('workflow_nodes')
      .select('*')
      .eq('workflow_template_id', templateId)
      .order('position_x');

    if (nodesError) {
      throw new Error(`Failed to get workflow nodes: ${nodesError.message}`);
    }

    // Get connections
    const { data: connections, error: connectionsError } = await this.supabase
      .from('workflow_connections')
      .select('*')
      .eq('workflow_template_id', templateId)
      .order('created_at');

    if (connectionsError) {
      throw new Error(`Failed to get workflow connections: ${connectionsError.message}`);
    }

    return {
      template,
      nodes: nodes || [],
      connections: connections || []
    };
  }

  /**
   * Get workflow nodes for a template
   */
  async getWorkflowNodes(templateId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('workflow_nodes')
      .select('*')
      .eq('workflow_template_id', templateId)
      .order('position_x');

    if (error) {
      throw new Error(`Failed to get workflow nodes: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get workflow connections for a template
   */
  async getWorkflowConnections(templateId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('workflow_connections')
      .select('*')
      .eq('workflow_template_id', templateId)
      .order('created_at');

    if (error) {
      throw new Error(`Failed to get workflow connections: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get workflow tools for a template
   */
  async getWorkflowTools(templateId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('workflow_tools')
      .select('*')
      .eq('workflow_template_id', templateId)
      .order('position_x');

    if (error) {
      throw new Error(`Failed to get workflow tools: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create workflow execution steps with node mapping only
   * Tools will be added dynamically when executed
   */
  async createWorkflowExecutionSteps(executionId: string, templateId: string, triggerData?: any, pinnedSteps?: Array<{id: string, step_name: string, node_id?: string, output_data: any, step_order: number}>, triggerOutputData?: Record<string, any>): Promise<void> {
    const nodes = await this.getWorkflowNodes(templateId);
    const connections = await this.getWorkflowConnections(templateId);
    
    // Get the workflow execution trigger data if not provided
    if (!triggerData) {
      const { data: execution } = await this.supabase
        .from('workflow_executions')
        .select('trigger_data')
        .eq('id', executionId)
        .single();
      triggerData = execution?.trigger_data;
    }
    
    // Analyze workflow graph to determine which nodes are only reachable via negative paths
    const negativeOnlyNodes = this.findNegativeOnlyNodes(nodes, connections);
    
    // Create steps for nodes only - tools will be added when executed
    const nodeSteps = nodes.map((node, index) => {
      const stepOrder = index + 1;
      
      // Check if this step has pinned data
      const pinnedStep = pinnedSteps?.find(ps => ps.node_id === node.id || ps.step_name === node.name || ps.step_order === stepOrder);
      
      // Determine initial status based on workflow graph analysis
      let initialStatus = 'pending';
      if (negativeOnlyNodes.has(node.id)) {
        // This node is only reachable via negative paths (guardrail failures, error scenarios)
        initialStatus = 'skipped';
      }
      
      const step: any = {
        execution_id: executionId,
        step_order: stepOrder,
        step_type: node.node_type,
        step_name: node.name,
        node_id: node.id,
        status: initialStatus
      };

      // Handle trigger step:
      //   input_data  = raw webhook payload (triggerData)
      //   output_data = venue config wall (triggerOutputData) with all assembled data
      if (node.node_type === 'trigger') {
        step.status = 'completed';
        step.input_data = triggerData || null;
        step.output_data = triggerOutputData || triggerData || null;
        step.started_at = new Date().toISOString();
        step.completed_at = new Date().toISOString();
      }
      
      // Handle pinned steps
      if (pinnedStep) {
        step.status = 'completed';
        step.output_data = pinnedStep.output_data;
        step.output_pinned = true;
        step.started_at = new Date().toISOString();
        step.completed_at = new Date().toISOString();
      }
      
      return step;
    });

    const { error } = await this.supabase
      .from('workflow_execution_steps')
      .insert(nodeSteps);

    if (error) {
      throw new Error(`Failed to create workflow execution steps: ${error.message}`);
    }
  }

  async getTriggerStepOutputData(executionId: string): Promise<Record<string, any> | null> {
    const { data, error } = await this.supabase
      .from('workflow_execution_steps')
      .select('output_data')
      .eq('execution_id', executionId)
      .eq('step_type', 'trigger')
      .single();

    if (error) {
      return null;
    }

    return data?.output_data || null;
  }

  /**
   * Update workflow execution step with input/output and node_id
   */
  async updateWorkflowExecutionStep(
    executionId: string,
    nodeId: string,
    updates: {
      status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
      input_data?: any;
      output_data?: any;
      error_details?: any;
      started_at?: string;
      completed_at?: string;
      finished_at?: string;
      output_confidence_score?: number;
      output_tokens_consumed?: number;
      output_processing_time_ms?: number;
      output_pinned?: boolean;
    }
  ): Promise<void> {
    
    // Avoid overwriting already-cancelled steps
    if (updates.status && updates.status !== 'cancelled') {
      const { data: currentStep, error: fetchError } = await this.supabase
        .from('workflow_execution_steps')
        .select('status')
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)
        .single();

      if (!fetchError && currentStep?.status === 'cancelled') {
        this.logger.info('Skipping step update because execution step is cancelled', {
          execution_id: executionId,
          node_id: nodeId,
          attempted_status: updates.status
        });
        return;
      }
    }

    // Special handling for output_data to preserve field order
    const processedUpdates = { ...updates };
    // Only reorder if this is specifically a business logic output (has steps field)
    if (updates.output_data && updates.output_data.steps !== undefined) {
      // This is a business logic output - ensure field order
      const orderedOutput: any = {};
      
      // Add fields in specific order
      orderedOutput.intent = updates.output_data.intent;
      orderedOutput.action = updates.output_data.action;
      orderedOutput.missing_fields = updates.output_data.missing_fields;
      
      // Order steps by number
      if (updates.output_data.steps && typeof updates.output_data.steps === 'object') {
        const orderedSteps: any = {};
        const stepEntries = Object.entries(updates.output_data.steps);
        stepEntries.sort((a: any, b: any) => {
          const aNum = a[1]?.number || 0;
          const bNum = b[1]?.number || 0;
          return aNum - bNum;
        });
        stepEntries.forEach(([key, value]) => {
          orderedSteps[key] = value;
        });
        orderedOutput.steps = orderedSteps;
      } else {
        orderedOutput.steps = updates.output_data.steps || {};
      }
      
      processedUpdates.output_data = orderedOutput;
    }

    const { error } = await this.supabase
      .from('workflow_execution_steps')
      .update(processedUpdates)
      .eq('execution_id', executionId)
      .eq('node_id', nodeId);

    if (error) {
      throw new Error(`Failed to update workflow execution step: ${error.message}`);
    }
  }

  /**
   * Get workflow execution with steps and node details
   */
  async getWorkflowExecutionWithNodes(executionId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .select(`
        *,
        workflow_execution_steps (
          id,
          step_order,
          step_type,
          step_name,
          node_id,
          status,
          input_data,
          output_data,
          error_details,
          started_at,
          finished_at,
          duration_ms,
          ai_model_used,
          confidence_score,
          tokens_used,
          processing_time_ms,
          ai_call_time_ms,
          db_query_time_ms,
          created_at,
          updated_at
        )
      `)
      .eq('id', executionId)
      .single();

    if (error) {
      throw new Error(`Failed to get workflow execution with nodes: ${error.message}`);
    }

    return data;
  }

  /**
   * Get node ID for a workflow step by execution ID and step name
   */
  async getNodeIdByStepName(executionId: string, stepName: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('workflow_execution_steps')
      .select('node_id')
      .eq('execution_id', executionId)
      .eq('step_name', stepName)
      .single();

    if (error) {
      this.logger.warn(`Could not find node ID for step: ${stepName}`, error);
      return null;
    }

    return data?.node_id || null;
  }

  /**
   * Get workflow node ID by workflow template and node type
   */
  async getWorkflowNodeIdByType(templateId: string, nodeType: string, nodeName?: string): Promise<string | null> {
    let query = this.supabase
      .from('workflow_nodes')
      .select('id')
      .eq('workflow_template_id', templateId)
      .eq('node_type', nodeType)
      .eq('is_active', true);

    if (nodeName) {
      query = query.eq('name', nodeName);
    }

    const { data, error } = await query.single();

    if (error) {
      this.logger.warn(`Could not find node ID for type: ${nodeType}`, error);
      return null;
    }

    return data?.id || null;
  }

  async createGuardrailExecutionSteps(
    executionId: string,
    nodeId: string,
    guardrailResults: Array<{
      guardrail_name: string;
      confidence: number;
      guardrail_threshold: number;
      passed: boolean;
      started_at: string;
      completed_at: string;
      model?: string;
    }>
  ): Promise<void> {
    if (!guardrailResults || guardrailResults.length === 0) return;

    const { data: maxOrder } = await this.supabase
      .from('workflow_execution_steps')
      .select('step_order')
      .eq('execution_id', executionId)
      .order('step_order', { ascending: false })
      .limit(1)
      .single();

    const baseOrder = (maxOrder?.step_order || 0) + 1;

    const steps = guardrailResults.map((result, index) => ({
      execution_id: executionId,
      step_order: baseOrder + index,
      step_type: 'guardrail',
      step_name: result.guardrail_name,
      node_id: nodeId,
      status: 'completed' as const,
      input_data: {
        guardrail_name: result.guardrail_name,
        threshold: result.guardrail_threshold
      },
      output_data: {
        confidence: result.confidence,
        threshold: result.guardrail_threshold,
        passed: result.passed,
        guardrail_name: result.guardrail_name
      },
      started_at: result.started_at,
      completed_at: result.completed_at,
      output_confidence_score: result.confidence
    }));

    const { error } = await this.supabase
      .from('workflow_execution_steps')
      .insert(steps);

    if (error) {
      this.logger.error('Failed to create guardrail execution steps', error);
    }
  }

  async upsertDashboardSession(params: {
    customerEmail: string;
    venueId: string;
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
  }): Promise<{ session_id: string; session_mode: string }> {
    const email = params.customerEmail.toLowerCase().trim();

    const { data: existing, error: findError } = await this.supabase
      .from('dashboardsession')
      .select('id, mode')
      .eq('customeremail', email)
      .order('createdat', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError && findError.code !== 'PGRST116') {
      this.logger.warn('Session lookup failed', { error: findError.message });
    }

    if (existing) {
      const { data: venueLink } = await this.supabase
        .from('sessions_to_venue')
        .select('session_id')
        .eq('session_id', existing.id)
        .eq('venue_id', params.venueId)
        .maybeSingle();

      if (!venueLink) {
        await this.supabase
          .from('sessions_to_venue')
          .insert({ session_id: existing.id, venue_id: params.venueId });
      }

      const updates: Record<string, any> = {};
      if (params.phoneNumber) updates.customerphonenumber = params.phoneNumber;
      if (params.firstName) updates.first_name = params.firstName;
      if (params.lastName) updates.last_name = params.lastName;

      if (Object.keys(updates).length > 0) {
        updates.updatedat = new Date().toISOString();
        await this.supabase
          .from('dashboardsession')
          .update(updates)
          .eq('id', existing.id);
      }

      return { session_id: existing.id, session_mode: existing.mode || 'automatic' };
    }

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.supabase
      .from('dashboardsession')
      .insert({
        id: newId,
        customeremail: email,
        mode: 'automatic',
        first_name: params.firstName || null,
        last_name: params.lastName || null,
        customerphonenumber: params.phoneNumber || null,
        createdat: now,
        updatedat: now,
        unread_messages: 0,
        guest: false
      });

    await this.supabase
      .from('sessions_to_venue')
      .insert({ session_id: newId, venue_id: params.venueId });

    return { session_id: newId, session_mode: 'automatic' };
  }

  async getSessionMode(sessionId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('dashboardsession')
      .select('mode')
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !data) return null;
    return data.mode || 'automatic';
  }

  /**
   * Analyze workflow graph to find nodes that should be initially skipped
   * This includes all nodes that come after guardrails and condition nodes (both positive and negative paths)
   * since we don't know which path will be taken until the node executes
   */
  private findNegativeOnlyNodes(nodes: any[], connections: any[]): Set<string> {
    const nodesToSkip = new Set<string>();
    
    // Find all guardrail nodes
    const guardrailNodes = nodes.filter(node => node.node_type === 'guardrail');
    
    // Find all nodes that come after guardrails (both positive and negative outputs)
    for (const guardrail of guardrailNodes) {
      const outgoingConnections = connections.filter(conn => conn.source_node_id === guardrail.id);
      
      for (const conn of outgoingConnections) {
        // Mark all nodes reachable from guardrails as initially skipped
        this.markNodeAndDescendants(conn.target_node_id, nodes, connections, nodesToSkip);
      }
    }
    
    // Find all condition nodes and mark nodes on BOTH paths as initially skipped
    const conditionNodes = nodes.filter(node => node.node_type === 'condition');
    
    for (const condition of conditionNodes) {
      const outgoingConnections = connections.filter(conn => conn.source_node_id === condition.id);
      
      for (const conn of outgoingConnections) {
        // Mark all nodes reachable from condition nodes as initially skipped
        // They will only be marked as pending when actually queued for execution
        this.markNodeAndDescendants(conn.target_node_id, nodes, connections, nodesToSkip);
      }
    }
    
    // Also mark obviously unreachable nodes
    for (const node of nodes) {
      // Skip trigger nodes as they are the starting point
      if (node.node_type === 'trigger') continue;
      
      // Find all connections that target this node
      const incomingConnections = connections.filter(conn => conn.target_node_id === node.id);
      
      if (incomingConnections.length === 0) {
        // Unreachable nodes should be skipped
        nodesToSkip.add(node.id);
      }
    }
    
    return nodesToSkip;
  }

  /**
   * Recursively mark a node and all its descendants as skipped
   */
  private markNodeAndDescendants(nodeId: string, nodes: any[], connections: any[], nodesToSkip: Set<string>): void {
    if (nodesToSkip.has(nodeId)) return; // Already processed
    
    nodesToSkip.add(nodeId);
    
    // Find all outgoing connections from this node
    const outgoingConnections = connections.filter(conn => conn.source_node_id === nodeId);
    
    for (const conn of outgoingConnections) {
      this.markNodeAndDescendants(conn.target_node_id, nodes, connections, nodesToSkip);
    }
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('organization')
        .select('id')
        .limit(1);

      return !error;
    } catch {
      return false;
    }
  }
}
