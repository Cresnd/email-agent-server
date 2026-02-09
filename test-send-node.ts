/**
 * Test script for Send node implementation
 * Validates the Send node functionality without requiring full workflow execution
 */

import { StepProcessor } from "./src/workflow-engine/step-processor.ts";
import { ExecutionContext } from "./src/workflow-engine/executor.ts";

// Mock execution context with send node data
const mockContext: ExecutionContext = {
  workflowId: "test-workflow-123",
  executionId: "test-execution-456",
  organizationId: "org-123",
  venueId: "venue-456",
  triggerData: {
    customer_email: "customer@example.com",
    from: "customer@example.com",
    subject: "Test Booking Request",
    venue_email: "venue@restaurant.com",
    message_id: "test-message-id-123",
    references: "ref-123",
    outlook_id: "" // Empty for SMTP test
  },
  variables: {},
  currentStep: "send-node-1",
  status: "running",
  startTime: new Date(),
  stepHistory: [
    {
      stepId: "previous-step",
      status: "completed",
      startTime: new Date(),
      endTime: new Date(),
      input: {},
      output: {
        body_html: "<p>Thank you for your booking request. We have confirmed your reservation.</p>",
        ai_response: {
          body_html: "<p>Thank you for your booking request. We have confirmed your reservation.</p>"
        }
      }
    }
  ]
};

// Mock configuration for send node
const mockConfig = {
  subject: "Booking Confirmation",
  from: "noreply@restaurant.com",
  folder_path: "Sent",
  attachments: ""
};

async function testSendNode() {
  console.log("🧪 Testing Send Node Implementation");
  console.log("=" .repeat(50));

  const stepProcessor = new StepProcessor();

  try {
    // Test SMTP send
    console.log("\n📧 Testing SMTP Send (no outlook_id)");
    const smtpResult = await stepProcessor.executeStep('send', mockConfig, mockContext);
    console.log("✅ SMTP Test Result:", JSON.stringify(smtpResult, null, 2));

    // Test Outlook send
    console.log("\n📧 Testing Outlook Send (with outlook_id)");
    const outlookContext = {
      ...mockContext,
      triggerData: {
        ...mockContext.triggerData,
        outlook_id: "outlook-123"
      }
    };
    
    const outlookResult = await stepProcessor.executeStep('send', mockConfig, outlookContext);
    console.log("✅ Outlook Test Result:", JSON.stringify(outlookResult, null, 2));

    // Test error cases
    console.log("\n🚫 Testing Error Cases");
    
    // No customer email
    const noEmailContext = {
      ...mockContext,
      triggerData: { ...mockContext.triggerData, customer_email: "", from: "" }
    };
    
    try {
      await stepProcessor.executeStep('send', mockConfig, noEmailContext);
      console.log("❌ Should have thrown error for missing email");
    } catch (error) {
      console.log("✅ Correctly caught missing email error:", error.message);
    }

    // No body content
    const noBodyContext = {
      ...mockContext,
      stepHistory: [
        {
          ...mockContext.stepHistory[0],
          output: {} // No body_html
        }
      ]
    };
    
    try {
      await stepProcessor.executeStep('send', mockConfig, noBodyContext);
      console.log("❌ Should have thrown error for missing body");
    } catch (error) {
      console.log("✅ Correctly caught missing body error:", error.message);
    }

  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }

  console.log("\n🎉 Send Node Testing Complete");
}

// Run the test
if (import.meta.main) {
  await testSendNode();
}