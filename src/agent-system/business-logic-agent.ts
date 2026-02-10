/**
 * Business Logic Agent - Agent 2 of 3-Agent Pipeline
 * Responsible for business decision making, validation, and execution planning
 */

import { ParsingAgentOutput } from './parsing-agent.ts';
import { StructuredOutputParser, StructuredOutput } from './structured-output-parser.ts';

export interface BusinessLogicAgentInput {
  parsing_output: ParsingAgentOutput;
  
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
    orchestrator?: {
      prompt: string;
      checksum: string;
    };
  };
  
  guardrails: {
    post_intent_guardrails?: Array<{
      name: string;
      prompt: string;
      threshold: number;
      folder_path?: string;
      mark_as_seen?: boolean;
    }>;
  };
  
  current_bookings?: any[];
  availability_data?: any;
  output_parser?: Record<string, any>;
  resolved_prompt?: string; // The resolved prompt from workflow variables (e.g. resolved {{ step.parsing }})
}

export interface BusinessLogicAgentOutput {
  decision: {
    action_type: 'make_booking' | 'edit_booking' | 'cancel_booking' | 'find_booking' | 'answer_question' | 'request_info' | 'escalate';
    reasoning: string;
    confidence: number;
    requires_human_review: boolean;
  };
  
  // Refined extraction result after business logic validation
  refined_extraction: ParsingAgentOutput['extraction_result'];
  
  // Guardrail validation results
  guardrail_status: 'passed' | 'blocked' | 'flagged';
  guardrail_violations?: Array<{
    guardrail_name: string;
    violation_type: 'blocked' | 'flagged';
    confidence: number;
    reasoning: string;
  }>;
  
  // Processing metadata
  processed_at: string;
  processing_notes: string[];

  // New structured output format
  structured_output?: StructuredOutput;
}

export class BusinessLogicAgent {
  private structuredOutputParser: StructuredOutputParser;

  constructor() {
    this.structuredOutputParser = StructuredOutputParser.createDefault();
  }
  
  /**
   * Main processing method for Business Logic Agent
   * Uses AI with venue-specific orchestrator prompt for business logic decisions
   */
  async process(input: BusinessLogicAgentInput): Promise<BusinessLogicAgentOutput> {
    const startTime = Date.now();
    const processingNotes: string[] = [];
    
    try {
      // 1. Validate that we have the orchestrator prompt
      if (!input.venue_prompts.orchestrator?.prompt) {
        throw new Error('Missing orchestrator prompt for venue');
      }
      
      processingNotes.push(`Using orchestrator prompt (checksum: ${input.venue_prompts.orchestrator.checksum})`);

      // 2. Prepare AI input with parsing results and venue context
      // Use the resolved prompt if available (from workflow variables), otherwise prepare the default format
      let aiInput: string;
      if (input.resolved_prompt) {
        aiInput = input.resolved_prompt;
        processingNotes.push(`Using resolved prompt from workflow variables`);
      } else {
        aiInput = this.prepareOrchestratorInput(input);
        processingNotes.push(`Prepared orchestrator input for action: ${input.parsing_output.extraction_result.action}`);
      }

      // 3. Call AI with orchestrator prompt to make business decisions
      const orchestratorResult = await this.callOrchestratorAI(
        input.venue_prompts.orchestrator.prompt,
        aiInput,
        input.output_parser
      );
      processingNotes.push(`Orchestrator decision: ${orchestratorResult.decision.action_type}`);

      // 4. Apply post-intent guardrails to the result
      const guardrailResults = await this.applyPostIntentGuardrails(
        orchestratorResult,
        input.guardrails.post_intent_guardrails || []
      );
      processingNotes.push(`Post-intent guardrails applied - status: ${guardrailResults.status}`);

      // 5. Calculate final confidence based on orchestrator result and guardrails
      const finalConfidence = this.calculateFinalConfidence(orchestratorResult.decision, guardrailResults);
      processingNotes.push(`Final confidence: ${finalConfidence.toFixed(2)}`);

      // Create the base result
      const baseResult: any = {
        decision: {
          ...orchestratorResult.decision,
          confidence: finalConfidence
        },
        refined_extraction: orchestratorResult.refined_extraction,
        guardrail_status: guardrailResults.status,
        guardrail_violations: guardrailResults.violations,
        processed_at: new Date().toISOString(),
        processing_notes: processingNotes
      };

      // Apply structured output parsing
      const structuredOutput = await this.structuredOutputParser.parse(baseResult);
      processingNotes.push('Applied structured output parsing');

      const result: BusinessLogicAgentOutput = {
        ...baseResult,
        structured_output: structuredOutput
      };

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      processingNotes.push(`Error during orchestration: ${errorMessage}`);

      // Return fallback result
      return await this.createFallbackResult(input.parsing_output, processingNotes, errorMessage);
    }
  }

