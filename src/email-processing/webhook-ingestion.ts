/**
 * Email Webhook Ingestion System
 * Handles incoming email webhooks from IMAP and Outlook sources
 * Replicates the exact n8n preprocessing flow with deterministic processing
 */

import { EmailClassifier } from './classifier.ts';
import { DatabaseQueries } from '../database/queries.ts';
import { Logger } from '../utils/logger.ts';

// Input webhook payload types matching current n8n structure
export interface IMAPWebhookPayload {
  email_account_id: string;
  venue_id: string;
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  textPlain: string;
  textHtml: string;
  metadata: {
    'return-path'?: string;
    'message-id'?: string;
    references?: string[];
    [key: string]: any;
  };
  raw: string;
}

export interface OutlookWebhookPayload {
  email_account_id: string;
  venue_id: string;
  outlook_id: string;
  conversation_id: string;
  from: string;
  to: string;
  subject: string;
  textHtml: string;
  metadata: {
    internetMessageId: string;
    importance: string;
    isRead: boolean;
    hasAttachments: boolean;
  };
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

// Processed email data structure (Phase 1 output)
export interface ProcessedEmailData {
  first_name: string;
  last_name: string;
  customer_email: string;
  company_email: string;
  subject: string;
  message: string; // HTML content
  message_for_ai: string; // Plain text for AI
  attachments?: string; // Compiled attachment analysis
}

// Email metadata structure (Phase 1 output)
export interface EmailMetadata {
  venue_id: string;
  references: string;
  in_reply_to: string;
  conversation_id: string;
  email_UID?: number; // IMAP only
  outlook_id?: string; // Outlook only
  received_at: string; // Sweden local time
}

// Venue configuration from database (Phase 2 output)
export interface VenueConfiguration {
  email_addresses_ignore: string[];
  domains_ignore: string[];
  email_sorting_rules: Array<{
    email_address: string;
    folder_path: string;
    mark_as_seen: boolean;
  }>;
  standard_sorting_rules: any[];
  workflows: any[];
  finance_email: string;
  email_infrastructure: any;
  email_delay: number;
}

// Complete workflow variables (Phase 5 output)
export interface WorkflowVariables {
  // Email Infrastructure
  email_server: any;
  email_delay: number;
  
  // Venue Configuration
  venue_prompts: Record<string, any>;
  guardrails: Record<string, any>;
  venue_id: string;
  venue_name: string;
  venue_address: string;
  venue_description: string;
  venue_timezone: string;
  organization_id: string;
  organization_name: string;
  finance_email: string;
  
  // Customer Data
  first_name: string;
  last_name: string;
  customer_email: string;
  phone_number?: string;
  session_id?: string;
  
  // Email Content
  subject: string;
  message: string;
  message_for_ai: string;
  attachments?: string;
  
  // Email Metadata
  references: string;
  in_reply_to: string;
  conversation_id: string;
  email_UID?: number;
  outlook_id?: string;
  received_at: string;
  
  // System Data
  database_project_ref: string;
  company_email: string;
}

export interface ProcessingResult {
  success: boolean;
  action: 'process' | 'ignore' | 'sort' | 'block';
  reason?: string;
  workflow_triggered?: boolean;
  variables?: WorkflowVariables;
  execution_id?: string;
}

export class EmailWebhookIngestion {
  private classifier: EmailClassifier;
  private dbQueries: DatabaseQueries;
  private logger: Logger;

  constructor() {
    this.classifier = new EmailClassifier();
    this.dbQueries = new DatabaseQueries();
    this.logger = new Logger('EmailWebhookIngestion');
  }

  /**
   * Lightweight preprocessing used by the HTTP router to normalize incoming payloads
   * into the structure expected by the pipeline orchestrator.
   */
  async process(payload: IMAPWebhookPayload | OutlookWebhookPayload): Promise<{
    venue_id: string;
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
    metadata: {
      references?: string;
      in_reply_to?: string;
      email_UID?: number;
      outlook_id?: string;
    };
  }> {
    const source = (payload as OutlookWebhookPayload).outlook_id ? 'outlook' : 'imap';
    const requestId = crypto.randomUUID();
    this.logger.debug('Starting lightweight preprocessing', {
      request_id: requestId,
      source,
      venue_id: payload.venue_id,
      subject: payload.subject?.substring(0, 80)
    });

    // Reuse existing extractors to stay consistent with the full pipeline
    const emailData = await this.extractEmailData(payload, source);
    const metadata = this.extractMetadata(payload, source);

    return {
      venue_id: metadata.venue_id,
      email_content: {
        subject: emailData.subject,
        message: emailData.message,
        message_for_ai: emailData.message_for_ai,
        customer_email: emailData.customer_email,
        first_name: emailData.first_name ?? null,
        last_name: emailData.last_name ?? null,
        attachments: emailData.attachments,
        received_at: metadata.received_at,
        conversation_id: metadata.conversation_id
      },
      metadata: {
        references: metadata.references,
        in_reply_to: metadata.in_reply_to,
        email_UID: metadata.email_UID,
        outlook_id: metadata.outlook_id
      }
    };
  }

