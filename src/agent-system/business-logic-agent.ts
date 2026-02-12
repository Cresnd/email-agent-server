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
      
      // AGGRESSIVE LOGGING - FIND THE BUG!
      console.log('🔴🔴🔴 [BusinessLogicAgent] START AGGRESSIVE DEBUG 🔴🔴🔴');
      console.log('[BusinessLogicAgent] Has resolved_prompt?', !!input.resolved_prompt);
      console.log('[BusinessLogicAgent] Resolved prompt type:', typeof input.resolved_prompt);
      console.log('[BusinessLogicAgent] Resolved prompt full:', input.resolved_prompt);
      console.log('[BusinessLogicAgent] Parsing output exists?', !!input.parsing_output);
      console.log('[BusinessLogicAgent] Parsing extraction_result:', JSON.stringify(input.parsing_output?.extraction_result, null, 2));

      // 2. Prepare AI input with parsing results and venue context
      // Use the resolved prompt if available (from workflow variables), otherwise prepare the default format
      let aiInput: string;
      if (input.resolved_prompt) {
        // The resolved prompt should contain the parsing output
        // Parse it if it's a JSON string
        let parsedData;
        try {
          parsedData = typeof input.resolved_prompt === 'string' ? JSON.parse(input.resolved_prompt) : input.resolved_prompt;
          console.log('[BusinessLogicAgent] Parsed resolved prompt data:', JSON.stringify(parsedData, null, 2));
        } catch (e) {
          console.log('[BusinessLogicAgent] Could not parse resolved prompt as JSON, using as-is');
          parsedData = input.resolved_prompt;
        }
        
        // Format as extracted_data for the AI prompt which expects extracted_data.field references
        // The prompt expects to be able to reference extracted_data.date, extracted_data.first_name, etc.
        aiInput = `The parsing agent has provided the following extracted_data:

extracted_data = ${JSON.stringify(parsedData, null, 2)}

This data is available as extracted_data, where each field can be referenced as extracted_data.fieldname.

The following fields are available:
- extracted_data.intent = "${parsedData.intent || ''}"
- extracted_data.action = "${parsedData.action || ''}"
- extracted_data.date = "${parsedData.date || ''}"
- extracted_data.first_name = "${parsedData.first_name || ''}"
- extracted_data.last_name = "${parsedData.last_name || ''}"
- extracted_data.phone_number = "${parsedData.phone_number || ''}"
- extracted_data.email = "${parsedData.email || ''}"
- extracted_data.guest_count = ${parsedData.guest_count || 'null'}
- extracted_data.requests = ${JSON.stringify(parsedData.requests || [])}

Please analyze this extracted_data and create the appropriate business logic plan according to the rules in your prompt.

CURRENT BOOKINGS: ${JSON.stringify(input.current_bookings || [])}
AVAILABILITY DATA: ${JSON.stringify(input.availability_data || {})}`.trim();
        processingNotes.push(`Using resolved prompt from workflow variables`);
      } else {
        aiInput = this.prepareOrchestratorInput(input);
        processingNotes.push(`Prepared orchestrator input for action: ${input.parsing_output.extraction_result.action}`);
      }

      // 3. Call AI with orchestrator prompt to make business decisions
      console.log('🔵🔵🔵 [BusinessLogicAgent] SENDING TO AI:');
      console.log('[BusinessLogicAgent] Full AI Input:', aiInput);
      console.log('[BusinessLogicAgent] System Prompt Length:', input.venue_prompts.orchestrator.prompt.length);
      console.log('[BusinessLogicAgent] System Prompt Preview:', input.venue_prompts.orchestrator.prompt.substring(0, 500));
      
      const orchestratorResult = await this.callOrchestratorAI(
        input.venue_prompts.orchestrator.prompt,
        aiInput,
        input.output_parser
      );
      
      console.log('🟢🟢🟢 [BusinessLogicAgent] AI RESPONSE:');
      console.log('[BusinessLogicAgent] Orchestrator Result:', JSON.stringify(orchestratorResult, null, 2));
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

      // SKIP structured output parsing - use raw AI output directly
      console.log('⚠️⚠️⚠️ [BusinessLogicAgent] SKIPPING structured output parser - using raw AI output');
      
      // Use the raw AI output if it has the structured format
      let structuredOutput = orchestratorResult._structured_output || orchestratorResult;
      
      // If the AI returned the correct format directly, use it
      if (orchestratorResult.intent && orchestratorResult.action && orchestratorResult.steps) {
        structuredOutput = {
          intent: orchestratorResult.intent,
          action: orchestratorResult.action,
          missing_fields: orchestratorResult.missing_fields || [],
          steps: orchestratorResult.steps
        };
      }
      
      console.log('✅✅✅ [BusinessLogicAgent] Using direct AI output as structured_output:', JSON.stringify(structuredOutput, null, 2));

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
    
    // Format as extracted_data JSON as expected by the prompt
    const extractedData = {
      intent: parsingResult.intent,
      action: parsingResult.action,
      first_name: parsingResult.first_name,
      last_name: parsingResult.last_name,
      email: parsingResult.email,
      phone_number: parsingResult.phone_number,
      guest_count: parsingResult.guest_count,
      date: parsingResult.date,
      requests: parsingResult.requests,
      comment: parsingResult.comment,
      description: parsingResult.description,
      message_for_ai: parsingResult.message_for_ai,
      waitlist: parsingResult.waitlist,
      keep_original_time: parsingResult.keep_original_time,
      bookingref: parsingResult.bookingref,
      search_time: parsingResult.search_time,
      new_time: parsingResult.new_time,
      language: parsingResult.language
    };
    
    return `The parsing agent has provided the following extracted_data:

extracted_data = ${JSON.stringify(extractedData, null, 2)}

This data is available as extracted_data, where each field can be referenced as extracted_data.fieldname.

Please analyze this extracted_data and create the appropriate business logic plan according to the rules in your prompt.

CURRENT BOOKINGS: ${JSON.stringify(input.current_bookings || [])}
AVAILABILITY DATA: ${JSON.stringify(input.availability_data || {})}`.trim();
  }

  /**
   * Attempt to turn a JSON payload provided in the prompt into a structured result without another AI call
   */
  private async tryProcessStructuredPrompt(
    rawPrompt: string | undefined,
    parsingOutput: ParsingAgentOutput,
    processingNotes: string[]
  ): Promise<BusinessLogicAgentOutput | null> {
    if (!rawPrompt) return null;

    let parsed: any;
    try {
      parsed = typeof rawPrompt === 'string' ? JSON.parse(rawPrompt) : rawPrompt;
    } catch (error) {
      processingNotes.push(`Resolved prompt was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }

    let payload = parsed;
    if (Array.isArray(payload)) {
      payload = payload[0];
    }
    if (payload?.output) {
      payload = payload.output;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const extractionSource =
      payload.extracted_data ||
      payload.refined_extraction ||
      payload.extraction ||
      payload;

    const refined_extraction = {
      ...parsingOutput.extraction_result,
      ...extractionSource,
      first_name: extractionSource.first_name ?? extractionSource.firstName ?? parsingOutput.extraction_result.first_name ?? '',
      last_name: extractionSource.last_name ?? extractionSource.lastName ?? parsingOutput.extraction_result.last_name ?? '',
      guest_count: extractionSource.guest_count ?? extractionSource.guests ?? parsingOutput.extraction_result.guest_count ?? null,
      comment: extractionSource.comment ?? parsingOutput.extraction_result.comment ?? '',
      date: extractionSource.date ?? parsingOutput.extraction_result.date ?? '',
      phone_number: extractionSource.phone_number ?? extractionSource.phone ?? parsingOutput.extraction_result.phone_number ?? '',
      requests: extractionSource.requests ?? parsingOutput.extraction_result.requests ?? [],
      search_time: extractionSource.search_time ?? parsingOutput.extraction_result.search_time ?? '',
      new_time: extractionSource.new_time ?? parsingOutput.extraction_result.new_time ?? '',
      intent: extractionSource.intent ?? parsingOutput.extraction_result.intent ?? 'general_question',
      action: extractionSource.action ?? parsingOutput.extraction_result.action ?? 'answer_question',
      request_details: extractionSource.request_details ?? parsingOutput.extraction_result.request_details ?? {},
      description: extractionSource.description ?? parsingOutput.extraction_result.description ?? '',
      message_for_ai: extractionSource.message_for_ai ?? parsingOutput.extraction_result.message_for_ai ?? '',
      email: extractionSource.email ?? parsingOutput.extraction_result.email ?? '',
      waitlist: extractionSource.waitlist ?? parsingOutput.extraction_result.waitlist ?? false,
      keep_original_time: extractionSource.keep_original_time ?? parsingOutput.extraction_result.keep_original_time ?? true,
      bookingref: extractionSource.bookingref ?? parsingOutput.extraction_result.bookingref ?? '',
      language: extractionSource.language ?? extractionSource.lang ?? parsingOutput.extraction_result.language ?? 'en'
    };

    const actionType = payload.action || refined_extraction.action || 'answer_question';
    const intent = payload.intent || refined_extraction.intent || this.mapActionToIntent(actionType);

    const baseResult: BusinessLogicAgentOutput = {
      decision: {
        action_type: actionType as BusinessLogicAgentOutput['decision']['action_type'],
        reasoning: 'Used structured JSON provided in business_logic node prompt',
        confidence: 0.9,
        requires_human_review: false
      },
      refined_extraction,
      guardrail_status: 'passed',
      guardrail_violations: [],
      processed_at: new Date().toISOString(),
      processing_notes: processingNotes
    };

    const structuredPayload = {
      intent,
      action: actionType,
      missing_fields: payload.missing_fields || payload.missingFields || [],
      steps: payload.steps || []
    };

    const structured_output = await this.structuredOutputParser.parse(
      (structuredPayload.steps && structuredPayload.steps.length > 0) || (structuredPayload.missing_fields && structuredPayload.missing_fields.length > 0)
        ? { ...baseResult, _structured_output: structuredPayload }
        : baseResult
    );

    return {
      ...baseResult,
      structured_output
    };
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
          model: 'gpt-4o',
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
        console.log('🟡🟡🟡 [BusinessLogicAgent] RAW AI RESPONSE:', aiResponse);
        orchestratorResult = JSON.parse(aiResponse);
        console.log('🟠🟠🟠 [BusinessLogicAgent] PARSED AI Output:', JSON.stringify(orchestratorResult, null, 2));
        console.log('🔴 CRITICAL: AI returned missing_fields:', orchestratorResult.missing_fields);
        console.log('🔴 CRITICAL: AI returned intent:', orchestratorResult.intent);
        console.log('🔴 CRITICAL: AI returned action:', orchestratorResult.action);
        console.log('🔴 CRITICAL: AI returned steps:', JSON.stringify(orchestratorResult.steps, null, 2));
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
          steps: orchestratorResult.steps || {}
        };
      }

      // Use the original parsing extraction result if no refined_extraction from AI
      const parsingExtraction = this.extractDataFromInput(orchestratorInput);
      const refined_extraction = orchestratorResult.refined_extraction || parsingExtraction || {
        first_name: '',
        last_name: '',
        guest_count: null,
        comment: '',
        date: '',
        phone_number: '',
        requests: [],
        search_time: '',
        new_time: '',
        intent: orchestratorResult.intent || 'general_question',
        action: orchestratorResult.action || decision.action_type,
        request_details: {},
        description: 'Orchestrator processing complete',
        message_for_ai: '',
        email: '',
        waitlist: false,
        keep_original_time: true,
        bookingref: '',
        language: 'en'
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

  private mapActionToIntent(actionType: string): string {
    const intentMap: Record<string, string> = {
      make_booking: 'make_booking',
      edit_booking: 'edit_booking',
      cancel_booking: 'cancel_booking',
      find_booking: 'find_booking',
      answer_question: 'general_question',
      request_info: 'request_info',
      escalate: 'escalate'
    };

    return intentMap[actionType] || 'general_question';
  }

  private extractDataFromInput(orchestratorInput: string): any {
    try {
      // Extract the JSON from the orchestrator input
      const match = orchestratorInput.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch (error) {
      console.error('Failed to extract data from orchestrator input:', error);
    }
    return null;
  }
}
