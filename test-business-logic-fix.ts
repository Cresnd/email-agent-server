#!/usr/bin/env -S deno run --allow-all

/**
 * Test script to verify that BusinessLogicAgent correctly uses the resolved prompt
 */

import { BusinessLogicAgent, BusinessLogicAgentInput } from './src/agent-system/business-logic-agent.ts';
import { ParsingAgentOutput } from './src/agent-system/parsing-agent.ts';

// Create a mock parsing output
const mockParsingOutput: ParsingAgentOutput = {
  extraction_result: {
    first_name: "John",
    last_name: "Doe",
    guest_count: 2,
    comment: "",
    date: "2026-02-11",
    phone_number: "234234234",
    requests: [{
      time: "17:00",
      type: "dinner"
    }],
    search_time: "",
    new_time: "",
    intent: "make_booking",
    action: "make_booking",
    request_details: {},
    description: "John Doe wants to make a booking for 2 people on the 11th of February at 17:00. His phone number is 234234234. Make the booking. Answer the guest.",
    message_for_ai: "Hi, I would liek to book for 2 people tomorow at 5 o clock can you help tme phone numerb 234234234",
    email: "john.doe@customer.co",
    waitlist: false,
    keep_original_time: true,
    bookingref: "",
    language: "en"
  },
  confidence_score: 0.95,
  guardrail_status: 'passed',
  guardrail_violations: [],
  processed_at: new Date().toISOString()
};

// This is the resolved prompt that should be passed directly to the LLM
// It's the result of resolving {{ step.parsing }}
const resolvedPrompt = JSON.stringify({
  "intent": "make_booking",
  "action": "make_booking",
  "extracted_data": {
    "first_name": "John",
    "last_name": "Doe",
    "guest_count": 2,
    "comment": "",
    "date": "2026-02-11",
    "phone_number": "234234234",
    "requests": [{
      "time": "17:00",
      "type": "dinner"
    }],
    "search_time": "",
    "new_time": "",
    "intent": "make_booking",
    "action": "make_booking",
    "request_details": {},
    "description": "John Doe wants to make a booking for 2 people on the 11th of February at 17:00. His phone number is 234234234. Make the booking. Answer the guest.",
    "message_for_ai": "Hi, I would liek to book for 2 people tomorow at 5 o clock can you help tme phone numerb 234234234",
    "email": "john.doe@customer.co",
    "waitlist": false,
    "keep_original_time": true,
    "bookingref": "",
    "language": "en"
  },
  "guardrail_status": "passed",
  "session_id": "c9486bf3-5ae7-4f4d-a5cc-a7da1c3c7583",
  "session_mode": "automatic"
});

const orchestratorPrompt = `
You are the Business Logic agent for O'learys Gävle.

When you receive JSON data with "extraction" fields, process it as follows:

If extraction.intent is "make_booking" and extraction.action is "make_booking":
  - Check if all required fields are present (first_name, date, time, guest_count, phone_number)
  - Return a JSON response with:
    {
      "intent": "make_booking",
      "action": "make_booking",
      "missing_fields": [], // List any missing required fields
      "steps": [
        {
          "tool": "create_booking",
          "args": {
            "date": "<date from extraction>",
            "time": "<time from extraction>",
            "guest_count": <guest_count from extraction>,
            "customer_name": "<first_name> <last_name>",
            "phone": "<phone_number from extraction>"
          }
        }
      ]
    }
`;

// Create the BusinessLogicAgent input
const input: BusinessLogicAgentInput = {
  parsing_output: mockParsingOutput,
  venue_settings: {
    venue_id: "test-venue",
    venue_name: "O'learys Gävle",
    venue_address: "Test Address",
    venue_description: "Test Description",
    venue_timezone: "Europe/Stockholm",
    organization_id: "test-org",
    organization_name: "Test Organization",
    finance_email: null
  },
  venue_prompts: {
    orchestrator: {
      prompt: orchestratorPrompt,
      checksum: "test-checksum"
    }
  },
  guardrails: {
    post_intent_guardrails: []
  },
  current_bookings: [],
  availability_data: null,
  resolved_prompt: resolvedPrompt // This is the key fix - passing the resolved JSON
};

async function runTest() {
  console.log("🧪 Testing BusinessLogicAgent with resolved prompt fix");
  console.log("=" .repeat(60));
  
  const agent = new BusinessLogicAgent();
  
  try {
    console.log("\n📋 Input:");
    console.log("- Parsing output intent:", mockParsingOutput.extraction_result.intent);
    console.log("- Resolved prompt (first 200 chars):", resolvedPrompt.substring(0, 200) + "...");
    console.log("\n🤖 Calling BusinessLogicAgent.process()...");
    
    const result = await agent.process(input);
    
    console.log("\n✅ Success! Business Logic Agent output:");
    console.log("- Decision action type:", result.decision.action_type);
    console.log("- Decision reasoning:", result.decision.reasoning);
    console.log("- Processing notes:", result.processing_notes);
    
    if (result.structured_output) {
      console.log("\n📊 Structured output:");
      console.log("- Intent:", result.structured_output.intent);
      console.log("- Action:", result.structured_output.action);
      console.log("- Missing fields:", result.structured_output.missing_fields);
      console.log("- Steps:", JSON.stringify(result.structured_output.steps, null, 2));
    }
    
    // Check if the resolved prompt was used
    const usedResolvedPrompt = result.processing_notes.some(note => 
      note.includes("Using resolved prompt from workflow variables")
    );
    
    if (usedResolvedPrompt) {
      console.log("\n✅ VERIFICATION PASSED: The resolved prompt was correctly used!");
    } else {
      console.log("\n❌ VERIFICATION FAILED: The resolved prompt was NOT used!");
    }
    
  } catch (error) {
    console.error("\n❌ Error:", error);
  }
}

// Run the test
runTest();