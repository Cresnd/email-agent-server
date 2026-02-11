/**
 * Structured Output Parser for Business Logic Agents
 * Converts the raw business logic agent output to a standardized format
 * Similar to the n8n structured output parser functionality
 */

export interface StructuredOutput {
  intent: string;
  action: string;
  missing_fields: string[];
  steps: Record<string, Step>;
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
    const extraction = this.normalizeExtraction(output.refined_extraction || {});

    const steps = this.generateStepsFromAction(actionType, extraction);
    const orderedSteps = this.orderStepsByNumber(steps);

    const structuredOutput: StructuredOutput = {
      intent: extraction.intent || this.mapActionToIntent(actionType),
      action: actionType,
      missing_fields: this.identifyMissingFields(extraction, actionType),
      steps: orderedSteps
    };

    return structuredOutput;
  }

  /**
   * Validate and optionally auto-fix the structured output
   */
  private validateAndFixStructure(structuredOutput: any): StructuredOutput {
    let steps = (typeof structuredOutput.steps === 'object' && structuredOutput.steps !== null) ? structuredOutput.steps : {};
    
    // Auto-fix if enabled
    if (this.config.autoFix && typeof steps === 'object') {
      steps = this.fixStepsStructure(steps);
    }

    // Order steps by number
    const orderedSteps = this.orderStepsByNumber(steps);

    const result: StructuredOutput = {
      intent: structuredOutput.intent || "unknown",
      action: structuredOutput.action || "answer_question",
      missing_fields: Array.isArray(structuredOutput.missing_fields) ? structuredOutput.missing_fields : [],
      steps: orderedSteps
    };

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
    const normalized = this.normalizeExtraction(extraction);
    const missingFields: string[] = [];

    if (actionType === 'make_booking') {
      const requiredFields = ['first_name', 'last_name', 'phone_number', 'email', 'date', 'guest_count'];
      
      for (const field of requiredFields) {
        if (!normalized[field] || normalized[field] === '' || normalized[field] === null) {
          missingFields.push(field);
        }
      }
    }

    if (actionType === 'edit_booking' || actionType === 'cancel_booking') {
      if (!normalized.bookingref || normalized.bookingref === '') {
        missingFields.push('bookingref');
      }
    }

    return missingFields;
  }

  /**
   * Generate execution steps based on action type and extraction data
   */
  private generateStepsFromAction(actionType: string, extraction: any): Record<string, Step> {
    const normalized = this.normalizeExtraction(extraction);
    const steps: any = {};

    switch (actionType) {
      case 'make_booking':
        // Step 1: Check availability
        steps.get_availability = {
          number: 1,
          tool: 'get_availability',
          args: {
            date: normalized.date || '',
            guests: normalized.guest_count || 2,
            requests: normalized.requests || []
          }
        };

        // Step 2: Make booking (only if no missing fields)
        if (normalized.first_name && normalized.last_name && normalized.phone_number) {
          steps.make_booking = {
            number: 2,
            tool: 'make_booking',
            args: {
              firstName: normalized.first_name || '',
              lastName: normalized.last_name || '',
              phone: normalized.phone_number || '',
              email: normalized.email || '',
              requests: normalized.requests || [],
              message: normalized.comment || '',
              waitlist: normalized.waitlist || false
            }
          };
        }
        return steps;
        break;

      case 'edit_booking':
        steps.find_booking = {
          number: 1,
          tool: 'find_booking',
          args: {
            bookingref: normalized.bookingref || '',
            email: normalized.email || '',
            phone: normalized.phone_number || '',
            firstName: normalized.first_name || '',
            lastName: normalized.last_name || ''
          }
        };

        steps.update_booking = {
          number: 2,
          tool: 'update_booking',
          args: {
            bookingref: normalized.bookingref || '',
            date: normalized.date || '',
            guests: normalized.guest_count || '',
            requests: normalized.requests || [],
            message: normalized.comment || ''
          }
        };
        return steps;
        break;

      case 'cancel_booking':
        steps.find_booking = {
          number: 1,
          tool: 'find_booking',
          args: {
            bookingref: normalized.bookingref || '',
            email: normalized.email || '',
            phone: normalized.phone_number || '',
            firstName: normalized.first_name || '',
            lastName: normalized.last_name || ''
          }
        };

        steps.cancel_booking = {
          number: 2,
          tool: 'cancel_booking',
          args: {
            bookingref: normalized.bookingref || '',
            reason: normalized.comment || ''
          }
        };
        return steps;
        break;

      case 'find_booking':
        steps.search_bookings = {
          number: 1,
          tool: 'search_bookings',
          args: {
            bookingref: normalized.bookingref || '',
            email: normalized.email || '',
            phone: normalized.phone_number || '',
            date: normalized.date || '',
            firstName: normalized.first_name || '',
            lastName: normalized.last_name || ''
          }
        };
        return steps;
        break;

      case 'answer_question':
        steps.generate_response = {
          number: 1,
          tool: 'generate_response',
          args: {
            query: normalized.message_for_ai || normalized.description || '',
            context: {
              venue_info: true,
              booking_policies: true
            }
          }
        };
        return steps;
        break;

      case 'request_info':
        steps.request_additional_info = {
          number: 1,
          tool: 'request_additional_info',
          args: {
            missing_fields: this.identifyMissingFields(normalized, actionType),
            context: normalized.description || ''
          }
        };
        return steps;
        break;

      case 'escalate':
        steps.escalate_to_human = {
          number: 1,
          tool: 'escalate_to_human',
          args: {
            reason: normalized.description || 'Manual review required',
            priority: 'medium'
          }
        };
        return steps;
        break;
      default:
        return {};
    }

    return steps;
  }

  /**
   * Order steps by their number property
   */
  private orderStepsByNumber(steps: Record<string, Step>): Record<string, Step> {
    // Convert object to array with keys
    const stepsArray = Object.entries(steps).map(([key, step]) => ({
      key,
      step
    }));

    // Sort by number
    stepsArray.sort((a, b) => (a.step.number || 0) - (b.step.number || 0));

    // Convert back to ordered object
    const orderedSteps: Record<string, Step> = {};
    stepsArray.forEach(({ key, step }) => {
      orderedSteps[key] = step;
    });

    return orderedSteps;
  }

  /**
   * Fix and validate steps structure for auto-fix functionality
   */
  private fixStepsStructure(steps: any): Record<string, Step> {
    if (Array.isArray(steps)) {
      // Convert array to object
      const stepsObj: Record<string, Step> = {};
      steps.forEach((step, index) => {
        const toolName = step.tool || `step_${index + 1}`;
        stepsObj[toolName] = {
          number: step.number || index + 1,
          tool: step.tool || 'unknown_tool',
          args: step.args || {}
        };
      });
      return stepsObj;
    } else if (typeof steps === 'object' && steps !== null) {
      // Already an object, just validate
      const result: Record<string, Step> = {};
      for (const key in steps) {
        if (steps.hasOwnProperty(key)) {
          result[key] = {
            number: steps[key].number || 1,
            tool: steps[key].tool || key,
            args: steps[key].args || {}
          };
        }
      }
      return result;
    }
    return {};
  }

  /**
   * Normalize extraction fields so we can support both snake_case and camelCase inputs
   */
  private normalizeExtraction(extraction: any): any {
    if (!extraction || typeof extraction !== 'object') {
      return {};
    }

    return {
      ...extraction,
      first_name: extraction.first_name ?? extraction.firstName ?? '',
      last_name: extraction.last_name ?? extraction.lastName ?? '',
      phone_number: extraction.phone_number ?? extraction.phone ?? extraction.phoneNumber ?? '',
      email: extraction.email ?? extraction.email_address ?? extraction.emailAddress ?? '',
      guest_count: extraction.guest_count ?? extraction.guests ?? extraction.guestCount ?? '',
      requests: extraction.requests ?? [],
      comment: extraction.comment ?? '',
      date: extraction.date ?? '',
      bookingref: extraction.bookingref ?? extraction.booking_ref ?? extraction.bookingRef ?? '',
      intent: extraction.intent ?? extraction.action ?? '',
      action: extraction.action ?? extraction.intent ?? '',
      message_for_ai: extraction.message_for_ai ?? extraction.message ?? '',
      description: extraction.description ?? ''
    };
  }

  /**
   * Create a parser instance with the default schema
   */
  static createDefault(): StructuredOutputParser {
    const defaultSchema = {
      "intent": "make_booking",
      "action": "make_booking", 
      "missing_fields": [],
      "steps": {
        "get_availability": {
          "number": 1,
          "tool": "get_availability",
          "args": {
            "date": "...",
            "guests": "...",
            "requests": "..."
          }
        },
        "make_booking": {
          "number": 2,
          "tool": "make_booking",
          "args": {
            "firstName": "...",
            "lastName": "...",
            "phone": "...",
            "email": "...",
            "requests": "...",
            "message": "...",
            "waitlist": false
          }
        }
      }
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
