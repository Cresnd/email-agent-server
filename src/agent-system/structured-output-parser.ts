/**
 * Structured Output Parser for Business Logic Agents
 * Converts the raw business logic agent output to a standardized format
 * Similar to the n8n structured output parser functionality
 */

export interface StructuredOutput {
  intent: string;
  action: string;
  missing_fields: string[];
  steps: Step[];
}

export interface Step {
  number: number;
  tool: string;
  args: Record<string, any>;
}

export interface StructuredOutputParserConfig {
  jsonSchemaExample: string;
  autoFix?: boolean;
}

export class StructuredOutputParser {
  private config: StructuredOutputParserConfig;

  constructor(config: StructuredOutputParserConfig) {
    this.config = config;
  }

  /**
   * Parse the business logic agent output and convert to structured format
   */
  async parse(businessLogicOutput: any): Promise<StructuredOutput> {
    try {
      // Check if the business logic output already contains structured output
      if (businessLogicOutput._structured_output) {
        return this.validateAndFixStructure(businessLogicOutput._structured_output);
      }

      // If no structured output, create one from the legacy format
      return this.convertLegacyOutput(businessLogicOutput);

    } catch (error) {
      console.error('Error parsing structured output:', error);
      
      // Return fallback structure
      return {
        intent: "unknown",
        action: "escalate", 
        missing_fields: ["parsing_error"],
        steps: []
      };
    }
  }

  /**
   * Convert legacy business logic output to new structured format
   */
  private convertLegacyOutput(output: any): StructuredOutput {
    const actionType = output.decision?.action_type || output.action_type || 'answer_question';
    const extraction = output.refined_extraction || {};

    const structuredOutput: StructuredOutput = {
      intent: extraction.intent || this.mapActionToIntent(actionType),
      action: actionType,
      missing_fields: this.identifyMissingFields(extraction, actionType),
      steps: this.generateStepsFromAction(actionType, extraction)
    };

    return structuredOutput;
  }

  /**
   * Validate and optionally auto-fix the structured output
   */
  private validateAndFixStructure(structuredOutput: any): StructuredOutput {
    const result: StructuredOutput = {
      intent: structuredOutput.intent || "unknown",
      action: structuredOutput.action || "answer_question",
      missing_fields: Array.isArray(structuredOutput.missing_fields) ? structuredOutput.missing_fields : [],
      steps: Array.isArray(structuredOutput.steps) ? structuredOutput.steps : []
    };

    // Auto-fix if enabled
    if (this.config.autoFix) {
      result.steps = this.fixStepsStructure(result.steps);
    }

    return result;
  }

  /**
   * Map action types to intents for legacy compatibility
   */
  private mapActionToIntent(actionType: string): string {
    const intentMap: Record<string, string> = {
      'make_booking': 'make_booking',
      'edit_booking': 'edit_booking', 
      'cancel_booking': 'cancel_booking',
      'find_booking': 'find_booking',
      'answer_question': 'general_question',
      'request_info': 'request_info',
      'escalate': 'escalate'
    };

    return intentMap[actionType] || 'general_question';
  }

  /**
   * Identify missing required fields based on action type
   */
  private identifyMissingFields(extraction: any, actionType: string): string[] {
    const missingFields: string[] = [];

    if (actionType === 'make_booking') {
      const requiredFields = ['first_name', 'last_name', 'phone_number', 'email', 'date', 'guest_count'];
      
      for (const field of requiredFields) {
        if (!extraction[field] || extraction[field] === '' || extraction[field] === null) {
          missingFields.push(field);
        }
      }
    }

    if (actionType === 'edit_booking' || actionType === 'cancel_booking') {
      if (!extraction.bookingref || extraction.bookingref === '') {
        missingFields.push('bookingref');
      }
    }

    return missingFields;
  }

