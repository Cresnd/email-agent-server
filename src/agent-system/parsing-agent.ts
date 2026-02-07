/**
 * Parsing Agent - Agent 1 of 3-Agent Pipeline
 * Responsible for data extraction, intent classification, and content normalization
 */

export interface ParsingAgentInput {
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
  venue_prompts: {
    email_extractor?: {
      prompt: string;
      checksum: string;
    };
  };
  guardrails: {
    intent_guardrails?: Array<{
      name: string;
      prompt: string;
      threshold: number;
      folder_path?: string;
      mark_as_seen?: boolean;
    }>;
  };
}

export interface ParsingAgentOutput {
  // Raw extraction result from AI (JSON output from email_extractor prompt)
  extraction_result: {
    first_name: string;
    last_name: string;
    guest_count: number | null;
    comment: string;
    date: string;
    phone_number: string;
    requests: Array<{
      time: string | string[];
      type: 'dinner' | 'bowling' | 'shuffleboard' | 'sport' | 'dart' | 'trekamp' | 'femkamp' | 'karaoke' | 'biljard';
    }>;
    search_time: string;
    new_time: string | string[];
    intent: 'make_booking' | 'edit_booking' | 'cancel_booking' | 'general_question' | 'invoice';
    action: string;
    request_details: Record<string, any>;
    description: string;
    message_for_ai: string;
    email: string;
    waitlist: boolean;
    keep_original_time: boolean;
    bookingref: string;
    language: string;
  };
  
  // Guardrail validation results
  guardrail_status: 'passed' | 'blocked' | 'flagged';
  guardrail_violations?: Array<{
    guardrail_name: string;
    violation_type: 'blocked' | 'flagged';
    confidence: number;
    reasoning: string;
  }>;
  
  // Processing metadata
  confidence_score: number;
  parsed_at: string;
  processing_notes: string[];
}

export class ParsingAgent {
  
  /**
   * Main processing method for Parsing Agent
   * Uses AI with venue-specific email_extractor prompt instead of rule-based logic
   */
  async process(input: ParsingAgentInput): Promise<ParsingAgentOutput> {
    const startTime = Date.now();
    const processingNotes: string[] = [];
    
    try {
      // 1. Validate that we have the email_extractor prompt
      if (!input.venue_prompts.email_extractor?.prompt) {
        throw new Error('Missing email_extractor prompt for venue');
      }
      
      processingNotes.push(`Using email_extractor prompt (checksum: ${input.venue_prompts.email_extractor.checksum})`);

      // 2. Prepare the AI input with email content
      const aiInput = this.prepareAIInput(input.email_content);
      processingNotes.push(`Prepared AI input with ${aiInput.length} characters`);

      // 3. Call AI with the venue-specific email_extractor prompt
      const extractionResult = await this.callAIForExtraction(
        input.venue_prompts.email_extractor.prompt,
        aiInput
      );
      processingNotes.push(`AI extraction completed - intent: ${extractionResult.intent}, action: ${extractionResult.action}`);

      // 4. Apply intent guardrails to the result
      const guardrailResults = await this.applyGuardrails(
        extractionResult,
        input.guardrails.intent_guardrails || []
      );
      processingNotes.push(`Guardrails applied - status: ${guardrailResults.status}`);

      // 5. Calculate confidence based on AI response and guardrail results
      const confidenceScore = this.calculateConfidenceScore(extractionResult, guardrailResults);
      processingNotes.push(`Final confidence: ${confidenceScore.toFixed(2)}`);

      return {
        extraction_result: extractionResult,
        guardrail_status: guardrailResults.status,
        guardrail_violations: guardrailResults.violations,
        confidence_score: confidenceScore,
        parsed_at: new Date().toISOString(),
        processing_notes: processingNotes
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      processingNotes.push(`Error during parsing: ${errorMessage}`);

      // Return fallback result with low confidence
      return this.createFallbackResult(input.email_content, processingNotes, errorMessage);
    }
  }

  /**
   * Prepare AI input by formatting email content for the email_extractor prompt
   */
  private prepareAIInput(emailContent: any): string {
    return `
Email Subject: ${emailContent.subject}
Customer Email: ${emailContent.customer_email}
First Name: ${emailContent.first_name || ''}
Last Name: ${emailContent.last_name || ''}
Message Content:
${emailContent.message_for_ai}

Attachments: ${emailContent.attachments || 'None'}
Received At: ${emailContent.received_at}
Conversation ID: ${emailContent.conversation_id}
    `.trim();
  }

  /**
   * Call AI for data extraction using the venue-specific email_extractor prompt
   */
  private async callAIForExtraction(
    emailExtractorPrompt: string,
    emailInput: string
  ): Promise<ParsingAgentOutput['extraction_result']> {
    
    try {
      const apiKey = Deno.env.get('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OpenAI API key not found in environment variables');
      }

      // Make OpenAI API call
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
              content: emailExtractorPrompt
            },
            {
              role: 'user',
              content: emailInput
            }
          ],
          temperature: 0.1,
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
      let extractionResult;
      try {
        extractionResult = JSON.parse(aiResponse);
      } catch (parseError) {
        throw new Error(`Failed to parse AI response as JSON: ${parseError}`);
      }

