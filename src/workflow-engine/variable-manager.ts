/**
 * Variable and context management system for workflow executions
 * Handles dynamic variable resolution, context sharing, and data transformation
 */

import { ExecutionContext } from './executor.ts';

export interface VariableDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date';
  required: boolean;
  default_value?: unknown;
  description?: string;
}

export class VariableManager {
  
  /**
   * Initialize execution context with variables
   */
  initializeContext(context: ExecutionContext): void {
    // Merge trigger data with existing variables
    context.variables = {
      ...context.variables,
      ...context.triggerData,
      // Add system variables
      __execution_id: context.executionId,
      __workflow_id: context.workflowId,
      __organization_id: context.organizationId,
      __venue_id: context.venueId,
      __timestamp: new Date().toISOString(),
      __status: context.status
    };
  }

  /**
   * Resolve variables in a configuration object
   * Supports template syntax: ${variable_name} or {{variable_name}}
   */
  resolveVariables(
    config: Record<string, unknown>,
    variables: Record<string, unknown>
  ): Record<string, unknown> {
    
    return this.deepResolve(config, variables);
  }

  /**
   * Set a variable value in the execution context
   */
  setVariable(
    context: ExecutionContext,
    name: string,
    value: unknown
  ): void {
    context.variables[name] = value;
  }

  /**
   * Get a variable value from the execution context
   */
  getVariable(
    context: ExecutionContext,
    name: string
  ): unknown {
    return this.resolveVariablePath(context.variables, name);
  }

  /**
   * Validate variables against schema
   */
  validateVariables(
    variables: Record<string, unknown>,
    schema: VariableDefinition[]
  ): { valid: boolean; errors: string[] } {
    
    const errors: string[] = [];

    for (const definition of schema) {
      const value = variables[definition.name];

      // Check required variables
      if (definition.required && (value === undefined || value === null)) {
        errors.push(`Required variable '${definition.name}' is missing`);
        continue;
      }

      // Skip validation if value is undefined and not required
      if (value === undefined || value === null) {
        continue;
      }

      // Type validation
      if (!this.validateType(value, definition.type)) {
        errors.push(`Variable '${definition.name}' must be of type '${definition.type}'`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Transform variables using a transformation configuration
   */
  transformVariables(
    variables: Record<string, unknown>,
    transformations: Record<string, string>
  ): Record<string, unknown> {
    
    const result: Record<string, unknown> = { ...variables };

    for (const [targetKey, sourceExpression] of Object.entries(transformations)) {
      try {
        result[targetKey] = this.evaluateExpression(sourceExpression, variables);
      } catch (error) {
        console.warn(`Failed to transform variable '${targetKey}': ${error}`);
      }
    }

    return result;
  }

  /**
   * Extract variables from email content
   */
  extractEmailVariables(emailData: any): Record<string, unknown> {
    return {
      email_subject: emailData.subject || '',
      email_from: emailData.from || '',
      email_to: emailData.to || '',
      email_cc: emailData.cc || '',
      email_bcc: emailData.bcc || '',
      email_body: emailData.body || emailData.text || '',
      email_html: emailData.html || '',
      email_date: emailData.date || new Date().toISOString(),
      email_message_id: emailData.messageId || '',
      email_references: emailData.references || [],
      email_attachments: emailData.attachments || [],
      email_has_attachments: Boolean(emailData.attachments?.length),
      email_attachment_count: emailData.attachments?.length || 0
    };
  }

  // Private helper methods

  private deepResolve(obj: any, variables: Record<string, unknown>): any {
    if (typeof obj === 'string') {
      return this.resolveString(obj, variables);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepResolve(item, variables));
    }
    
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.deepResolve(value, variables);
      }
      return result;
    }
    
    return obj;
  }

  private resolveString(str: string, variables: Record<string, unknown>): string {
    // Handle ${variable} and {{variable}} syntax
    return str.replace(/\$\{([^}]+)\}|\{\{([^}]+)\}\}/g, (match, dollarVar, braceVar) => {
      const variableName = dollarVar || braceVar;
      const value = this.resolveVariablePath(variables, variableName);
      
      if (value === undefined || value === null) {
        return match; // Keep original if variable not found
      }
      
      return String(value);
    });
  }

  private resolveVariablePath(variables: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: any = variables;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      
      // Handle array notation: array[0]
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch;
        current = current[arrayName];
        if (Array.isArray(current)) {
          const index = parseInt(indexStr, 10);
          current = current[index];
        } else {
          return undefined;
        }
      } else {
        current = current[part];
      }
    }

    return current;
  }

  private validateType(value: unknown, type: string): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      case 'date':
        return value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)));
      default:
        return true;
    }
  }

  private evaluateExpression(expression: string, variables: Record<string, unknown>): unknown {
    // Simple expression evaluation for transformations
    // In a production system, this would use a proper expression parser
    
    // Handle simple variable references
    if (expression.startsWith('${') && expression.endsWith('}')) {
      const variableName = expression.slice(2, -1);
      return this.resolveVariablePath(variables, variableName);
    }

    // Handle string concatenation: "prefix-${variable}-suffix"
    if (expression.includes('${')) {
      return this.resolveString(expression, variables);
    }

    // Handle simple functions
    if (expression.startsWith('upper(') && expression.endsWith(')')) {
      const variableName = expression.slice(6, -1);
      const value = this.resolveVariablePath(variables, variableName);
      return typeof value === 'string' ? value.toUpperCase() : value;
    }

    if (expression.startsWith('lower(') && expression.endsWith(')')) {
      const variableName = expression.slice(6, -1);
      const value = this.resolveVariablePath(variables, variableName);
      return typeof value === 'string' ? value.toLowerCase() : value;
    }

    if (expression.startsWith('length(') && expression.endsWith(')')) {
      const variableName = expression.slice(7, -1);
      const value = this.resolveVariablePath(variables, variableName);
      if (typeof value === 'string' || Array.isArray(value)) {
        return value.length;
      }
      return 0;
    }

    // Fallback: return the expression as-is
    return expression;
  }
}