  /**
   * Generate execution steps based on action type and extraction data
   */
  private generateStepsFromAction(actionType: string, extraction: any): Step[] {
    const steps: Step[] = [];

    switch (actionType) {
      case 'make_booking':
        // Step 1: Check availability
        steps.push({
          number: 1,
          tool: 'get_availability',
          args: {
            date: extraction.date || '',
            guest_count: extraction.guest_count || '',
            requests: extraction.requests || []
          }
        });

        // Step 2: Make booking (only if no missing fields)
        if (extraction.first_name && extraction.last_name && extraction.phone_number) {
          steps.push({
            number: 2,
            tool: 'make_booking',
            args: {
              first_name: extraction.first_name || '',
              last_name: extraction.last_name || '',
              phone_number: extraction.phone_number || '',
              email: extraction.email || '',
              date: extraction.date || '',
              guest_count: extraction.guest_count || '',
              requests: extraction.requests || [],
              comment: extraction.comment || '',
              waitlist: extraction.waitlist || false
            }
          });
        }
        break;

      case 'edit_booking':
        steps.push({
          number: 1,
          tool: 'find_booking',
          args: {
            bookingref: extraction.bookingref || '',
            email: extraction.email || '',
            phone_number: extraction.phone_number || ''
          }
        });

        steps.push({
          number: 2,
          tool: 'update_booking',
          args: {
            bookingref: extraction.bookingref || '',
            date: extraction.date || '',
            guest_count: extraction.guest_count || '',
            requests: extraction.requests || [],
            comment: extraction.comment || ''
          }
        });
        break;

      case 'cancel_booking':
        steps.push({
          number: 1,
          tool: 'find_booking',
          args: {
            bookingref: extraction.bookingref || '',
            email: extraction.email || '',
            phone_number: extraction.phone_number || ''
          }
        });

        steps.push({
          number: 2,
          tool: 'cancel_booking',
          args: {
            bookingref: extraction.bookingref || '',
            reason: extraction.comment || ''
          }
        });
        break;

      case 'find_booking':
        steps.push({
          number: 1,
          tool: 'search_bookings',
          args: {
            bookingref: extraction.bookingref || '',
            email: extraction.email || '',
            phone_number: extraction.phone_number || '',
            date: extraction.date || '',
            first_name: extraction.first_name || '',
            last_name: extraction.last_name || ''
          }
        });
        break;

      case 'answer_question':
        steps.push({
          number: 1,
          tool: 'generate_response',
          args: {
            query: extraction.message_for_ai || extraction.description || '',
            context: {
              venue_info: true,
              booking_policies: true
            }
          }
        });
        break;

      case 'request_info':
        steps.push({
          number: 1,
          tool: 'request_additional_info',
          args: {
            missing_fields: this.identifyMissingFields(extraction, actionType),
            context: extraction.description || ''
          }
        });
        break;

      case 'escalate':
        steps.push({
          number: 1,
          tool: 'escalate_to_human',
          args: {
            reason: extraction.description || 'Manual review required',
            priority: 'medium'
          }
        });
        break;
    }

    return steps;
  }

  /**
   * Fix and validate steps structure for auto-fix functionality
   */
  private fixStepsStructure(steps: any[]): Step[] {
    return steps.map((step, index) => ({
      number: step.number || index + 1,
      tool: step.tool || 'unknown_tool',
      args: step.args || {}
    }));
  }

  /**
   * Create a parser instance with the default schema
   */
  static createDefault(): StructuredOutputParser {
    const defaultSchema = {
      "intent": "make_booking",
      "action": "make_booking", 
      "missing_fields": [],
      "steps": [
        {
          "number": 1,
          "tool": "get_availability",
          "args": {
            "date": "...",
            "guest_count": "...",
            "requests": "..."
          }
        },
        {
          "number": 2,
          "tool": "make_booking",
          "args": {
            "first_name": "...",
            "last_name": "...",
            "phone_number": "...",
            "email": "...",
            "date": "...",
            "guest_count": "...",
            "requests": "...",
            "comment": "...",
            "waitlist": false
          }
        }
      ]
    };

    return new StructuredOutputParser({
      jsonSchemaExample: JSON.stringify(defaultSchema, null, 2),
      autoFix: true
    });
  }

  /**
   * Get the schema example for AI prompts
   */
  getSchemaExample(): string {
    return this.config.jsonSchemaExample;
  }
}