#!/bin/bash

# Send email webhook request and capture the response
echo "Sending email webhook request..."
RESPONSE=$(curl -s -X POST http://localhost:8000/webhook/imap \
  -H "Content-Type: application/json" \
  -d '{
    "email_account_id": "test-account-123",
    "venue_id": "87619ff3-8550-49a1-b6a6-506d9448e879",
    "uid": 42,
    "from": "John Doe <john.doe@customer.co>",
    "to": "support@company.com",
    "subject": "Need help with my booking",
    "date": "2024-02-08T10:30:00Z", 
    "internalDate": "2024-02-08T10:30:00Z",
    "textPlain": "Hi, I would like to book for 2 people tomorrow at 5 o clock. Can you help me? Phone number 234234234",
    "textHtml": "<p>Hi, I would like to book for 2 people tomorrow at 5 o clock. Can you help me? Phone number +345234234</p>",
    "metadata": {
      "message-id": "<msg123@customer.com>",
      "return-path": "john.doe@customer.com",
      "references": [
        "<ref1@company.com>",
        "<ref2@company.com>"
      ]
    },
    "raw": "From: John Doe <john.doe@customer.com>\\r\\nTo: support@company.com..."
  }')

# Extract execution ID from response
EXEC_ID=$(echo "$RESPONSE" | jq -r '.workflow_execution_id')

if [ "$EXEC_ID" = "null" ] || [ -z "$EXEC_ID" ]; then
  echo "Failed to get execution ID. Response:"
  echo "$RESPONSE"
  exit 1
fi

echo "Got execution ID: $EXEC_ID"

# Wait a bit to let the workflow start
echo "Waiting 2 seconds before cancelling..."
sleep 2

# Send cancellation request
echo "Sending cancellation request..."
CANCEL_RESPONSE=$(curl -s -X POST "http://localhost:8000/cancel/$EXEC_ID")

echo "Cancellation response:"
echo "$CANCEL_RESPONSE" | jq .

# Check if cancellation was successful
SUCCESS=$(echo "$CANCEL_RESPONSE" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
  echo "✅ Cancellation successful!"
  CANCELLED_STEPS=$(echo "$CANCEL_RESPONSE" | jq -r '.cancelled_steps')
  echo "Cancelled steps: $CANCELLED_STEPS"
else
  echo "❌ Cancellation failed"
fi