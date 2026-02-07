# Email Agent Server

A deterministic, real-time workflow execution system for email processing and agent orchestration, designed to integrate with the Elyra AI v2 platform.

## Architecture Overview

This server implements an n8n-style workflow execution system specifically designed for email automation and AI agent orchestration.

## Project Structure

```
email-agent-server/
├── src/                          # Source code
│   ├── workflow-engine/          # Core workflow execution engine
│   │   ├── executor.ts           # Main workflow execution logic
│   │   ├── step-processor.ts     # Individual step execution
│   │   ├── variable-manager.ts   # Context and variable handling
│   │   ├── retry-manager.ts      # Retry and error recovery
│   │   └── scheduler.ts          # Workflow scheduling system
│   ├── email-processing/         # Email processing pipeline
│   │   ├── classifier.ts         # AI-powered email classification
│   │   ├── entity-extractor.ts   # Email entity extraction
│   │   ├── router.ts             # Workflow routing logic
│   │   ├── imap-client.ts        # IMAP email fetching
│   │   └── parser.ts             # Email parsing and normalization
│   ├── agent-system/             # Agent orchestration
│   │   ├── agent-manager.ts      # Agent lifecycle management
│   │   ├── execution-tracker.ts  # Agent execution monitoring
│   │   ├── performance.ts        # Performance metrics collection
│   │   └── registry.ts           # Agent type registry
│   ├── api/                      # REST API endpoints
│   │   ├── workflows/            # Workflow management endpoints
│   │   ├── executions/           # Execution monitoring APIs
│   │   ├── agents/               # Agent management APIs
│   │   ├── emails/               # Email processing APIs
│   │   └── health/               # Health check endpoints
│   ├── realtime/                 # Real-time communication
│   │   ├── websocket-server.ts   # WebSocket server implementation
│   │   ├── event-publisher.ts    # Event broadcasting system
│   │   └── channels.ts           # Channel management
│   ├── database/                 # Database layer
│   │   ├── migrations/           # Database schema migrations
│   │   ├── queries/              # Optimized database queries
│   │   ├── connection.ts         # Database connection management
│   │   └── triggers.ts           # Real-time update triggers
│   ├── utils/                    # Utility functions
│   │   ├── logger.ts             # Structured logging
│   │   ├── encryption.ts         # Data encryption utilities
│   │   ├── validation.ts         # Input validation schemas
│   │   └── metrics.ts            # Performance metrics
│   ├── types/                    # TypeScript type definitions
│   │   ├── workflow.ts           # Workflow-related types
│   │   ├── email.ts              # Email processing types
│   │   ├── agent.ts              # Agent system types
│   │   └── api.ts                # API request/response types
│   ├── config/                   # Configuration management
│   │   ├── environment.ts        # Environment variable handling
│   │   ├── database.ts           # Database configuration
│   │   └── agents.ts             # Agent configuration
│   └── main.ts                   # Application entry point
├── tests/                        # Test suites
│   ├── unit/                     # Unit tests
│   ├── integration/              # Integration tests
│   └── e2e/                      # End-to-end tests
├── docs/                         # Documentation
│   ├── api/                      # API documentation
│   ├── workflows/                # Workflow guides
│   └── deployment/               # Deployment guides
├── scripts/                      # Build and utility scripts
│   ├── build.ts                  # Build script
│   ├── deploy.ts                 # Deployment script
│   └── db-migrate.ts             # Database migration script
├── deployments/                  # Deployment configurations
│   ├── docker/                   # Docker configurations
│   ├── kubernetes/               # K8s manifests
│   └── edge-functions/           # Supabase Edge Function configs
├── .github/workflows/            # CI/CD workflows
├── deno.json                     # Deno configuration
├── docker-compose.yml            # Local development setup
└── README.md                     # This file
```

## Technology Stack

- **Runtime**: Deno (TypeScript-first runtime)
- **Database**: Supabase/PostgreSQL with real-time subscriptions
- **Real-time**: WebSockets + Supabase Realtime
- **Email**: IMAP/SMTP with OAuth support
- **AI**: Integration with existing Elyra AI agents
- **Deployment**: Supabase Edge Functions + Docker

## Key Features

### Workflow Engine
- **Deterministic Execution**: Every step tracked and reproducible
- **Visual Workflow Builder**: N8n-style drag-and-drop interface
- **Real-time Monitoring**: Live execution status and performance metrics
- **Error Recovery**: Automatic retry and error handling
- **Variable Management**: Dynamic variable resolution and context sharing

### Email Processing
- **Smart Classification**: AI-powered email categorization
- **Entity Extraction**: Automatic extraction of bookings, dates, contacts
- **Multi-Provider Support**: IMAP, Gmail API, Outlook Graph API
- **Real-time Ingestion**: Live email processing with minimal latency

### Agent Orchestration
- **Agent Registry**: Centralized agent management and discovery
- **Execution Tracking**: Detailed performance monitoring
- **Load Balancing**: Intelligent agent selection and workload distribution
- **Performance Analytics**: Real-time metrics and reporting

## Getting Started

### Prerequisites
- Deno 1.40+
- Supabase account and project
- Email account credentials (IMAP/SMTP)

### Installation
```bash
# Clone the repository
git clone <repository-url>
cd email-agent-server

# Install dependencies
deno install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
deno run scripts/db-migrate.ts

# Start development server
deno run --allow-all src/main.ts
```

## Integration with Elyra AI v2

This server integrates seamlessly with the main Elyra AI v2 platform:

1. **Shared Database**: Uses the same Supabase instance for data consistency
2. **Authentication**: Leverages existing Supabase Auth integration
3. **Organization/Venue Context**: Links to existing organization and venue structures
4. **Agent Integration**: Extends the existing AI agent framework
5. **Real-time Updates**: Publishes events to the main dashboard

## API Documentation

The server exposes RESTful APIs for:
- Workflow management (CRUD operations)
- Execution monitoring and control
- Agent configuration and monitoring
- Email processing status
- Real-time event subscriptions

Detailed API documentation is available in `docs/api/`.

## Development Guidelines

### Code Style
- Use TypeScript strict mode
- Follow functional programming patterns where possible
- Implement comprehensive error handling
- Write unit tests for all business logic

### Database Operations
- Use transactions for multi-step operations
- Implement proper indexing for performance
- Use Row Level Security (RLS) for access control
- Maintain audit trails for all operations

### Real-time Features
- Use WebSockets for live updates
- Implement proper connection management
- Handle reconnection scenarios
- Optimize for low latency

## Monitoring and Observability

- **Structured Logging**: JSON-based logs with trace IDs
- **Performance Metrics**: Execution times, success rates, error rates
- **Health Checks**: Comprehensive health monitoring endpoints
- **Alerting**: Integration with existing monitoring systems

## Security

- **Input Validation**: Comprehensive request validation
- **Authentication**: JWT-based authentication with Supabase
- **Authorization**: Role-based access control (RBAC)
- **Data Encryption**: Sensitive data encryption at rest and in transit
- **Audit Logging**: Complete audit trails for compliance

## Deployment

The server can be deployed in multiple ways:
- **Supabase Edge Functions**: Serverless deployment for individual functions
- **Docker Containers**: Full-featured deployment with all services
- **Kubernetes**: Scalable deployment with orchestration

See `docs/deployment/` for detailed deployment guides.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes with tests
4. Submit a pull request

## License

This project is part of the Elyra AI platform. All rights reserved.