  /**
   * Prepare input for the orchestrator AI with all necessary context
   */
  private prepareOrchestratorInput(input: BusinessLogicAgentInput): string {
    const parsingResult = input.parsing_output.extraction_result;
    const venueInfo = input.venue_settings;
    
    return `
VENUE CONTEXT:
- Venue: ${venueInfo.venue_name}
- Venue ID: ${venueInfo.venue_id}
- Address: ${venueInfo.venue_address}
- Timezone: ${venueInfo.venue_timezone}
- Organization: ${venueInfo.organization_name}

PARSED EMAIL EXTRACTION:
- Intent: ${parsingResult.intent}
- Action: ${parsingResult.action}
- Customer: ${parsingResult.first_name} ${parsingResult.last_name}
- Email: ${parsingResult.email}
- Phone: ${parsingResult.phone_number}
- Guest Count: ${parsingResult.guest_count}
- Date: ${parsingResult.date}
- Time: ${parsingResult.requests.map(r => `${r.type} at ${r.time}`).join(', ')}
- Comment: ${parsingResult.comment}
- Description: ${parsingResult.description}
- Message: ${parsingResult.message_for_ai}

CURRENT BOOKINGS: ${JSON.stringify(input.current_bookings || [])}
AVAILABILITY DATA: ${JSON.stringify(input.availability_data || {})}
    `.trim();
  }

  /**
   * Call orchestrator AI to make business logic decisions
   */
  private async callOrchestratorAI(
    orchestratorPrompt: string,
    orchestratorInput: string,
    outputParser?: Record<string, any>
  ): Promise<{
    decision: {
      action_type: BusinessLogicAgentOutput['decision']['action_type'];
      reasoning: string;
      requires_human_review: boolean;
    };
    refined_extraction: ParsingAgentOutput['extraction_result'];
  }> {
    
    try {
      const apiKey = Deno.env.get('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OpenAI API key not found in environment variables');
      }

      let systemContent = orchestratorPrompt;
      if (outputParser) {
        systemContent += `\n\nIMPORTANT: You MUST respond with a JSON object that follows this exact structure:\n${JSON.stringify(outputParser, null, 2)}\n\nFill in the actual values based on the email data. The "steps" array should contain the execution steps needed for this request. Each step has a "tool" name and "args" object. Only include steps that are relevant to the detected intent/action. If any required fields are missing from the email, list them in "missing_fields".`;
      } else {
        // Use the structured output parser's schema when no output parser is provided
        systemContent += `\n\nIMPORTANT: You MUST respond with a JSON object that follows this exact structure:\n${this.structuredOutputParser.getSchemaExample()}\n\nFill in the actual values based on the email data. The "steps" array should contain the execution steps needed for this request. Each step has a "tool" name and "args" object. Only include steps that are relevant to the detected intent/action. If any required fields are missing from the email, list them in "missing_fields".`;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: systemContent
            },
            {
              role: 'user',
              content: orchestratorInput
            }
          ],
          temperature: 0.2,
          max_tokens: 1500,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const aiResponse = data.choices?.[0]?.message?.content;

      if (!aiResponse) {
        throw new Error('No response from OpenAI API');
      }

      // Parse the JSON response
      let orchestratorResult;
      try {
        orchestratorResult = JSON.parse(aiResponse);
      } catch (parseError) {
        throw new Error(`Failed to parse AI response as JSON: ${parseError}`);
      }

      const decision = {
        action_type: orchestratorResult.decision?.action_type || orchestratorResult.action || 'answer_question',
        reasoning: orchestratorResult.decision?.reasoning || 'AI decision made',
        requires_human_review: orchestratorResult.decision?.requires_human_review || false
      };

      // Check if the result contains the new structured output format
      if (orchestratorResult.intent !== undefined && orchestratorResult.action !== undefined) {
        orchestratorResult._structured_output = {
          intent: orchestratorResult.intent,
          action: orchestratorResult.action,
          missing_fields: orchestratorResult.missing_fields || [],
          steps: orchestratorResult.steps || []
        };
      }

      const refined_extraction = {
        first_name: orchestratorResult.refined_extraction?.first_name || '',
        last_name: orchestratorResult.refined_extraction?.last_name || '',
        guest_count: orchestratorResult.refined_extraction?.guest_count || null,
        comment: orchestratorResult.refined_extraction?.comment || '',
        date: orchestratorResult.refined_extraction?.date || '',
        phone_number: orchestratorResult.refined_extraction?.phone_number || '',
        requests: Array.isArray(orchestratorResult.refined_extraction?.requests) ? orchestratorResult.refined_extraction.requests : [],
        search_time: orchestratorResult.refined_extraction?.search_time || '',
        new_time: orchestratorResult.refined_extraction?.new_time || '',
        intent: orchestratorResult.refined_extraction?.intent || 'general_question',
        action: orchestratorResult.refined_extraction?.action || decision.action_type,
        request_details: orchestratorResult.refined_extraction?.request_details || {},
        description: orchestratorResult.refined_extraction?.description || 'Orchestrator processing complete',
        message_for_ai: orchestratorResult.refined_extraction?.message_for_ai || '',
        email: orchestratorResult.refined_extraction?.email || '',
        waitlist: orchestratorResult.refined_extraction?.waitlist || false,
        keep_original_time: orchestratorResult.refined_extraction?.keep_original_time !== undefined ? orchestratorResult.refined_extraction.keep_original_time : true,
        bookingref: orchestratorResult.refined_extraction?.bookingref || '',
        language: orchestratorResult.refined_extraction?.language || 'en'
      };

