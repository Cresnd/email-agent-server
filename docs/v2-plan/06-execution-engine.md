# Email Agent Server V2 - Execution Engine

## Overview

The execution engine walks the connection graph, executes nodes and tools in order, handles branching (conditions, guardrails), and manages cancellation. It is the core orchestrator but contains no node-specific logic.

---

## Connection Resolver (`execution/connection-resolver.ts`)

Before execution begins, the connection resolver builds an execution plan from the `workflow_connections` table.

### What It Does

1. Loads all `workflow_connections` for the workflow template
2. Loads all `workflow_nodes` and `workflow_tools` for the template
3. Finds the trigger node (the entry point)
4. Builds a directed graph of connections
5. Returns the graph + the starting node

```typescript
interface ExecutionGraph {
  start_node_id: string;
  nodes: Map<string, WorkflowNode>;
  tools: Map<string, WorkflowTool>;
  connections: Map<string, Connection[]>;  // source_node_id -> outgoing connections
}

interface Connection {
  source_node_id: string;
  target_node_id: string;
  source_handle: string;  // "output", "positive", "negative"
  target_handle: string;  // "input", "positive", "negative"
}

function resolveConnections(workflowTemplateId: string): Promise<ExecutionGraph>;
```

### How Branching Works

For condition and guardrail nodes, there are multiple outgoing connections with different `source_handle` values:

```
condition_node:
  ├── [source_handle="positive"] -> node_A (condition is true)
  └── [source_handle="negative"] -> node_B (condition is false)

guardrail_node:
  ├── [source_handle="positive"] -> next_node (guardrail passed)
  └── [source_handle="negative"] -> retry_node or skip_node (guardrail failed)
```

The execution engine asks the connection resolver: "Given this node returned `result=true`, what's the next node?" The resolver looks up the connection with the matching `source_handle`.

---

## Execution Context (`execution/execution-context.ts`)

Runtime state that travels through the entire execution.

```typescript
interface ExecutionContext {
  execution_id: string;
  workflow_template_id: string;
  venue_id: string;
  organization_id: string;
  
  variables: VariableContext;
  graph: ExecutionGraph;
  
  cancelled: boolean;
  current_node_id: string | null;
  step_order: number;
  
  started_at: Date;
}
```

---

## Execution Engine (`execution/engine.ts`)

### Main Loop

```
1. Build execution graph from connections
2. Load global variables
3. Initialize execution context
4. Start at trigger node
5. LOOP:
   a. Check for cancellation
   b. Get current node/tool config
   c. Log step as "running" in workflow_execution_steps
   d. Determine handler (node registry or tool registry)
   e. Execute handler with current context
   f. Log step as "completed" with output_data, resolved_prompt, timing
   g. Add output to variable context
   h. Determine next node:
      - For standard nodes: follow "output" connection
      - For condition/guardrail: follow "positive" or "negative" based on result
      - For tools: follow "output" connection
      - If no next connection: execution complete
   i. Move to next node
6. Mark workflow_execution as "completed" with timing
```

### Pseudo-code

```typescript
class ExecutionEngine {
  async execute(executionId: string, workflowTemplateId: string, triggerData: any): Promise<void> {
    // 1. Setup
    const graph = await connectionResolver.resolveConnections(workflowTemplateId);
    const globalVars = await loadGlobalVariables(executionId);
    const context = createExecutionContext(executionId, graph, globalVars);
    
    await executionLogger.markRunning(executionId);
    
    // 2. Walk the graph
    let currentId = graph.start_node_id;
    
    while (currentId && !context.cancelled) {
      // Check cancellation
      await cancellation.checkAndAbort(context);
      
      context.step_order++;
      const isNode = graph.nodes.has(currentId);
      const isTool = graph.tools.has(currentId);
      
      // Log step start
      await stepLogger.markRunning(executionId, currentId, context.step_order);
      
      let output: NodeOutput | ToolOutput;
      
      if (isNode) {
        const nodeConfig = graph.nodes.get(currentId)!;
        const handler = getNodeHandler(nodeConfig.node_type);
        output = await handler.execute({
          node_config: nodeConfig,
          variables: context.variables,
          previous_outputs: context.variables.node_outputs,
          execution_id: executionId,
          venue_id: context.venue_id,
        });
      } else if (isTool) {
        const toolConfig = graph.tools.get(currentId)!;
        const handler = getToolHandler(toolConfig.tool_type);
        output = await handler.execute({
          tool_config: toolConfig,
          variables: context.variables,
          previous_outputs: context.variables.node_outputs,
          execution_id: executionId,
        });
      }
      
      // Log step completion
      await stepLogger.markCompleted(executionId, currentId, {
        output_data: output.data,
        resolved_prompt: output.resolved_prompt,
        tokens_consumed: output.tokens_consumed,
        confidence_score: output.confidence_score,
        processing_time_ms: output.processing_time_ms,
      });
      
      // Store output in variable context
      const name = isNode ? graph.nodes.get(currentId)!.name : graph.tools.get(currentId)!.tool_name;
      context.variables.node_outputs.set(name, output.data);
      
      // Determine next node
      currentId = this.getNextNodeId(currentId, output, graph);
    }
    
    // 3. Finalize
    if (context.cancelled) {
      await executionLogger.markCancelled(executionId);
    } else {
      await executionLogger.markCompleted(executionId);
    }
  }
  
  private getNextNodeId(currentId: string, output: any, graph: ExecutionGraph): string | null {
    const connections = graph.connections.get(currentId) || [];
    
    if (connections.length === 0) return null;
    if (connections.length === 1) return connections[0].target_node_id;
    
    // Multiple connections = branching (condition or guardrail)
    // The output.data should contain a "result" field (true/false) or "passed" (boolean)
    const passed = output.data?.result === true || output.data?.passed === true;
    const handle = passed ? 'positive' : 'negative';
    
    const matchingConnection = connections.find(c => c.source_handle === handle);
    return matchingConnection?.target_node_id || null;
  }
}
```

