# Email Agent Server V2 - Database Structure

## Overview

All tables live in the `public` schema of Supabase project `qaymciaujneyqhsbycmp`.

---

## Core Workflow Tables

### `workflow_templates`
The top-level container. Each template belongs to an organization and defines a complete workflow.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| name | text | NO | | Template name |
| category | text | NO | | Category grouping |
| description | text | YES | | Human-readable description |
| template_definition | jsonb | NO | | Full JSON definition of the workflow |
| is_public | boolean | NO | false | Whether shared publicly |
| organization_id | uuid | YES | | Owning organization |
| created_by | uuid | YES | | Creator user |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

### `workflow_nodes`
Individual nodes on the canvas. Each node belongs to a workflow_template.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| workflow_template_id | uuid | NO | | FK to workflow_templates |
| node_type | varchar | NO | | One of: `trigger`, `agent`, `condition`, `guardrail`, `exit`, `move` |
| name | varchar | NO | | Display name |
| position_x | int | NO | 0 | Canvas X |
| position_y | int | NO | 0 | Canvas Y |
| size_width | int | NO | 200 | |
| size_height | int | NO | 80 | |
| icon | varchar | YES | | Icon identifier |
| color | varchar | YES | | Color hex |
| agent_type | varchar | YES | | For node_type=agent: `parsing`, `business_logic`, `action_execution` |
| model | varchar | YES | | AI model to use (e.g. `gpt-4o`) |
| trigger_type | varchar | YES | | For node_type=trigger: `email_received` |
| action_type | varchar | YES | | Additional action qualifier |
| max_tokens | int | YES | | Token limit for AI calls |
| is_active | boolean | YES | true | Whether node is active |
| system_prompt_type | varchar | YES | | UID referencing `prompt_template.id` -> resolved via `venue_compiled_prompt` |
| prompt | text | YES | | The user prompt field (supports `{{variables}}`) |
| guardrail_type | text | YES | | For node_type=guardrail: `subject_line`, `pre_intent` |
| condition_type | varchar | YES | | For node_type=condition: `email_sorting`, `manual_mode` |
| condition | text | YES | | The condition expression (supports `{{variables}}`) |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

### `workflow_tools`
Tool definitions on the canvas. Each tool belongs to a workflow_template and is connected to nodes via `workflow_connections`.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| workflow_template_id | uuid | YES | | FK to workflow_templates |
| tool_name | varchar | NO | | e.g. `get_availability`, `make_booking`, `get_bookings`, `edit_booking`, `make_cancellation`, `get_FAQ`, `store_message`, `Send email` |
| tool_description | text | YES | | Human description |
| tool_type | varchar | NO | | e.g. `http_request`, `postgres`, `send_email` |
| method | varchar | YES | | HTTP method: `GET`, `POST`, `PUT`, `DELETE` |
| url | text | YES | | Endpoint URL (supports `{{variables}}`) |
| tool_body | jsonb | YES | | Request body template (supports `{{variables}}`) |
| tool_headers | jsonb | YES | | Request headers (supports `{{variables}}`) |
| position_x | int | YES | | Canvas X |
| position_y | int | YES | | Canvas Y |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

### `workflow_connections`
Edges between nodes/tools on the canvas.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| workflow_template_id | uuid | NO | | FK to workflow_templates |
| source_node_id | varchar | NO | | ID of source node or tool |
| target_node_id | varchar | NO | | ID of target node or tool |
| source_handle | varchar | YES | | Output handle on source: `node_output`, `positive_node_output`, `negative_node_output`, `node_to_tool_output` |
| target_handle | varchar | YES | | Input handle on target: `node_input`, `tool_input` |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

**Handle semantics:**
- Standard nodes: `node_output` -> `node_input`
- Guardrail nodes: `positive_node_output` (passed) or `negative_node_output` (failed) as source_handle -> `node_input`
- Condition nodes: `positive_node_output` (true) or `negative_node_output` (false) as source_handle -> `node_input`
- Tool connections: `node_to_tool_output` -> `tool_input`

---

## Execution Tables

### `workflow_executions`
One row per workflow run. Updated throughout the execution lifecycle.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| workflow_id | uuid | NO | | FK to workflow_templates |
| organization_id | uuid | NO | | |
| venue_id | uuid | YES | | |
| trigger_type | text | NO | | `email_webhook`, `test`, `manual` |
| trigger_data | jsonb | NO | {} | Raw webhook payload |
| status | text | NO | 'pending' | `pending`, `completed`, `failed`, `cancelled` |
| current_step | text | YES | | Currently executing step name |
| variables | jsonb | NO | {} | Runtime variables (venueConfigWall) |
| start_time | timestamptz | NO | now() | |
| end_time | timestamptz | YES | | |
| error_message | text | YES | | |
| execution_context | jsonb | NO | {} | |
| started_at | timestamptz | YES | now() | |
| finished_at | timestamptz | YES | | |
| duration_ms | int | YES | | Total execution time |
| customer_email | text | YES | | |
| subject | text | YES | | |
| parent_execution | uuid | YES | | FK to self for reruns |