      const returnValue: any = {
        decision,
        refined_extraction
      };
      if (orchestratorResult._structured_output) {
        returnValue._structured_output = orchestratorResult._structured_output;
      }
      return returnValue;

    } catch (error) {
      console.error('Orchestrator AI call failed:', error);
      
      // Fallback to rule-based logic when AI fails
      const inputLines = orchestratorInput.split('\n');
      const actionLine = inputLines.find(line => line.includes('Action:'));
      
      let actionType: BusinessLogicAgentOutput['decision']['action_type'] = 'answer_question';
      
      if (actionLine?.includes('make_booking')) {
        actionType = 'make_booking';
      } else if (actionLine?.includes('edit_booking')) {
        actionType = 'edit_booking';
      } else if (actionLine?.includes('cancel_booking')) {
        actionType = 'cancel_booking';
      } else if (actionLine?.includes('find_booking')) {
        actionType = 'find_booking';
      } else if (actionLine?.includes('request_info')) {
        actionType = 'request_info';
      }
      
      return {
        decision: {
          action_type: actionType,
          reasoning: `AI orchestrator failed, using fallback logic: ${error instanceof Error ? error.message : String(error)}`,
          requires_human_review: true
        },
        refined_extraction: {
          first_name: '',
          last_name: '',
          guest_count: null,
          comment: '',
          date: '',
          phone_number: '',
          requests: [],
          search_time: '',
          new_time: '',
          intent: 'general_question',
          action: actionType,
          request_details: {},
          description: 'Orchestrator processing failed, using fallback',
          message_for_ai: '',
          email: '',
          waitlist: false,
          keep_original_time: true,
          bookingref: '',
          language: 'en'
        }
      };
    }
  }

  /**
   * Apply post-intent guardrails to the orchestrator result
   */
  private async applyPostIntentGuardrails(
    orchestratorResult: any,
    guardrails: Array<{
      name: string;
      prompt: string;
      threshold: number;
      folder_path?: string;
      mark_as_seen?: boolean;
    }>
  ): Promise<{
    status: 'passed' | 'blocked' | 'flagged';
    violations: Array<{
      guardrail_name: string;
      violation_type: 'blocked' | 'flagged';
      confidence: number;
      reasoning: string;
    }>;
  }> {
    
    const violations: Array<{
      guardrail_name: string;
      violation_type: 'blocked' | 'flagged';
      confidence: number;
      reasoning: string;
    }> = [];
    
    // TODO: Implement actual guardrail evaluation using AI
    // For now, returning a mock that passes all guardrails
    
    return {
      status: 'passed',
      violations: violations
    };
  }

  /**
   * Calculate final confidence based on orchestrator result and guardrails
   */
  private calculateFinalConfidence(decision: any, guardrailResults: any): number {
    let confidence = 0.8; // Base confidence for orchestrator
    
    // Reduce confidence based on guardrail violations
    if (guardrailResults.status === 'blocked') {
      confidence = 0.1;
    } else if (guardrailResults.status === 'flagged') {
      confidence = Math.max(0.3, confidence - (guardrailResults.violations.length * 0.2));
    }
    
    // Boost confidence if decision requires human review (indicates caution)
    if (decision.requires_human_review) {
      confidence += 0.1;
    }
    
    return Math.min(0.95, Math.max(0.05, confidence));
  }

  /**
   * Create fallback result for error cases
   */
  private async createFallbackResult(
    parsingOutput: ParsingAgentOutput,
    processingNotes: string[],
    errorMessage: string
  ): Promise<BusinessLogicAgentOutput> {
    const baseResult = {
      decision: {
        action_type: 'escalate',
        reasoning: `Orchestrator processing failed: ${errorMessage}`,
        confidence: 0.1,
        requires_human_review: true
      },
      refined_extraction: parsingOutput.extraction_result,
      guardrail_status: 'flagged' as const,
      guardrail_violations: [{
        guardrail_name: 'orchestrator_error',
        violation_type: 'flagged' as const,
        confidence: 1.0,
        reasoning: errorMessage
      }],
      processed_at: new Date().toISOString(),
      processing_notes: processingNotes
    };

    // Apply structured output parsing even for error cases
    const structuredOutput = await this.structuredOutputParser.parse(baseResult);

    return {
      ...baseResult,
      structured_output: structuredOutput
    };
  }
}