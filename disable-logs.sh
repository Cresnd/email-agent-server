#!/bin/bash

# Disable all logger.info, logger.error, logger.warn, logger.debug calls
# Keep only console.log in business-logic-agent.ts

# Files to process (excluding business-logic-agent.ts)
files=(
  "src/agent-system/agent-manager.ts"
  "src/database/queries.ts"
  "src/database/tool-loader.ts"
  "src/email-processing/router.ts"
  "src/email-processing/webhook-ingestion.ts"
  "src/email-processing/pipeline-orchestrator.ts"
  "src/workflow-engine/guardrail-executor.ts"
  "src/main.ts"
  "src/realtime/websocket-server.ts"
  "src/database/connection.ts"
)

for file in "${files[@]}"; do
  echo "Processing $file..."
  # Comment out all logger calls
  sed -i '' 's/^[[:space:]]*logger\.\(info\|error\|warn\|debug\)/    \/\/ logger.\1/g' "$file"
done

echo "Logs disabled successfully!"