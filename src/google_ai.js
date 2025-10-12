import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

class GoogleAIService {
  constructor() {
    // Initialize Google AI with API key
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    
    // Get the generative model
    this.model = this.genAI.getGenerativeModel({ 
      model: process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash-001',
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.1,
        topP: 0.8,
        topK: 40,
        responseMimeType: 'application/json'
      }
    });
    
    console.log(`🤖 Google AI service initialized with model: ${process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash-001'}`);
  }

  /**
   * Make a chat completion request to Google AI
   * @param {Object} options - Chat completion options
   * @param {string} options.system - System message
   * @param {string} options.user - User message
   * @param {number} options.max_tokens - Maximum tokens to generate (default: 400)
   * @param {number} options.temperature - Temperature for randomness (default: 0.1)
   * @returns {Object} - { json: parsed response, usage: token usage info }
   */
  async chatJSON({ system, user, max_tokens = 400, temperature = 0.1 }) {
    try {
      console.log(`🔄 Making Google AI request with model: ${process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash-001'}`);
      
      // Combine system and user messages
      const combinedPrompt = `${system}\n\nUser Request:\n${user}`;
      
      // Make the request
      const result = await this.model.generateContent(combinedPrompt);
      const response = await result.response;
      const content = response.text();
      
      // Parse JSON response
      let parsedJson;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseError) {
        console.error('❌ Failed to parse Google AI response as JSON:', content);
        throw new Error(`Invalid JSON response: ${parseError.message}`);
      }

      // Extract usage information
      const usage = response.usageMetadata || {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0
      };
      
      // Calculate cost (approximate - Google AI pricing)
      const cost = this.calculateCost(usage.promptTokenCount, usage.candidatesTokenCount);
      
      console.log(`✅ Google AI success - Tokens: ${usage.totalTokenCount}, Cost: $${cost.toFixed(6)}`);

      return {
        json: parsedJson,
        usage: {
          prompt_tokens: usage.promptTokenCount || 0,
          completion_tokens: usage.candidatesTokenCount || 0,
          total_tokens: usage.totalTokenCount || 0,
          cost_usd: cost,
          model: process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash-001'
        }
      };

    } catch (error) {
      console.error('❌ Google AI request error:', error.message);
      throw new Error(`Google AI error: ${error.message}`);
    }
  }

  /**
   * Calculate approximate cost based on token usage
   * @param {number} inputTokens - Number of input tokens
   * @param {number} outputTokens - Number of output tokens
   * @returns {number} - Cost in USD
   */
  calculateCost(inputTokens, outputTokens) {
    // Google AI Gemini pricing (as of 2024)
    // Input: $0.075 per 1M tokens
    // Output: $0.30 per 1M tokens
    const inputCostPerMillion = 0.075;
    const outputCostPerMillion = 0.30;
    
    const inputCost = (inputTokens / 1_000_000) * inputCostPerMillion;
    const outputCost = (outputTokens / 1_000_000) * outputCostPerMillion;
    return inputCost + outputCost;
  }

  /**
   * Make a chat completion request with retry logic
   * @param {Object} options - Chat completion options
   * @param {number} maxRetries - Maximum number of retries (default: 2)
   * @returns {Object} - { json, usage } or null if all retries failed
   */
  async chatJSONWithRetry(options, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await this.chatJSON(options);
      } catch (error) {
        console.warn(`⚠️ Google AI attempt ${attempt} failed:`, error.message);
        
        if (attempt <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`❌ All ${maxRetries + 1} attempts failed for Google AI`);
          return null;
        }
      }
    }
  }

  /**
   * Health check for Google AI API
   */
  async healthCheck() {
    try {
      const result = await this.chatJSON({
        system: 'You are a helpful assistant. Respond with valid JSON.',
        user: 'Return {"status": "ok", "message": "API is working"}',
        max_tokens: 50
      });
      
      return {
        status: 'healthy',
        model: process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash-001',
        response: result.json,
        usage: result.usage
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Get model information
   */
  getModelInfo() {
    return {
      model: process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash-001',
      provider: 'Google AI',
      pricing: {
        input_per_million: 0.075,
        output_per_million: 0.30
      }
    };
  }
}

export default GoogleAIService;
