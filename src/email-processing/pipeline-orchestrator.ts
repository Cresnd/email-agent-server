/**
 * Email Pipeline Orchestrator
 * Coordinates the email preprocessing flow and applies filtering/guardrails
 */

import { DatabaseQueries } from '../database/queries.ts';
import { Logger } from '../utils/logger.ts';

export interface PreprocessedEmailData {
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
}

export interface VenueConfiguration {
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
    intent_classification?: string;
    data_extraction?: string;
    attachment_analysis?: string;
    business_logic?: string;
    policy_enforcement?: string;
    availability_rules?: string;
    decision_making?: string;
    email_composition?: string;
    confirmation_templates?: string;
    error_handling?: string;
  };
  guardrails: Record<string, Array<{
    name: string;
    prompt: string;
    threshold: number;
    folder_path?: string;
    mark_as_seen?: boolean;
  }>>;
  email_infrastructure: {
    email_account: string;
    smtp_settings: any;
    imap_settings: any;
    folders: any;
  };
  filtering_config: {
    ignored_emails: string[];
    ignored_domains: string[];
    sorting_rules: Array<{
      email_address: string;
      folder_path: string;
      mark_as_seen: boolean;
    }>;
  };
}

export interface FilteringResult {
  continue: boolean;
  reason?: string;
  email_operations?: {
    moved_to_folder?: string;
    marked_as_seen?: boolean;
  };
}

export class EmailPipelineOrchestrator {
  private db: DatabaseQueries;
  private logger: Logger;

  constructor() {
    this.db = new DatabaseQueries();
    this.logger = new Logger('EmailPipelineOrchestrator');
  }