### `workflow_execution_steps`
One row per node execution within a workflow run. **This is the most important table for observability.**

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| execution_id | uuid | NO | | FK to workflow_executions |
| node_id | varchar | YES | | FK-like ref to workflow_nodes.id |
| step_name | varchar | NO | | Display name |
| step_type | varchar | NO | | Node type (agent, guardrail, condition, etc.) |
| step_order | int | NO | | Execution order |
| status | varchar | NO | 'pending' | `running`, `completed`, `failed`, `cancelled`, `skipped` |
| input_data | jsonb | YES | | What went INTO this node |
| output_data | jsonb | YES | | What came OUT of this node |
| resolved_prompt | text | YES | | **NEW** - The fully resolved prompt with all `{{variables}}` replaced |
| error_details | jsonb | YES | | Error info if failed |
| retry_count | int | YES | 0 | |
| max_retries | int | YES | 3 | |
| started_at | timestamptz | YES | | |
| completed_at | timestamptz | YES | | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| output_confidence_score | numeric | YES | | AI confidence |
| output_tokens_consumed | int | YES | | Token usage |
| output_processing_time_ms | int | YES | | Step duration |
| output_pinned | boolean | YES | false | Whether this step's output is pinned for reruns |

---

## Prompt System Tables

### `prompt_template`
Base prompt templates (global, not venue-specific).

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | NO | PK |
| agent_type | text | NO | e.g. `email_extractor`, `orchestrator`, `execution` |
| name | text | NO | Template name |
| version | int | NO | Version number |
| type | text | YES | Prompt type |
| website_url | text | YES | |
| created_at | timestamptz | YES | |
| updated_at | timestamptz | YES | |

### `prompt_section`
Sections within a prompt template (ordered, some editable per-venue).

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | NO | PK |
| template_id | uuid | NO | FK to prompt_template |
| title | text | NO | Section title |
| base_content | text | NO | Default content |
| is_editable | boolean | NO | Whether venues can override |
| order_index | int | NO | Display/compile order |

### `venue_compiled_prompt`
The final compiled prompt for a specific venue + agent_type combination.

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | NO | PK |
| venue_id | uuid | NO | |
| agent_type | text | NO | Matches prompt_template.agent_type |
| template_id | uuid | NO | FK to prompt_template |
| compiled_prompt | text | NO | The full compiled prompt text |
| checksum | text | NO | For cache invalidation |
| special_version | text | NO | Version qualifier |

**How system_prompt_type works:**
1. `workflow_nodes.system_prompt_type` contains a `prompt_template.id`
2. At runtime, look up `venue_compiled_prompt` WHERE `template_id = system_prompt_type` AND `venue_id = current_venue`
3. The `compiled_prompt` is the actual system prompt sent to the AI

### `venue_prompt_override`
Per-venue overrides of individual prompt sections.

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | NO | PK |
| venue_id | uuid | NO | |
| agent_type | text | NO | |
| template_id | uuid | NO | FK to prompt_template |
| prompt_section_id | uuid | NO | FK to prompt_section |
| override_mode | text | NO | `replace`, `append`, `prepend` |
| override_content | text | YES | The override text |
| order_index | int | YES | |

---

## Supporting Tables

### `email_processing_log`
Audit log of all email processing attempts.

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | NO | PK |
| email_account_id | uuid | NO | |
| organization_id | uuid | NO | |
| venue_id | uuid | YES | |
| email_uid | text | NO | |
| email_subject | text | YES | |
| email_from | text | NO | |
| email_to | text | NO | |
| email_date | timestamptz | NO | |
| classification | jsonb | YES | |
| workflow_execution_id | uuid | YES | |
| processing_status | text | NO | `completed`, `failed` |
| error_message | text | YES | |
| processed_at | timestamptz | YES | |
| created_at | timestamptz | NO | |

---

## Table Relationships

```
workflow_templates
  ├── workflow_nodes (workflow_template_id)
  ├── workflow_tools (workflow_template_id)
  ├── workflow_connections (workflow_template_id)
  └── workflow_executions (workflow_id)
        └── workflow_execution_steps (execution_id)

prompt_template
  ├── prompt_section (template_id)
  ├── venue_compiled_prompt (template_id)
  └── venue_prompt_override (template_id)

workflow_nodes.system_prompt_type → prompt_template.id → venue_compiled_prompt (resolved at runtime)
```