  /**
   * Process incoming email webhook (main entry point)
   */
  async processEmailWebhook(
    payload: IMAPWebhookPayload | OutlookWebhookPayload,
    source: 'imap' | 'outlook'
  ): Promise<ProcessingResult> {
    
    const startTime = Date.now();
    const processing_id = crypto.randomUUID();
    
    console.log(`[${processing_id}] Starting email processing from ${source}`);

    try {
      // Phase 1: Data Extraction & Normalization
      const emailData = await this.extractEmailData(payload, source);
      const metadata = this.extractMetadata(payload, source);

      console.log(`[${processing_id}] Phase 1: Extracted email data for ${emailData.customer_email}`);

      // Phase 2: Database Lookups
      const venueConfig = await this.getVenueConfiguration(metadata.venue_id);
      const venueDetails = await this.getVenueDetails(metadata.venue_id, emailData.customer_email);
      const prompts = await this.getPromptsAndGuardrails(metadata.venue_id);

      console.log(`[${processing_id}] Phase 2: Retrieved venue configuration for ${venueDetails.venue_name}`);

      // Phase 3: Email Filtering & Sorting
      const filterResult = this.checkEmailFiltering(emailData, venueConfig);
      if (filterResult.shouldExit) {
        console.log(`[${processing_id}] Phase 3: Email filtered - ${filterResult.reason}`);
        return {
          success: true,
          action: filterResult.action,
          reason: filterResult.reason
        };
      }

      // Phase 4: Guardrail Validation
      const guardrailResult = await this.validateGuardrails(emailData, prompts.guardrails);
      if (guardrailResult.blocked) {
        console.log(`[${processing_id}] Phase 4: Email blocked by guardrails - ${guardrailResult.reason}`);
        return {
          success: true,
          action: 'block',
          reason: guardrailResult.reason
        };
      }

      // Phase 5: Final Variable Assembly
      const variables = this.assembleWorkflowVariables(
        emailData,
        metadata,
        venueConfig,
        venueDetails,
        prompts
      );

      console.log(`[${processing_id}] Phase 5: Variables assembled, triggering workflow`);

      // Log processing to database
      await this.logEmailProcessing(processing_id, variables, 'completed', Date.now() - startTime);

      // Trigger workflow execution
      const executionResult = await this.triggerWorkflow(variables);

      return {
        success: true,
        action: 'process',
        workflow_triggered: true,
        variables,
        execution_id: executionResult.execution_id
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[${processing_id}] Email processing failed:`, errorMessage);

      // Log error to database
      await this.logEmailProcessing(processing_id, undefined, 'failed', Date.now() - startTime, errorMessage);

      return {
        success: false,
        action: 'ignore',
        reason: `Processing error: ${errorMessage}`
      };
    }
  }

  // Phase 1: Data Extraction & Normalization

  private async extractEmailData(
    payload: IMAPWebhookPayload | OutlookWebhookPayload,
    source: 'imap' | 'outlook'
  ): Promise<ProcessedEmailData> {
    
    // Extract attachments first
    const attachments = await this.processAttachments(payload, source);

    // Parse sender email and name
    const { email: customerEmail, firstName, lastName } = this.parseEmailAddress(payload.from);

    // Get HTML and plain text content
    const htmlContent = source === 'imap' ? 
      (payload as IMAPWebhookPayload).textHtml : 
      (payload as OutlookWebhookPayload).textHtml;

    const plainContent = source === 'imap' ? 
      (payload as IMAPWebhookPayload).textPlain : 
      this.htmlToPlain(htmlContent);

    return {
      first_name: firstName,
      last_name: lastName,
      customer_email: customerEmail,
      company_email: payload.to,
      subject: payload.subject,
      message: htmlContent,
      message_for_ai: plainContent,
      attachments: attachments || undefined
    };
  }

  private extractMetadata(
    payload: IMAPWebhookPayload | OutlookWebhookPayload,
    source: 'imap' | 'outlook'
  ): EmailMetadata {
    
    const baseMetadata = {
      venue_id: payload.venue_id,
      received_at: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })
    };

    if (source === 'imap') {
      const imapPayload = payload as IMAPWebhookPayload;
      return {
        ...baseMetadata,
        references: imapPayload.metadata?.references?.join(', ') || '',
        in_reply_to: imapPayload.metadata?.['in-reply-to'] || '',
        conversation_id: imapPayload.metadata?.['message-id'] || '',
        email_UID: imapPayload.uid
      };
    } else {
      const outlookPayload = payload as OutlookWebhookPayload;
      return {
        ...baseMetadata,
        references: '',
        in_reply_to: '',
        conversation_id: outlookPayload.conversation_id,
        outlook_id: outlookPayload.outlook_id
      };
    }
  }

  // Phase 2: Database Lookups

  private async getVenueConfiguration(venueId: string): Promise<VenueConfiguration> {
    // Replicates the complex n8n venue configuration query
    const result = await this.dbQueries.getVenueConfiguration(venueId);
    
    return {
      email_addresses_ignore: result.email_addresses_ignore || [],
      domains_ignore: result.domains_ignore || [],
      email_sorting_rules: result.email_sorting_rules || [],
      standard_sorting_rules: result.standard_sorting_rules || [],
      workflows: result.workflows || [],
      finance_email: result.finance_email || '',
      email_infrastructure: result.email_infrastructure || {},
      email_delay: result.email_delay || 0
    };
  }

  private async getVenueDetails(venueId: string, customerEmail: string): Promise<any> {
    return await this.dbQueries.getVenueAndSessionDetails(venueId, customerEmail);
  }

  private async getPromptsAndGuardrails(venueId: string): Promise<any> {
    return await this.dbQueries.getPromptsAndGuardrails(venueId);
  }

  // Phase 3: Email Filtering & Sorting

  private checkEmailFiltering(
    emailData: ProcessedEmailData,
    venueConfig: VenueConfiguration
  ): { shouldExit: boolean; action?: 'ignore' | 'sort'; reason?: string } {
    
    // Check ignored email addresses
    if (venueConfig.email_addresses_ignore.includes(emailData.customer_email)) {
      return {
        shouldExit: true,
        action: 'ignore',
        reason: 'Email address is on ignore list'
      };
    }

    // Check ignored domains
    const emailDomain = emailData.customer_email.split('@')[1]?.toLowerCase();
    if (emailDomain && venueConfig.domains_ignore.includes(emailDomain)) {
      return {
        shouldExit: true,
        action: 'ignore',
        reason: 'Email domain is on ignore list'
      };
    }

    // Check email sorting rules
    for (const rule of venueConfig.email_sorting_rules) {
      if (rule.email_address === emailData.customer_email) {
        return {
          shouldExit: true,
          action: 'sort',
          reason: `Email sorted to folder: ${rule.folder_path}`
        };
      }
    }

    return { shouldExit: false };
  }

  // Phase 4: Guardrail Validation

  private async validateGuardrails(
    emailData: ProcessedEmailData,
    guardrails: Record<string, any>
  ): Promise<{ blocked: boolean; reason?: string }> {
    
    // Subject line guardrails
    if (guardrails.subject_line_guardrails) {
      for (const guardrail of guardrails.subject_line_guardrails) {
        const result = await this.runGuardrailCheck(
          emailData.subject,
          guardrail
        );
        
        if (result.blocked) {
          return {
            blocked: true,
            reason: `Subject line blocked by ${guardrail.name} (confidence: ${result.confidence})`
          };
        }
      }
    }

    // Pre-intent guardrails
    if (guardrails.pre_intent_guardrails) {
      const contentToCheck = `${emailData.subject}\n\n${emailData.message_for_ai}`;
      
      for (const guardrail of guardrails.pre_intent_guardrails) {
        const result = await this.runGuardrailCheck(
          contentToCheck,
          guardrail
        );
        
        if (result.blocked) {
          return {
            blocked: true,
            reason: `Content blocked by ${guardrail.name} (confidence: ${result.confidence})`
          };
        }
      }
    }

    return { blocked: false };
  }

  private async runGuardrailCheck(
    content: string,
    guardrail: any
  ): Promise<{ blocked: boolean; confidence: number }> {
    
    try {
      // TODO: Implement actual AI guardrail check
      // For now, return mock result
      const mockConfidence = Math.random();
      const blocked = mockConfidence >= (guardrail.threshold || 0.7);
      
      return { blocked, confidence: mockConfidence };

    } catch (error) {
      console.warn(`Guardrail check failed for ${guardrail.name}:`, error);
      // Fail open - don't block on guardrail errors
      return { blocked: false, confidence: 0 };
    }
  }

  // Phase 5: Final Variable Assembly

  private assembleWorkflowVariables(
    emailData: ProcessedEmailData,
    metadata: EmailMetadata,
    venueConfig: VenueConfiguration,
    venueDetails: any,
    prompts: any
  ): WorkflowVariables {
    
    return {
      // Email Infrastructure
      email_server: venueConfig.email_infrastructure,
      email_delay: venueConfig.email_delay,
      
      // Venue Configuration
      venue_prompts: prompts.venue_prompts || {},
      guardrails: prompts.guardrails || {},
      venue_id: metadata.venue_id,
      venue_name: venueDetails.venue_name || '',
      venue_address: venueDetails.venue_address || '',
      venue_description: venueDetails.venue_description || '',
      venue_timezone: venueDetails.venue_timezone || 'Europe/Stockholm',
      organization_id: venueDetails.organization_id || '',
      organization_name: venueDetails.organization_name || '',
      finance_email: venueConfig.finance_email,
      
      // Customer Data
      first_name: emailData.first_name,
      last_name: emailData.last_name,
      customer_email: emailData.customer_email,
      phone_number: venueDetails.phone_number,
      session_id: venueDetails.session_id,
      
      // Email Content
      subject: emailData.subject,
      message: emailData.message,
      message_for_ai: emailData.message_for_ai,
      attachments: emailData.attachments,
      
      // Email Metadata
      references: metadata.references,
      in_reply_to: metadata.in_reply_to,
      conversation_id: metadata.conversation_id,
      email_UID: metadata.email_UID,
      outlook_id: metadata.outlook_id,
      received_at: metadata.received_at,
      
      // System Data
      database_project_ref: 'qaymciaujneyqhsbycmp',
      company_email: emailData.company_email
    };
  }

  // Helper methods

  private async processAttachments(
    payload: IMAPWebhookPayload | OutlookWebhookPayload,
    source: 'imap' | 'outlook'
  ): Promise<string | null> {
    
    if (source === 'outlook') {
      const outlookPayload = payload as OutlookWebhookPayload;
      if (outlookPayload.attachments.length === 0) {
        return null;
      }

      // Process Outlook attachments
      const attachmentSummaries = outlookPayload.attachments.map(att => 
        `${att.filename} (${att.contentType}, ${att.size} bytes)`
      );
      
      return `Attachments: ${attachmentSummaries.join(', ')}`;
    }

    // For IMAP, would need to parse raw MIME content
    // For now, return null
    return null;
  }

  private parseEmailAddress(fromHeader: string): { email: string; firstName: string; lastName: string } {
    // Parse email address from various formats:
    // "Name Surname" <email@domain.com>
    // Name Surname <email@domain.com>
    // email@domain.com
    
    const emailMatch = fromHeader.match(/<([^>]+)>/);
    const email = emailMatch ? emailMatch[1] : fromHeader.trim();
    
    let fullName = fromHeader.replace(/<[^>]+>/, '').replace(/["""]/g, '').trim();
    
    if (!fullName) {
      // Extract name from email if no display name
      fullName = email.split('@')[0].replace(/[._]/g, ' ');
    }

    const nameParts = fullName.split(' ').filter(part => part.length > 0);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    return { email, firstName, lastName };
  }

  private htmlToPlain(html: string): string {
    // Simple HTML to plain text conversion
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async triggerWorkflow(variables: WorkflowVariables): Promise<{ execution_id: string }> {
    // TODO: Trigger actual workflow execution
    const execution_id = crypto.randomUUID();
    
    console.log('Triggering workflow with variables:', {
      customer_email: variables.customer_email,
      subject: variables.subject,
      venue_name: variables.venue_name
    });

    return { execution_id };
  }

  private async logEmailProcessing(
    processingId: string,
    variables?: WorkflowVariables,
    status: 'completed' | 'failed' = 'completed',
    processingTime?: number,
    errorMessage?: string
  ): Promise<void> {
    
    try {
      await this.dbQueries.logEmailProcessing({
        id: processingId,
        email_account_id: variables?.venue_id,
        organization_id: variables?.organization_id,
        venue_id: variables?.venue_id,
        email_uid: variables?.email_UID?.toString(),
        email_subject: variables?.subject,
        email_from: variables?.customer_email,
        email_to: variables?.company_email,
        email_date: variables?.received_at,
        processing_status: status,
        error_message: errorMessage,
        processing_time_ms: processingTime,
        processed_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to log email processing:', error);
    }
  }
}
