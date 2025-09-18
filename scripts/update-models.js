#!/usr/bin/env node

/**
 * Update provider models from models.dev API
 * Filters for models suitable for agentic coding
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const MODELS_API = 'https://models.dev/api.json';
const CONFIG_PATH = path.join(__dirname, '../packages/backend/config/known-providers.yaml');
const ENDPOINTS_PATH = path.join(__dirname, '../packages/backend/config/known-api-types.yaml');

// Load known providers whitelist
let KNOWN_ENDPOINTS = {};
try {
  const endpointsConfig = yaml.load(fs.readFileSync(ENDPOINTS_PATH, 'utf8'));
  KNOWN_ENDPOINTS = endpointsConfig.endpoints || {};
} catch (error) {
  console.warn('⚠️  Could not load known providers whitelist:', error.message);
}

// Check if a model is suitable for agentic coding based on capabilities
function isAgenticModel(modelId, modelInfo) {
  // Must have tool calling capability
  if (!modelInfo.tool_call) return false;
  
  // Must have reasonable context length (at least 32k for complex tasks)
  const contextLimit = modelInfo.limit?.context || 0;
  if (contextLimit < 32000) return false;
  
  // Prefer models with reasoning capability
  const hasReasoning = modelInfo.reasoning === true;
  
  // Prefer models with attachment support (file handling)
  const hasAttachment = modelInfo.attachment === true;
  
  // Check for recent knowledge cutoff (within last 2 years)
  const knowledge = modelInfo.knowledge || '';
  const currentYear = new Date().getFullYear();
  const minRecentYear = currentYear - 1; // At least last year
  const hasRecentKnowledge = knowledge && (
    knowledge >= minRecentYear.toString() || 
    knowledge.includes(currentYear.toString()) || 
    knowledge.includes(minRecentYear.toString())
  );
  
  // Score the model based on capabilities
  let score = 0;
  if (hasReasoning) score += 4;  // Reasoning is very important for agentic tasks
  if (hasAttachment) score += 3; // File handling is crucial
  if (hasRecentKnowledge) score += 2; // Recent knowledge helps
  if (contextLimit >= 128000) score += 2; // Long context is valuable
  if (contextLimit >= 200000) score += 1; // Extra long context bonus
  
  // Higher threshold for agentic capabilities
  return score >= 5;
}

// Generate provider config from models.dev data using whitelist
function generateProviderConfig(providerId, providerInfo) {
  // Check if provider is in our whitelist
  const knownEndpoint = KNOWN_ENDPOINTS[providerId];
  if (!knownEndpoint) {
    return null; // Skip unknown providers
  }
  
  return {
    name: providerInfo.name || knownEndpoint.name || providerId,
    apiType: knownEndpoint.apiType,
    baseUrl: knownEndpoint.baseUrl,
    apiKeyEnvVar: knownEndpoint.defaultEnvVar
  };
}

async function fetchModels() {
  try {
    console.log('Fetching latest models from models.dev...');
    const response = await fetch(MODELS_API);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch models:', error.message);
    process.exit(1);
  }
}

function filterAgenticModels(modelsData) {
  const providers = {};
  let skippedProviders = 0;
  
  // Process each provider from models.dev
  for (const [providerId, providerInfo] of Object.entries(modelsData)) {
    if (!providerInfo.models) continue;
    
    // Generate provider config (returns null if not in whitelist)
    const providerConfig = generateProviderConfig(providerId, providerInfo);
    if (!providerConfig) {
      skippedProviders++;
      continue;
    }
    
    const agenticModels = [];
    
    // Check each model in the provider
    for (const [modelId, modelInfo] of Object.entries(providerInfo.models)) {
      // Check if model is suitable for agentic coding based on capabilities
      if (isAgenticModel(modelId, modelInfo)) {
        agenticModels.push(modelId);
      }
    }
    
    // Only include providers that have agentic models
    if (agenticModels.length > 0) {
      providers[providerId] = {
        ...providerConfig,
        models: agenticModels.sort()
      };
    }
  }
  
  if (skippedProviders > 0) {
    console.log(`⚠️  Skipped ${skippedProviders} providers not in whitelist`);
  }
  
  return providers;
}

function updateConfig(newProviders) {
  try {
    // Read existing config
    let config;
    if (fs.existsSync(CONFIG_PATH)) {
      const yamlContent = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = yaml.load(yamlContent);
    } else {
      config = { providers: {} };
    }
    
    // Use only the new providers from whitelist (no preservation of old config)
    config.providers = newProviders;
    
    // Add metadata
    const header = `# DevMinds.ai Provider Configuration Template
# This file is version-controlled and updated via npm scripts
# Last updated: ${new Date().toISOString().split('T')[0]}

`;
    
    const yamlContent = header + yaml.dump(config, {
      indent: 2,
      lineWidth: 100,
      noRefs: true
    });
    
    // Ensure directory exists
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    fs.writeFileSync(CONFIG_PATH, yamlContent);
    console.log(`✅ Updated ${CONFIG_PATH}`);
    
    // Log summary
    console.log('\nProvider Summary:');
    for (const [key, provider] of Object.entries(newProviders)) {
      console.log(`  ${provider.name}: ${provider.models.length} models`);
      provider.models.forEach(model => console.log(`    - ${model}`));
    }
    
  } catch (error) {
    console.error('Failed to update config:', error.message);
    process.exit(1);
  }
}

async function main() {
  console.log('🔄 Updating agentic coding models...\n');
  
  const modelsData = await fetchModels();
  console.log(`📥 Fetched ${Object.keys(modelsData).length} total models`);
  
  const agenticProviders = filterAgenticModels(modelsData);
  console.log(`🎯 Found ${Object.keys(agenticProviders).length} providers with agentic models`);
  
  updateConfig(agenticProviders);
  
  console.log('\n✨ Model update complete!');
}

if (require.main === module) {
  main().catch(console.error);
}
