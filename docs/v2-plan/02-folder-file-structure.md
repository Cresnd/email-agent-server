# Email Agent Server V2 - Folder & File Structure

## Design Principles

1. **One file per node type, one file per tool type** - easy to find and edit specific behavior
2. **Base classes for shared logic** - `BaseNode` and `BaseTool` hold common patterns
3. **Connection resolution is its own module** - builds the execution plan from connections
4. **Variable resolution is global** - one system that works everywhere (prompts, tool bodies, conditions)
5. **Execution engine is separate from node logic** - orchestrates the flow, delegates to nodes
6. **Database layer is thin** - simple query functions, no business logic in DB layer
7. **Flat where possible** - no deeply nested folders

---

## Proposed Structure

```
email-agent-server-v2/
├── deno.json
├── src/
│   ├── main.ts                          # Entry point: Oak server, routes, middleware
│   │
│   ├── config/
│   │   └── environment.ts               # Env vars, validation, typed config
│   │
│   ├── database/
│   │   ├── client.ts                    # Supabase client singleton
│   │   ├── queries/
│   │   │   ├── workflow-templates.ts     # CRUD for workflow_templates
│   │   │   ├── workflow-nodes.ts         # CRUD for workflow_nodes
│   │   │   ├── workflow-tools.ts         # CRUD for workflow_tools
│   │   │   ├── workflow-connections.ts   # CRUD for workflow_connections
│   │   │   ├── workflow-executions.ts    # CRUD for workflow_executions
│   │   │   ├── execution-steps.ts       # CRUD for workflow_execution_steps
│   │   │   ├── prompts.ts               # prompt_template + venue_compiled_prompt lookups
│   │   │   └── venue-config.ts          # Venue settings, email accounts, filtering rules
│   │   └── types.ts                     # DB row types (generated or manual)
│   │
│   ├── nodes/
│   │   ├── base-node.ts                 # BaseNode abstract class (shared input/output, logging, variable resolution)
│   │   ├── registry.ts                  # Maps node_type string -> node handler class
│   │   ├── types.ts                     # NodeInput, NodeOutput, NodeContext interfaces
│   │   ├── trigger-node.ts              # node_type = "trigger"
│   │   ├── agent-node.ts               # node_type = "agent" (dispatches to agent_type)
│   │   ├── condition-node.ts            # node_type = "condition"
│   │   ├── guardrail-node.ts            # node_type = "guardrail"
│   │   ├── send-node.ts                # node_type = "send"
│   │   ├── delay-node.ts               # node_type = "delay"
│   │   └── webhook-node.ts             # node_type = "webhook"
│   │
│   ├── tools/
│   │   ├── base-tool.ts                 # BaseTool abstract class (shared HTTP, variable resolution, logging)
│   │   ├── registry.ts                  # Maps tool_type string -> tool handler class
│   │   ├── types.ts                     # ToolInput, ToolOutput, ToolContext interfaces
│   │   ├── http-request-tool.ts         # tool_type = "http_request"
│   │   ├── postgres-query-tool.ts       # tool_type = "postgres_query"
│   │   └── edge-function-tool.ts        # tool_type = "edge_function"
│   │
│   ├── variables/
│   │   ├── resolver.ts                  # Main variable resolution engine
│   │   ├── global-variables.ts          # Global variable definitions + DB queries (venue_id, now, etc.)
│   │   └── types.ts                     # VariableContext, ResolvedVariable interfaces
│   │
│   ├── execution/
│   │   ├── engine.ts                    # Main execution loop: walks connections, executes nodes
│   │   ├── connection-resolver.ts       # Builds execution plan from workflow_connections
│   │   ├── execution-context.ts         # Runtime state: variables, step outputs, cancellation flag
│   │   └── cancellation.ts             # Cancellation check + cleanup logic
│   │
│   ├── logging/
│   │   ├── step-logger.ts              # Writes to workflow_execution_steps (status, input, output, resolved_prompt)
│   │   └── execution-logger.ts         # Writes to workflow_executions (status, timing, errors)
│   │
│   ├── routes/
│   │   ├── webhook.ts                   # POST /webhook/imap, POST /webhook/outlook
│   │   ├── execute.ts                   # POST /process (manual), GET /status/:id
│   │   ├── cancel.ts                    # POST /cancel/:workflow_execution_id
│   │   └── health.ts                    # GET /health
│   │
│   ├── email/
│   │   ├── ingestion.ts                 # Normalize IMAP/Outlook payloads into common format
│   │   ├── filtering.ts                 # Email ignore lists, domain blocks, sorting rules
│   │   └── sender.ts                    # SMTP/Outlook send, draft creation, folder moves
│   │
│   └── ai/
│       └── openai.ts                    # OpenAI API wrapper (chat completions, JSON mode)
│
└── docs/
    └── v2-plan/
        └── (these planning docs)
```

---

## Key Design Decisions

### Why one file per node type?
When you need to change how a guardrail node works, you open `nodes/guardrail-node.ts`. When you add a new node type, you create a new file and register it in `nodes/registry.ts`. No hunting through a 1000-line switch statement.

### Why a registry pattern?
```typescript
// nodes/registry.ts
const NODE_REGISTRY: Record<string, typeof BaseNode> = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  guardrail: GuardrailNode,
  send: SendNode,
  delay: DelayNode,
  webhook: WebhookNode,
};
```
The execution engine just does `NODE_REGISTRY[node.node_type]` and calls `.execute()`. Adding a new node type = add file + one line in registry.

### Why separate `variables/` from `execution/`?
Variables are used by nodes, tools, AND the execution engine. Keeping them separate means any of those can import and use the resolver without circular dependencies.

### Why `logging/` as its own module?
Logging to the database is critical and should not be tangled with business logic. The step logger handles all writes to `workflow_execution_steps`, ensuring consistent status transitions and proper `resolved_prompt` capture.

### Why `routes/` instead of inline routing?
Current V1 has route handlers mixed with business logic in router.ts. V2 keeps routes as thin dispatchers - they parse the request, call the appropriate service, and format the response.
