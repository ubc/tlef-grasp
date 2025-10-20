# TLEF GRASP Deployment Checklist

## Environment Variables Required

Create a `.env` file in the project root with the following variables:

```bash
# Server Configuration
TLEF_GRASP_PORT=8070
SESSION_SECRET=your-secure-secret-key-here

# Ollama Configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:latest

# Qdrant Configuration
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION_NAME=question-generation-collection

# UBC GenAI Toolkit Configuration
EMBEDDINGS_MODEL=fast-bge-small-en-v1.5
VECTOR_SIZE=384
DISTANCE_METRIC=Cosine

# Debug Configuration
DEBUG=false
NODE_ENV=production
```

## Prerequisites

### 1. Ollama Service

- **Install**: Download and install Ollama from https://ollama.ai
- **Model**: Pull the required model: `ollama pull llama3.2:latest`
- **Start**: Ensure Ollama is running on port 11434
- **Test**: `curl http://localhost:11434/api/tags`

### 2. Qdrant Vector Database

- **Install**: `docker run -p 6333:6333 qdrant/qdrant`
- **Test**: Visit http://localhost:6333/dashboard
- **Collection**: The system will auto-create the collection on first use

### 3. Node.js Dependencies

- **Install**: `npm install`
- **UBC Toolkit**: Ensure all UBC GenAI Toolkit modules are installed:
  - `ubc-genai-toolkit-rag`
  - `ubc-genai-toolkit-embeddings`
  - `ubc-genai-toolkit-chunking`
  - `ubc-genai-toolkit-core`
  - `ubc-genai-toolkit-llm`

## Deployment Steps

### 1. Environment Setup

```bash
# Copy environment template
cp env.example .env

# Edit with your values
nano .env
```

### 2. Service Verification

```bash
# Check Ollama
curl http://localhost:11434/api/tags

# Check Qdrant
curl http://localhost:6333/collections

# Check Node.js
node --version
npm --version
```

### 3. Start Application

```bash
# Development
npm run dev

# Production
npm start
```

### 4. Health Check

```bash
# Test question generation endpoint
curl -X POST http://localhost:8070/api/rag-llm/generate-with-rag \
  -H "Content-Type: application/json" \
  -d '{"objective": "Test", "content": "Test content", "bloomLevel": "Understand", "course": "CHEM 121"}'
```

## Troubleshooting

### 500 Error on Question Generation

1. **Check Ollama**: Ensure it's running and accessible
2. **Check Qdrant**: Verify the vector database is running
3. **Check Environment**: Ensure all required env vars are set
4. **Check Logs**: Look for specific error messages in server logs
5. **Check Dependencies**: Verify UBC GenAI Toolkit modules are installed

### Common Issues

- **Ollama not running**: Start Ollama service
- **Qdrant connection failed**: Check if Qdrant is running on port 6333
- **Model not found**: Pull the required model with `ollama pull llama3.2:latest`
- **Permission errors**: Check file permissions for uploads directory
- **Memory issues**: Ensure sufficient RAM for Ollama and Qdrant

## Production Considerations

### Security

- Use strong `SESSION_SECRET`
- Enable HTTPS in production
- Set secure cookie options
- Use environment-specific configurations

### Performance

- Monitor Ollama memory usage
- Configure Qdrant for production scale
- Set appropriate chunk sizes for your content
- Consider load balancing for high traffic

### Monitoring

- Set up logging for production
- Monitor Ollama and Qdrant health
- Track question generation success rates
- Monitor response times
