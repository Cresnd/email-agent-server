# Email Agent Server V2 - Nodes System

## Overview

Nodes are the processing units on the workflow canvas. Each node type has its own file with a class that extends `BaseNode`. The execution engine calls the node, the node does its work, and returns an output.

---

## BaseNode (`nodes/base-node.ts`)

```typescript
interface NodeInput {
  node_config: WorkflowNode;           // Row from workflow_nodes
  variables: VariableContext;           // All resolved variables so far
  previous_outputs: Map<string, any>;  // Map of node_id -> output_data
  execution_id: string;
  venue_id: string;
}

interface NodeOutput {
  data: any;                  // The output data (stored in execution_steps.output_data)
  resolved_prompt?: string;   // The resolved prompt if AI was called (stored in execution_steps.resolved_prompt)
  tokens_consumed?: number;
  confidence_score?: number;
  processing_time_ms: number;
}

abstract class BaseNode {
  abstract execute(input: NodeInput): Promise<NodeOutput>;
  
  // Shared utilities available to all nodes:
  protected resolveVariables(template: string, context: VariableContext): string;
  protected resolveSystemPrompt(system_prompt_type: string, venue_id: string): Promise<string>;
}
```

What `BaseNode` provides:
- Variable resolution via the global resolver (so every node automatically supports `{{variables}}`)
- System prompt resolution (looks up `venue_compiled_prompt` by `system_prompt_type` + `venue_id`)
- Structured output format (every node returns the same shape)

---

## Node Types

### Trigger Node (`nodes/trigger-node.ts`)
**node_type = "trigger"**

The entry point of every workflow. Does not do AI processing.

- **Input**: Raw webhook payload + venue config wall
- **Output**: The full venue config wall (all variables available for downstream nodes)
- **Behavior**: Assembles all venue configuration, email data, and metadata into a flat object. This becomes the output that all downstream nodes can reference via `{{trigger.field}}`.

Key fields in trigger output:
- `venue_id`, `venue_name`, `venue_address`, `venue_description`, `venue_timezone`
- `organization_id`, `organization_name`
- `customer_email`, `first_name`, `last_name`, `subject`, `message`, `message_for_ai`
- `conversation_id`, `email_UID`, `outlook_id`
- `venue_prompts`, `guardrails`
- `now` (formatted current time)

### Agent Node (`nodes/agent-node.ts`)
**node_type = "agent"**

The AI-powered processing node. Dispatches based on `agent_type` column.

- **Input**: Previous node outputs, variables, node config (including `system_prompt_type`, `prompt`, `model`)
- **Output**: AI response (parsed JSON or text)
- **Behavior**:
  1. Resolve system prompt: `system_prompt_type` -> `venue_compiled_prompt.compiled_prompt`
  2. Resolve user prompt: Replace all `{{variables}}` in `prompt` field
  3. Call OpenAI with resolved system prompt + resolved user prompt
  4. Parse response (JSON mode)
  5. Store `resolved_prompt` for logging

Agent types (from `agent_type` column):
- `email_extractor` - Parses email, extracts structured data (intent, names, dates, etc.)
- `orchestrator` - Makes business decisions, creates execution plan with steps
- `execution` - Generates email response, executes tools

### Condition Node (`nodes/condition-node.ts`)
**node_type = "condition"**

Evaluates a condition and routes to positive or negative path.

- **Input**: Variables, previous outputs, condition expression
- **Output**: `{ result: true | false, evaluated_condition: string }`
- **Behavior**:
  1. Resolve all `{{variables}}` in the `condition` field
  2. Evaluate the condition expression
  3. Return boolean result
  4. The execution engine uses this to follow `positive` or `negative` connection handle

Condition types (from `condition_type` column):
- Define different evaluation strategies (e.g., simple comparison, regex match, JSON path check)

### Guardrail Node (`nodes/guardrail-node.ts`)
**node_type = "guardrail"**

