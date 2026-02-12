# Email Agent Server V2 - Logging & Execution Steps

## Overview

Logging is not optional - it's a first-class feature. Every execution step must be precisely tracked in `workflow_execution_steps`. The user must be able to look at the steps table and know exactly: what input went in, what prompt was sent, what output came out, and how long it took. No ambiguity.

---

## Step Logger (`logging/step-logger.ts`)

The step logger is the single point of truth for all writes to `workflow_execution_steps`.

### Step Lifecycle

```
pending -> running -> completed
                   -> failed
                   -> cancelled (external)
                   -> skipped (cancelled before start)
```

**Status rules:**
- `pending` - Step created when execution starts, before any work
- `running` - Set immediately BEFORE the node/tool starts executing
- `completed` - Set immediately AFTER the node/tool finishes successfully
- `failed` - Set if the node/tool throws an error
- `cancelled` - Set on a running step when execution is cancelled
- `skipped` - Set on pending steps when execution is cancelled

### What Gets Logged Per Step

| Field | When Written | What It Contains |
|---|---|---|
| `status` | On every transition | Current lifecycle status |
| `started_at` | When status -> `running` | Timestamp |
| `input_data` | When status -> `running` | The input passed to the node/tool (JSON) |
| `output_data` | When status -> `completed` | The output from the node/tool (JSON) |
| `resolved_prompt` | When status -> `completed` | The fully resolved prompt sent to AI (if applicable) |
| `error_details` | When status -> `failed` | Error message and stack trace (JSON) |
| `completed_at` | When status -> `completed`/`failed`/`cancelled` | Timestamp |
| `output_confidence_score` | When status -> `completed` | AI confidence (if applicable) |
| `output_tokens_consumed` | When status -> `completed` | Token count (if AI was called) |
| `output_processing_time_ms` | When status -> `completed` | Step duration in ms |
| `output_pinned` | When step is pinned from rerun | `true` if output was reused |

### Step Logger API

```typescript
class StepLogger {
  // Called at execution start - create all steps as pending
  async createSteps(
    executionId: string, 
    graph: ExecutionGraph, 
    pinnedSteps?: PinnedStep[]
  ): Promise<void>;

  // Called when a node/tool starts
  async markRunning(
    executionId: string, 
    nodeId: string, 
    inputData: any
  ): Promise<void>;

  // Called when a node/tool completes
  async markCompleted(
    executionId: string,
    nodeId: string,
    result: {
      output_data: any;
      resolved_prompt?: string;
      tokens_consumed?: number;
      confidence_score?: number;
      processing_time_ms: number;
      pinned?: boolean;
    }
  ): Promise<void>;

  // Called when a node/tool fails
  async markFailed(
    executionId: string,
    nodeId: string,
    error: Error
  ): Promise<void>;

  // Called on cancellation - mark running as cancelled, pending as skipped
  async markCancelled(executionId: string): Promise<void>;
}
```

---

## Execution Logger (`logging/execution-logger.ts`)

Manages the parent `workflow_executions` record.

### Execution Lifecycle

```
(created) -> running -> completed
                     -> failed
                     -> cancelled
```

### What Gets Logged

| Field | When Written | What It Contains |
|---|---|---|
| `status` | On every transition | `running`, `completed`, `failed`, `cancelled` |
| `started_at` | When status -> `running` | Timestamp |
| `finished_at` | When status -> terminal | Timestamp |
| `duration_ms` | When status -> terminal | Total execution time |
| `end_time` | When status -> terminal | Same as finished_at (legacy compat) |
| `current_step` | During execution | Name of currently executing step |
| `error_message` | When status -> `failed` | Error description |
| `variables` | At creation | The initial variable context (venueConfigWall) |

### Execution Logger API

