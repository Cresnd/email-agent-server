# Email Agent Server V2 - Tools System

## Overview

Tools are external actions that can be connected to agent nodes on the canvas. They are defined in the `workflow_tools` table and connected to nodes via `workflow_connections`. Each tool type has its own handler file.

---

## BaseTool (`tools/base-tool.ts`)

```typescript
interface ToolInput {
  tool_config: WorkflowTool;           // Row from workflow_tools
  variables: VariableContext;           // All resolved variables
  previous_outputs: Map<string, any>;  // Outputs from connected nodes
  execution_id: string;
}

interface ToolOutput {
  data: any;                 // Response data
  success: boolean;
  error?: string;
  processing_time_ms: number;
}

abstract class BaseTool {
  abstract execute(input: ToolInput): Promise<ToolOutput>;
  
  // Shared utilities:
  protected resolveVariables(template: string, context: VariableContext): string;
  protected resolveJsonVariables(json: any, context: VariableContext): any;
}
```

What `BaseTool` provides:
- Variable resolution for URL, body, and headers
- Deep JSON variable resolution (walks entire JSON objects and resolves `{{variables}}` in all string values)
- Consistent output shape
- Error handling and timing

---

## Tool Types

### HTTP Request Tool (`tools/http-request-tool.ts`)
**tool_type = "http_request"**

Makes HTTP requests to external APIs.

- **Uses from workflow_tools row:**
  - `method` - GET, POST, PUT, DELETE
  - `url` - Target URL (supports `{{variables}}`)
  - `tool_body` - JSON body (all string values support `{{variables}}`)
  - `tool_headers` - JSON headers (all string values support `{{variables}}`)

- **Behavior:**
  1. Resolve `{{variables}}` in URL
  2. Deep-resolve `{{variables}}` in body JSON (walk every string value)
  3. Resolve `{{variables}}` in headers
  4. Make HTTP request
  5. Parse response
  6. Return response data

### Postgres Query Tool (`tools/postgres-query-tool.ts`)
**tool_type = "postgres_query"**

Executes SQL queries against the Supabase database.

- **Uses from workflow_tools row:**
  - `tool_body` - Contains the SQL query template (supports `{{variables}}`)
  - `url` - Database connection string or project ref

- **Behavior:**
  1. Resolve `{{variables}}` in SQL query
  2. Execute against Supabase
  3. Return result rows

### Edge Function Tool (`tools/edge-function-tool.ts`)
**tool_type = "edge_function"**

Invokes Supabase Edge Functions.

- **Uses from workflow_tools row:**
  - `url` - Edge function URL
  - `tool_body` - JSON payload (supports `{{variables}}`)
  - `tool_headers` - Additional headers

- **Behavior:**
  1. Resolve `{{variables}}` in body
  2. Call edge function with auth headers
  3. Return response

---

## Tool Registry (`tools/registry.ts`)

```typescript
export const TOOL_REGISTRY: Record<string, new () => BaseTool> = {
  http_request: HttpRequestTool,
  postgres_query: PostgresQueryTool,
  edge_function: EdgeFunctionTool,
};

export function getToolHandler(toolType: string): BaseTool {
  const Handler = TOOL_REGISTRY[toolType];
  if (!Handler) throw new Error(`Unknown tool type: ${toolType}`);
  return new Handler();
}
```

### Adding a New Tool Type
1. Create `tools/my-new-tool.ts` extending `BaseTool`
2. Implement `execute(input: ToolInput): Promise<ToolOutput>`
3. Add to `TOOL_REGISTRY` in `tools/registry.ts`
4. Done.

---

## How Tools Are Connected

Tools are connected to agent nodes via `workflow_connections`:
```
agent_node --[output]--> tool --[output]--> next_node
```

When the execution engine reaches a tool (identified because its ID is in `workflow_tools` not `workflow_nodes`), it:
1. Looks up the tool config from `workflow_tools`
2. Gets the tool handler from the registry
3. Passes the current variable context and previous outputs
4. Executes the tool
5. Stores the tool output in the execution context (referenceable as `{{tool_name.field}}`)
6. Logs the tool execution as a step in `workflow_execution_steps`

---

## Variable Resolution in Tools

Tools use the same `{{variable}}` syntax as nodes. The deep JSON resolver handles nested structures:

```json
// workflow_tools.tool_body (stored in DB):
{
  "venue_id": "{{venue_id}}",
  "date": "{{orchestrator.date}}",
  "guest_count": "{{orchestrator.guest_count}}",
  "customer": {
    "name": "{{trigger.first_name}} {{trigger.last_name}}",
    "email": "{{trigger.customer_email}}"
  }
}

// After resolution at runtime:
{
  "venue_id": "abc-123",
  "date": "2025-03-15",
  "guest_count": "4",
  "customer": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

The `resolveJsonVariables` method in `BaseTool` recursively walks the JSON and resolves all string values. This means you can put `{{variables}}` in any string field at any depth.
