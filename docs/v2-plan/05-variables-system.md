# Email Agent Server V2 - Variables System

## Overview

The variable system is **global and general**. One resolver, one syntax, works everywhere: prompts, tool bodies, tool URLs, tool headers, condition expressions, and any new field added in the future.

---

## Variable Syntax

### Format: `{{reference}}`

Three patterns:

| Pattern | Meaning | Example |
|---|---|---|
| `{{node_name.parameter}}` | Access a specific field from a node's output | `{{trigger.customer_email}}` |
| `{{node_name}}` | Access the full output of a node (as JSON) | `{{parsing}}` |
| `{{global_variable}}` | Access a global variable (DB-sourced or computed) | `{{venue_id}}` |

**Disambiguation rule:** Global variable names must never collide with node names. Since node names come from the `workflow_nodes.name` column and global variables are a fixed list defined in code, this is easy to enforce.

### Examples

```
Subject: {{trigger.subject}}
Customer: {{trigger.first_name}} {{trigger.last_name}}
Venue: {{venue_name}}
Parsing result: {{parsing.extraction_result}}
Full parsing output: {{parsing}}
Current time: {{now}}
```

---

## Variable Resolution Engine (`variables/resolver.ts`)

```typescript
interface VariableContext {
  node_outputs: Map<string, any>;      // node_name -> output_data
  global_variables: Map<string, any>;  // variable_name -> value
}

class VariableResolver {
  resolve(template: string, context: VariableContext): string;
  resolveJson(json: any, context: VariableContext): any;
  resolveAll(fields: Record<string, string>, context: VariableContext): Record<string, string>;
}
```

### Resolution Algorithm

```
For each {{reference}} found in the template:
  1. Split reference by first "." -> [name, ...path]
  2. If name exists in global_variables:
     -> Return global_variables[name] (if path, drill into the value)
  3. If name exists in node_outputs:
     -> If no path: return JSON.stringify(node_outputs[name])
     -> If path: drill into node_outputs[name] using the path
  4. If not found: leave {{reference}} as-is (or log warning)
```

### Deep JSON Resolution

For tool bodies and headers (which are JSON objects), the resolver walks every string value in the JSON tree and resolves variables:

```typescript
resolveJson(obj: any, context: VariableContext): any {
  if (typeof obj === 'string') return this.resolve(obj, context);
  if (Array.isArray(obj)) return obj.map(item => this.resolveJson(item, context));
  if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.resolveJson(value, context);
    }
    return result;
  }
  return obj;
}
```

---

## Global Variables (`variables/global-variables.ts`)

Global variables are values sourced from the database or computed at execution start. They are loaded once at the beginning of each workflow execution and available everywhere via `{{variable_name}}`.

### Defined Global Variables

| Variable | Source | Description |
|---|---|---|
| `venue_id` | `workflow_executions.venue_id` | Current venue UUID |
| `venue_name` | `venues` table | Venue display name |
| `venue_address` | `venues` table | Venue address |
| `venue_description` | `venues` table | Venue description |
| `venue_timezone` | `venues` table | e.g. `Europe/Stockholm` |
| `organization_id` | `venues` table | Organization UUID |
| `organization_name` | `organizations` table | Organization name |
| `finance_email` | `venues` table | Finance email address |
| `now` | Computed | Formatted current time in venue timezone |
| `database_project_ref` | Environment variable | Supabase project ref |

### How to Add a New Global Variable

Edit `variables/global-variables.ts`:

```typescript
// 1. Add the variable definition
const GLOBAL_VARIABLE_DEFINITIONS: GlobalVariableDef[] = [
  { name: 'venue_id', source: 'execution', field: 'venue_id' },
  { name: 'venue_name', source: 'query', query: (ctx) => fetchVenueName(ctx.venue_id) },
  { name: 'now', source: 'computed', compute: (ctx) => formatNow(ctx.venue_timezone) },
  // ADD NEW VARIABLE HERE:
  { name: 'my_new_variable', source: 'query', query: (ctx) => fetchMyValue(ctx.venue_id) },
];

// 2. That's it. {{my_new_variable}} now works everywhere in prompts, tool bodies, conditions, etc.
```

No other changes needed. The resolver automatically picks up all defined global variables.

---

## Where Variables Are Resolved

Every text field that can contain `{{variables}}` goes through the resolver before being used:

| Location | Field | Resolved by |
|---|---|---|
| `workflow_nodes.prompt` | User prompt for agent nodes | `AgentNode.execute()` |
| `workflow_nodes.condition` | Condition expression | `ConditionNode.execute()` |
| `workflow_tools.url` | Tool endpoint URL | `BaseTool.execute()` |
| `workflow_tools.tool_body` | Tool request body (deep JSON) | `BaseTool.execute()` |
| `workflow_tools.tool_headers` | Tool request headers (deep JSON) | `BaseTool.execute()` |

### Making a New Field Variable-Aware

If you add a new field to `workflow_nodes` (e.g., `response_template`):

1. In the corresponding node handler, call `this.resolveVariables(node_config.response_template, variables)`
2. Done. The field now supports `{{variables}}`.

For JSON fields, use `this.resolveJsonVariables(node_config.my_json_field, variables)`.

---

## Variable Context Lifecycle

```
1. Execution starts
   -> Load global variables from DB
   -> Initialize VariableContext { global_variables, node_outputs: empty }

2. Trigger node executes
   -> Output stored: node_outputs["trigger"] = venueConfigWall
   -> Now {{trigger.subject}}, {{trigger.customer_email}}, etc. are available

3. Each subsequent node executes
   -> Receives current VariableContext
   -> Resolves its {{variables}} from context
   -> Its output is added: node_outputs["node_name"] = output_data
   -> Next node can reference this node's output

4. Tools execute
   -> Same VariableContext
   -> URL, body, headers all resolved
   -> Tool output added to context: node_outputs["tool_name"] = output_data
```

---

## Current V1 vs V2 Comparison

### V1 (Current)
- Variables use both `${...}` and `{{...}}` syntax inconsistently
- Variable resolution is scattered across `variable-manager.ts`, `step-processor.ts`, `tool-loader.ts`
- Each place re-implements resolution logic differently
- Adding a new variable-aware field means editing multiple files
- Global variables (like `venue_id`) are mixed into the trigger output, not separately addressable

### V2 (New)
- Single syntax: `{{...}}`
- Single resolver in `variables/resolver.ts`
- Every node and tool calls the same resolver
- Adding a new variable-aware field = one line of `resolveVariables()` call
- Global variables are explicitly defined and loaded from DB, separately from node outputs
- Both `{{venue_id}}` (global) and `{{trigger.venue_id}}` (from trigger output) work