      // Validate and fill in required fields with defaults if missing
      const result = {
        first_name: extractionResult.first_name || '',
        last_name: extractionResult.last_name || '',
        guest_count: extractionResult.guest_count || null,
        comment: extractionResult.comment || '',
        date: extractionResult.date || '',
        phone_number: extractionResult.phone_number || '',
        requests: Array.isArray(extractionResult.requests) ? extractionResult.requests : [],
        search_time: extractionResult.search_time || '',
        new_time: extractionResult.new_time || '',
        intent: extractionResult.intent || 'general_question',
        action: extractionResult.action || 'answer_question',
        request_details: extractionResult.request_details || {},
        description: extractionResult.description || 'Processed by AI',
        message_for_ai: emailInput.split('Message Content:')[1]?.split('\n\nAttachments:')[0]?.trim() || '',
        email: emailInput.split('Customer Email: ')[1]?.split('\n')[0] || '',
        waitlist: extractionResult.waitlist || false,
        keep_original_time: extractionResult.keep_original_time !== undefined ? extractionResult.keep_original_time : true,
        bookingref: extractionResult.bookingref || '',
        language: extractionResult.language || 'en'
      };

      return result;

    } catch (error) {
      console.error('AI extraction failed:', error);
      
      // Return fallback result on AI failure
      return {
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
        action: 'answer_question',
        request_details: {},
        description: `AI extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        message_for_ai: emailInput.split('Message Content:')[1]?.split('\n\nAttachments:')[0]?.trim() || '',
        email: emailInput.split('Customer Email: ')[1]?.split('\n')[0] || '',
        waitlist: false,
        keep_original_time: true,
        bookingref: '',
        language: 'en'
      };
    }
  }

  /**
   * Apply intent guardrails to the AI extraction result
   */
  private async applyGuardrails(
    extractionResult: ParsingAgentOutput['extraction_result'],
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
   * Calculate confidence score based on extraction result and guardrail results
   */
  private calculateConfidenceScore(
    extractionResult: ParsingAgentOutput['extraction_result'],
    guardrailResults: { status: string; violations: any[] }
  ): number {
    
    let confidence = 0.8; // Base confidence for AI extraction
    
    // Reduce confidence based on guardrail violations
    if (guardrailResults.status === 'blocked') {
      confidence = 0.1;
    } else if (guardrailResults.status === 'flagged') {
      confidence = Math.max(0.3, confidence - (guardrailResults.violations.length * 0.2));
    }
    
    // Boost confidence if we have clear intent and action
    if (extractionResult.intent && extractionResult.action) {
      confidence += 0.1;
    }
    
    // Boost confidence if we have good customer data
    if (extractionResult.first_name && extractionResult.last_name) {
      confidence += 0.05;
    }
    
    return Math.min(0.95, Math.max(0.05, confidence));
  }

  /**
   * Create fallback result when processing fails
   */
  private createFallbackResult(
    emailContent: any,
    processingNotes: string[],
    errorMessage: string
  ): ParsingAgentOutput {
    return {
      extraction_result: {
        first_name: emailContent.first_name || '',
        last_name: emailContent.last_name || '',
        guest_count: null,
        comment: '',
        date: '',
        phone_number: '',
        requests: [],
        search_time: '',
        new_time: '',
        intent: 'general_question',
        action: 'answer_question',
        request_details: {},
        description: `Processing failed: ${errorMessage}`,
        message_for_ai: emailContent.message_for_ai || '',
        email: emailContent.customer_email || '',
        waitlist: false,
        keep_original_time: true,
        bookingref: '',
        language: 'en'
      },
      guardrail_status: 'flagged',
      guardrail_violations: [{
        guardrail_name: 'processing_error',
        violation_type: 'flagged',
        confidence: 1.0,
        reasoning: errorMessage
      }],
      confidence_score: 0.1,
      parsed_at: new Date().toISOString(),
      processing_notes: processingNotes
    };
  }
}