  /**
   * Fetch complete venue configuration including prompts, guardrails, and email infrastructure
   */
  async fetchVenueConfiguration(venueId: string): Promise<VenueConfiguration> {
    try {
      this.logger.debug('Fetching venue configuration', { venue_id: venueId });

      // Phase 2.1: Venue Configuration Query
      const venueConfig = await this.db.getVenueConfiguration(venueId);
      
      // Phase 2.2: Venue & Organization Details Query  
      const venueDetails = await this.db.getVenueAndOrganizationDetails(venueId);
      
      // Phase 2.3: Prompts & Guardrails Query (using new type-based system)
      const promptsAndGuardrails = await this.db.getVenuePromptsAndGuardrailsByType(venueId);

      // Combine all configuration data
      const configuration: VenueConfiguration = {
        venue_settings: {
          venue_id: venueId,
          venue_name: venueDetails.venue_name,
          venue_address: venueDetails.venue_address,
          venue_description: venueDetails.venue_description,
          venue_timezone: venueDetails.venue_timezone,
          organization_id: venueDetails.organization_id,
          organization_name: venueDetails.organization_name,
          finance_email: venueConfig.finance_email
        },
        venue_prompts: this.parseVenuePrompts(promptsAndGuardrails.venue_prompts),
        guardrails: this.parseGuardrails(promptsAndGuardrails.guardrails),
        email_infrastructure: this.parseEmailInfrastructure(venueConfig.email_infrastructure),
        filtering_config: {
          ignored_emails: venueConfig.emails_to_ignore || [],
          ignored_domains: venueConfig.domains_ignore || [],
          sorting_rules: venueConfig.email_sorting_rules || []
        }
      };

      this.logger.info('Venue configuration loaded', {
        venue_id: venueId,
        venue_name: configuration.venue_settings.venue_name,
        prompts_count: Object.keys(configuration.venue_prompts).length,
        guardrails_count: Object.keys(configuration.guardrails).length
      });

      return configuration;

    } catch (error) {
      this.logger.error('Failed to fetch venue configuration', error, { venue_id: venueId });
      throw new Error(`Failed to fetch venue configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Apply email filtering and guardrail validation
   */
  async applyFiltersAndGuardrails(
    emailData: PreprocessedEmailData,
    venueConfig: VenueConfiguration
  ): Promise<FilteringResult> {
    try {
      this.logger.debug('Applying email filters and guardrails', {
        customer_email: emailData.email_content.customer_email,
        subject: emailData.email_content.subject?.substring(0, 50)
      });

      // Phase 3.1: Ignored Addresses Check
      const ignoredCheck = this.checkIgnoredAddresses(
        emailData.email_content.customer_email,
        venueConfig.filtering_config
      );
      
      if (!ignoredCheck.continue) {
        this.logger.info('Email filtered: ignored address/domain', {
          customer_email: emailData.email_content.customer_email,
          reason: ignoredCheck.reason
        });
        return ignoredCheck;
      }

      // Phase 3.2: Email Sorting Rules Check
      const sortingCheck = this.checkSortingRules(
        emailData.email_content.customer_email,
        venueConfig.filtering_config
      );
      
      if (!sortingCheck.continue) {
        this.logger.info('Email sorted to specific folder', {
          customer_email: emailData.email_content.customer_email,
          folder: sortingCheck.email_operations?.moved_to_folder
        });
        return sortingCheck;
      }

      // Phase 4.1: Subject Line Guardrails
      const subjectGuardrails = await this.validateSubjectGuardrails(
        emailData.email_content.subject,
        venueConfig.guardrails
      );
      
      if (!subjectGuardrails.continue) {
        this.logger.info('Email blocked by subject guardrails', {
          subject: emailData.email_content.subject,
          reason: subjectGuardrails.reason
        });
        return subjectGuardrails;
      }

      // Phase 4.2: Pre-Intent Guardrails
      const preIntentGuardrails = await this.validatePreIntentGuardrails(
        emailData.email_content,
        venueConfig.guardrails
      );
      
      if (!preIntentGuardrails.continue) {
        this.logger.info('Email blocked by pre-intent guardrails', {
          subject: emailData.email_content.subject,
          reason: preIntentGuardrails.reason
        });
        return preIntentGuardrails;
      }

      // All checks passed
      this.logger.debug('Email passed all filters and guardrails');
      return { continue: true };

    } catch (error) {
      this.logger.error('Error in filtering/guardrails', error);
      
      // Default to allowing the email through if filtering fails
      return { 
        continue: true, 
        reason: `Filtering error: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * Check if email address or domain should be ignored
   */
  private checkIgnoredAddresses(
    customerEmail: string,
    filteringConfig: VenueConfiguration['filtering_config']
  ): FilteringResult {
    
    // Check ignored email addresses
    if (filteringConfig.ignored_emails.includes(customerEmail.toLowerCase())) {
      return {
        continue: false,
        reason: 'Email address is in ignored list'
      };
    }

    // Check ignored domains
    const emailDomain = customerEmail.split('@')[1]?.toLowerCase();
    if (emailDomain && filteringConfig.ignored_domains.includes(emailDomain)) {
      return {
        continue: false,
        reason: 'Email domain is in ignored list'
      };
    }

    return { continue: true };
  }

  /**
   * Check email sorting rules
   */
  private checkSortingRules(
    customerEmail: string,
    filteringConfig: VenueConfiguration['filtering_config']
  ): FilteringResult {
    
    for (const rule of filteringConfig.sorting_rules) {
      if (rule.email_address.toLowerCase() === customerEmail.toLowerCase()) {
        return {
          continue: false,
          reason: 'Email matched sorting rule',
          email_operations: {
            moved_to_folder: rule.folder_path,
            marked_as_seen: rule.mark_as_seen
          }
        };
      }
    }

    return { continue: true };
  }

  /**
   * Validate subject line against guardrails
   */
  private async validateSubjectGuardrails(
    subject: string,
    guardrails: VenueConfiguration['guardrails']
  ): Promise<FilteringResult> {
    
    if (!guardrails.parsing_guardrails) {
      return { continue: true };
    }

    // Filter for subject line guardrails
    const subjectGuardrails = guardrails.parsing_guardrails.filter(g => 
      g.name.toLowerCase().includes('subject')
    );

    for (const guardrail of subjectGuardrails) {
      try {
        const confidence = await this.evaluateGuardrail(subject, guardrail.prompt);
        
        if (confidence >= guardrail.threshold) {
          return {
            continue: false,
            reason: `Subject line guardrail triggered: ${guardrail.name} (confidence: ${confidence})`
          };
        }
      } catch (error) {
        this.logger.warn('Guardrail evaluation failed', error, { guardrail: guardrail.name });
        // Continue if guardrail evaluation fails
      }
    }

    return { continue: true };
  }

  /**
   * Validate email content against pre-intent guardrails
   */
  private async validatePreIntentGuardrails(
    emailContent: PreprocessedEmailData['email_content'],
    guardrails: VenueConfiguration['guardrails']
  ): Promise<FilteringResult> {
    
    if (!guardrails.parsing_guardrails) {
      return { continue: true };
    }

    // Filter for pre-intent guardrails
    const preIntentGuardrails = guardrails.parsing_guardrails.filter(g => 
      g.name.toLowerCase().includes('pre_intent') || g.name.toLowerCase().includes('content')
    );

    const fullContent = `Subject: ${emailContent.subject}\n\nMessage: ${emailContent.message_for_ai}`;

    for (const guardrail of preIntentGuardrails) {
      try {
        const confidence = await this.evaluateGuardrail(fullContent, guardrail.prompt);
        
        if (confidence >= guardrail.threshold) {
          return {
            continue: false,
            reason: `Pre-intent guardrail triggered: ${guardrail.name} (confidence: ${confidence})`
          };
        }
      } catch (error) {
        this.logger.warn('Guardrail evaluation failed', error, { guardrail: guardrail.name });
        // Continue if guardrail evaluation fails
      }
    }

    return { continue: true };
  }

  /**
   * Evaluate a guardrail using AI
   */
  private async evaluateGuardrail(content: string, guardrailPrompt: string): Promise<number> {
    try {
      // TODO: Implement AI guardrail evaluation
      // This would call OpenAI/Anthropic with the guardrail prompt
      // For now, return a low confidence to allow emails through
      
      this.logger.debug('Evaluating guardrail', { 
        content_length: content.length,
        prompt_length: guardrailPrompt.length
      });

      // Placeholder - return random low confidence
      return Math.random() * 0.3; // 0-0.3 range to usually pass

    } catch (error) {
      this.logger.warn('Guardrail AI evaluation failed', error);
      return 0; // Default to allow on failure
    }
  }

  // Utility methods for parsing configuration data

  private parseVenuePrompts(promptsData: any): VenueConfiguration['venue_prompts'] {
    if (!promptsData || typeof promptsData !== 'object') {
      return {};
    }

    // New type-based structure - promptsData is now keyed by prompt_template.type
    return {
      intent_classification: promptsData.intent_classification,
      data_extraction: promptsData.data_extraction,
      attachment_analysis: promptsData.attachment_analysis,
      business_logic: promptsData.business_logic,
      policy_enforcement: promptsData.policy_enforcement,
      availability_rules: promptsData.availability_rules,
      decision_making: promptsData.decision_making,
      email_composition: promptsData.email_composition,
      confirmation_templates: promptsData.confirmation_templates,
      error_handling: promptsData.error_handling,
      
      // New agent system prompt types
      parser: promptsData.parser,
      make_booking: promptsData.make_booking,
      edit_booking: promptsData.edit_booking,
      cancel_booking: promptsData.cancel_booking,
      find_booking: promptsData.find_booking,
      
      // Legacy support for backward compatibility
      email_extractor: promptsData.parser || promptsData.email_extractor,
      orchestrator: promptsData.business_logic || promptsData.orchestrator,
      execution: promptsData.make_booking || promptsData.execution
    };
  }

  private parseGuardrails(guardrailsData: any): VenueConfiguration['guardrails'] {
    if (!guardrailsData || typeof guardrailsData !== 'object') {
      return {};
    }

    return guardrailsData;
  }

  private parseEmailInfrastructure(infraData: any): VenueConfiguration['email_infrastructure'] {
    if (!infraData || typeof infraData !== 'object') {
      return {
        email_account: '',
        smtp_settings: {},
        imap_settings: {},
        folders: {}
      };
    }

    return {
      email_account: infraData.email_account || '',
      smtp_settings: infraData.smtp_settings || {},
      imap_settings: infraData.imap_settings || {},
      folders: infraData.folders || {}
    };
  }
}