---

## Cancellation (`execution/cancellation.ts`)

### How Cancellation Works

1. User calls `POST /cancel/:workflow_execution_id`
2. Route handler updates `workflow_executions.status = 'cancelled'`
3. Route handler marks all `running`/`pending` steps as `cancelled`/`skipped`
4. The execution engine checks cancellation status **before each node execution**:

```typescript
async checkAndAbort(context: ExecutionContext): Promise<void> {
  // Check DB for cancellation
  const execution = await db.getWorkflowExecution(context.execution_id);
  if (execution.status === 'cancelled') {
    context.cancelled = true;
    throw new CancellationError('Execution cancelled by user');
  }
}
```

5. The engine catches `CancellationError` in the main loop and exits cleanly
6. Any remaining pending steps are marked as `skipped`

### Cancellation Guarantees
- A node that is currently mid-execution will finish (we don't interrupt AI calls)
- The next node will NOT start
- All pending steps get marked as `skipped`
- The execution gets marked as `cancelled` with timing data

---

## Guardrail Looping

Guardrail nodes can loop. When a guardrail fails (routes via `negative` handle), the connection might point back to an earlier node. The execution engine handles this naturally because it just follows connections.

```
agent_node -> guardrail_node
                 ├── [positive] -> send_node (passed - continue)
                 └── [negative] -> agent_node (failed - retry)
```

Each loop creates a new `workflow_execution_step` row for the re-executed node. The `step_order` increments, so you can see the retry history in the steps table.

To prevent infinite loops, the engine tracks how many times each node has been visited and enforces a maximum (e.g., 5 iterations).

---

## Pinned Steps (Reruns)

When a workflow is re-run, some steps can be "pinned" - meaning their output from the previous run is reused instead of re-executing.

```typescript
// In the execution loop, before executing a node:
if (isPinned(currentId, pinnedSteps)) {
  const pinnedOutput = getPinnedOutput(currentId, pinnedSteps);
  // Skip execution, use pinned output directly
  await stepLogger.markCompleted(executionId, currentId, {
    output_data: pinnedOutput,
    output_pinned: true,
  });
  context.variables.node_outputs.set(name, pinnedOutput);
} else {
  // Normal execution
}
```

---

## Execution Flow Summary

```
POST /webhook/imap (or /outlook or /process)
  │
  ├── 1. Normalize webhook payload (email/ingestion.ts)
  ├── 2. Apply email filters (email/filtering.ts)
  ├── 3. Create workflow_execution record
  ├── 4. Create initial workflow_execution_steps (all pending)
  │
  └── 5. ExecutionEngine.execute()
          │
          ├── Build connection graph
          ├── Load global variables
          │
          └── Walk graph:
              trigger -> agent(parsing) -> guardrail -> agent(orchestrator) -> tool(get_availability) -> agent(execution) -> send
              
              Each step:
                ├── Check cancellation
                ├── Mark step running
                ├── Execute node/tool handler
                ├── Mark step completed (with output, resolved_prompt, timing)
                ├── Store output in variable context
                └── Follow connection to next node
```