AI-powered content validation. Can loop (retry) if guardrail fails.

- **Input**: Content to evaluate, guardrail prompt, threshold
- **Output**: `{ passed: boolean, confidence: number, reasoning: string, retry_count: number }`
- **Behavior**:
  1. Call AI with guardrail prompt + content
  2. Parse confidence score
  3. If confidence >= threshold: route via `positive` handle
  4. If confidence < threshold: route via `negative` handle
  5. Can loop back to a previous node (the connection graph allows this)

Guardrail types (from `guardrail_type` column):
- `subject_line` - Validates email subject
- `pre_intent` - Validates before intent classification
- `post_intent` - Validates after business logic
- Custom types as needed

### Send Node (`nodes/send-node.ts`)
**node_type = "send"**

Sends an email using the venue's email infrastructure.

- **Input**: Email content (from previous agent node), email infrastructure config
- **Output**: `{ sent: boolean, message_id: string, error?: string }`
- **Behavior**:
  1. Resolve all `{{variables}}` in email subject/body/recipient fields
  2. Send via SMTP or Outlook API
  3. Optionally move email to folder, mark as seen

### Delay Node (`nodes/delay-node.ts`)
**node_type = "delay"**

Pauses execution for a configured duration.

- **Input**: Delay configuration
- **Output**: `{ delayed_ms: number }`
- **Behavior**: Waits for the configured time, checking for cancellation periodically

### Webhook Node (`nodes/webhook-node.ts`)
**node_type = "webhook"**

Makes an HTTP request to an external service.

- **Input**: URL, method, headers, body (all support `{{variables}}`)
- **Output**: HTTP response data
- **Behavior**:
  1. Resolve all `{{variables}}` in URL, headers, body
  2. Make HTTP request
  3. Return response

---

## Node Registry (`nodes/registry.ts`)

```typescript
import { TriggerNode } from './trigger-node.ts';
import { AgentNode } from './agent-node.ts';
import { ConditionNode } from './condition-node.ts';
import { GuardrailNode } from './guardrail-node.ts';
import { SendNode } from './send-node.ts';
import { DelayNode } from './delay-node.ts';
import { WebhookNode } from './webhook-node.ts';

export const NODE_REGISTRY: Record<string, new () => BaseNode> = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  guardrail: GuardrailNode,
  send: SendNode,
  delay: DelayNode,
  webhook: WebhookNode,
};

export function getNodeHandler(nodeType: string): BaseNode {
  const Handler = NODE_REGISTRY[nodeType];
  if (!Handler) throw new Error(`Unknown node type: ${nodeType}`);
  return new Handler();
}
```

### Adding a New Node Type
1. Create `nodes/my-new-node.ts` extending `BaseNode`
2. Implement `execute(input: NodeInput): Promise<NodeOutput>`
3. Add to `NODE_REGISTRY` in `nodes/registry.ts`
4. Done. The execution engine picks it up automatically.

---

## How Nodes Get Their Input

Every node receives:
1. **Its own config** - the `workflow_nodes` row (has `prompt`, `condition`, `system_prompt_type`, etc.)
2. **All previous node outputs** - a `Map<node_id, output_data>` built up during execution
3. **The variable context** - includes global variables + all node outputs accessible via `{{node_name.field}}`
4. **Execution metadata** - `execution_id`, `venue_id`

The node uses `resolveVariables()` to replace `{{placeholders}}` in any text field before processing.

---

## How Nodes Produce Their Output

Every node returns a `NodeOutput` with:
- `data` - the main output (goes into `workflow_execution_steps.output_data` and becomes referenceable as `{{this_node_name.field}}`)
- `resolved_prompt` - if the node made an AI call, this is the exact prompt that was sent (goes into `workflow_execution_steps.resolved_prompt`)
- Metadata: `tokens_consumed`, `confidence_score`, `processing_time_ms`