```typescript
class ExecutionLogger {
  async create(params: {
    id: string;
    workflow_id: string;
    organization_id: string;
    venue_id: string;
    trigger_type: string;
    trigger_data: any;
    variables: any;
    customer_email?: string;
    subject?: string;
    parent_execution?: string;
  }): Promise<void>;

  async markRunning(executionId: string): Promise<void>;
  async markCompleted(executionId: string): Promise<void>;
  async markFailed(executionId: string, error: string): Promise<void>;
  async markCancelled(executionId: string): Promise<void>;
  async updateCurrentStep(executionId: string, stepName: string): Promise<void>;
}
```

---

## The `resolved_prompt` Field

This is critical for debugging. When an agent node makes an AI call:

1. The node resolves all `{{variables}}` in the user prompt
2. The node resolves the system prompt from `venue_compiled_prompt`
3. Both are combined and sent to OpenAI
4. The `resolved_prompt` field stores the **fully resolved user prompt** (with all variables replaced)
5. This is written to `workflow_execution_steps.resolved_prompt`

Now when debugging: you can look at any agent step and see the exact prompt that was sent to the AI, with all variables already filled in. No guessing what `{{trigger.customer_email}}` resolved to.

---

## Guardrail Step Logging

Guardrails can loop, creating multiple step rows for the same node:

```
Step 3: guardrail_node (attempt 1) -> failed, confidence 0.4
Step 4: agent_node (retry) -> new output
Step 5: guardrail_node (attempt 2) -> passed, confidence 0.9
```

Each attempt is a separate row with incrementing `step_order`. The `retry_count` field on the guardrail step tracks which attempt it is.

---

## V1 vs V2 Logging Comparison

### V1 (Current Problems)
- Step status management is scattered across `executor.ts`, `step-processor.ts`, `agent-manager.ts`
- `pending` status exists but adds confusion - steps go `pending -> running -> completed`
- `resolved_prompt` doesn't exist - can't see what was actually sent to AI
- Tool executions are logged differently from node executions
- Some steps are created but never updated (orphaned pending steps)
- Cancellation doesn't consistently update all steps

### V2 (Clean)
- Single `StepLogger` handles all writes to `workflow_execution_steps`
- Statuses: `running`, `completed`, `failed`, `cancelled`, `skipped` (no `pending` in active use - it's just the initial state before anything runs)
- `resolved_prompt` captured for every AI call
- Tools and nodes logged through the same logger with the same format
- Cancellation cleanly marks all remaining steps
- Every field is written at the correct lifecycle point - no gaps

---

## Database Writes Summary

### On Execution Start
```sql
INSERT INTO workflow_executions (id, workflow_id, ..., status='running', started_at=now());
INSERT INTO workflow_execution_steps (execution_id, node_id, step_name, step_type, step_order, status='pending') -- one per node/tool
```

### On Each Step Start
```sql
UPDATE workflow_execution_steps 
SET status='running', started_at=now(), input_data=..., updated_at=now()
WHERE execution_id=... AND node_id=...;

UPDATE workflow_executions SET current_step=..., updated_at=now() WHERE id=...;
```

### On Each Step Completion
```sql
UPDATE workflow_execution_steps 
SET status='completed', completed_at=now(), output_data=..., resolved_prompt=...,
    output_confidence_score=..., output_tokens_consumed=..., output_processing_time_ms=...,
    updated_at=now()
WHERE execution_id=... AND node_id=...;
```

### On Step Failure
```sql
UPDATE workflow_execution_steps 
SET status='failed', completed_at=now(), error_details=..., updated_at=now()
WHERE execution_id=... AND node_id=...;
```

### On Execution Completion
```sql
UPDATE workflow_executions 
SET status='completed', finished_at=now(), end_time=now(), duration_ms=...
WHERE id=...;
```

### On Cancellation
```sql
UPDATE workflow_executions SET status='cancelled', finished_at=now(), end_time=now(), duration_ms=... WHERE id=...;
UPDATE workflow_execution_steps SET status='cancelled', completed_at=now() WHERE execution_id=... AND status='running';
UPDATE workflow_execution_steps SET status='skipped', completed_at=now() WHERE execution_id=... AND status='pending';
```
