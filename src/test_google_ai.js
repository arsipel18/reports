import dotenv from 'dotenv';
import GoogleAIService from './google_ai.js';

dotenv.config();

console.log('🤖 Testing Google AI...');

async function testGoogleAI() {
    try {
        console.log('📡 Initializing Google AI service...');
        const googleAI = new GoogleAIService();
        
        console.log('🔍 Testing health check...');
        const healthCheck = await googleAI.healthCheck();
        
        if (healthCheck.status === 'healthy') {
            console.log('✅ Google AI is working correctly!');
            console.log(`  → Model: ${healthCheck.model}`);
            console.log(`  → Response: ${JSON.stringify(healthCheck.response)}`);
            console.log(`  → Usage: ${healthCheck.usage.total_tokens} tokens`);
        } else {
            console.log('❌ Google AI health check failed:', healthCheck.error);
        }
        
        console.log('\n🎉 Google AI test completed successfully!');
        
    } catch (error) {
        console.error('❌ Google AI test failed:', error.message);
        
        if (error.message.includes('API key')) {
            console.log('\n🛠️ API Key issue - possible fixes:');
            console.log('1. Get API key from: https://makersuite.google.com/app/apikey');
            console.log('2. Add GOOGLE_AI_API_KEY to your .env file');
            console.log('3. Make sure the API key is valid and has proper permissions');
        } else if (error.message.includes('quota')) {
            console.log('\n🛠️ Quota issue - possible fixes:');
            console.log('1. Check your Google AI quota limits');
            console.log('2. Wait for quota reset or upgrade your plan');
        }
    }
}

testGoogleAI();
