import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.1';

const supabaseUrl = 'https://qaymciaujneyqhsbycmp.supabase.co';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, supabaseKey);

// Get the latest workflow execution
const { data: executions } = await supabase
  .from('workflow_executions')
  .select('id, created_at, status')
  .order('created_at', { ascending: false })
  .limit(1);

if (executions && executions.length > 0) {
  const latestId = executions[0].id;
  console.log(`\nLatest execution: ${latestId}`);
  console.log(`Status: ${executions[0].status}`);
  console.log(`Created: ${executions[0].created_at}`);
  
  // Get the steps
  const { data: steps } = await supabase
    .from('workflow_execution_steps')
    .select('node_name, node_type, status, output_data')
    .eq('workflow_execution_id', latestId)
    .order('created_at');
  
  console.log('\n=== Workflow Steps ===');
  for (const step of steps || []) {
    console.log(`\n${step.node_name} (${step.node_type}) - Status: ${step.status}`);
    if (step.output_data) {
      console.log('Output Data:', JSON.stringify(step.output_data, null, 2));
    }
  }
}