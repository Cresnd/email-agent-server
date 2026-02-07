import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  
  if (req.method === "POST" && url.pathname === "/webhook/imap") {
    try {
      const body = await req.json();
      console.log("Received IMAP webhook:", JSON.stringify(body, null, 2));
      
      // Simple success response
      return new Response(JSON.stringify({ 
        status: "success", 
        message: "Webhook received",
        executionId: crypto.randomUUID()
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error("Error processing webhook:", error);
      return new Response(JSON.stringify({ 
        status: "error", 
        message: "Failed to process webhook" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  return new Response("Not Found", { status: 404 });
};

console.log("Test Email Agent Server running on http://localhost:8000");
console.log("Webhook endpoint: POST /webhook/imap");

await serve(handler, { port: 8000, hostname: "localhost" });