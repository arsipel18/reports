import dotenv from 'dotenv';
import GoogleAIService from './google_ai.js';
import { validateAnalysis, sanitizeAnalysis } from './prompts.js';

dotenv.config();

/**
 * Test the improved AI prompts to ensure they return valid target values
 */
class PromptTester {
  constructor() {
    this.googleAI = new GoogleAIService();
  }

  async testProblematicPost() {
    console.log('🧪 Testing problematic post that caused "esea" target error...\n');
    
    // This is likely the post that caused the error
    const testPost = {
      title: "[EU] Looking for Organization in ESEA Advanced S55",
      body: "Looking for an organization to join for ESEA Advanced Season 55. I'm based in EU and have experience in competitive CS2.",
      link_flair_text: null,
      num_comments: 0,
      subreddit: "faceit"
    };

    const userPrompt = `Title: ${testPost.title}\n\nBody: ${testPost.body}`;
    
    try {
      console.log('📝 Post content:');
      console.log(`   Title: "${testPost.title}"`);
      console.log(`   Body: "${testPost.body}"`);
      console.log();
      
      console.log('🤖 Sending to AI for analysis...');
      const result = await this.googleAI.chatJSONWithRetry({
        system: `You are a precise labeller for Reddit content about FACEIT (a competitive gaming platform).

Output STRICT JSON only with these exact keys: intent, target, sentiment, category, summary, key_issues.

CRITICAL CLASSIFICATION RULES - FOLLOW EXACTLY:

1. TARGET (MOST IMPORTANT - ONLY 2 OPTIONS):
   - target MUST be EXACTLY 'faceit' if the post is about FACEIT platform/service
   - target MUST be EXACTLY 'not_faceit' if the post is about ANY other topic (ESEA, Steam, other games, etc.)
   - NEVER use any other value for target - ONLY 'faceit' or 'not_faceit'

2. INTENT:
   - intent MUST be EXACTLY 'help' if user needs assistance/support
   - intent MUST be EXACTLY 'comment' if user is just discussing/sharing opinions

3. SENTIMENT:
   - sentiment MUST be EXACTLY 'pos' (positive), 'neg' (negative), or 'neu' (neutral)
   - This refers to sentiment toward FACEIT only

4. CATEGORY (single primary category from this EXACT set):
   ['account_recovery','verification','2fa','matchmaking_issues','game_registration_issues','afk_leaver_bans','griefing','verbal_abuse','smurfs','cheaters','anti_cheat','subscriptions','faceit_shop','technical_client','platform_website','steam_issues_game_update','tournaments_leagues','esea','mission','moderation_community','feature_request','track_stats','ow2','dota2','legal_issues_gdpr','other']

CRITICAL EXAMPLES:
- Post about ESEA issues: target='not_faceit', category='esea'
- Post about FACEIT matchmaking: target='faceit', category='matchmaking_issues'
- Post about Steam problems: target='not_faceit', category='other'

FINAL WARNING:
- TARGET field MUST be EXACTLY 'faceit' or 'not_faceit' - NO OTHER VALUES ACCEPTED
- If uncertain about target, use 'not_faceit' as default
- Always return valid JSON with exactly these 6 keys`,
        user: userPrompt
      });

      console.log('✅ AI Response received');
      console.log('📊 Raw AI Analysis:', JSON.stringify(result.json, null, 2));
      
      // Test validation
      const validation = validateAnalysis(result.json, 'post');
      console.log('\n🔍 Validation Result:', validation);
      
      if (!validation.isValid) {
        console.log('⚠️ Validation failed, testing sanitization...');
        const sanitized = sanitizeAnalysis(result.json, 'post');
        console.log('🔧 Sanitized Analysis:', JSON.stringify(sanitized, null, 2));
        
        const sanitizedValidation = validateAnalysis(sanitized, 'post');
        console.log('✅ Sanitized Validation:', sanitizedValidation);
      }
      
      return validation.isValid;
      
    } catch (error) {
      console.error('❌ Test failed:', error);
      return false;
    }
  }

  async testMultipleScenarios() {
    console.log('\n🧪 Testing multiple scenarios...\n');
    
    const testCases = [
      {
        name: "ESEA Post (should be target='not_faceit', category='esea')",
        title: "ESEA Advanced Season 55 - Looking for team",
        body: "Looking for an ESEA Advanced team for Season 55. I'm a rifler with good game sense."
      },
      {
        name: "FACEIT Post (should be target='faceit', category='matchmaking_issues')",
        title: "FACEIT matchmaking is broken",
        body: "Can't find matches on FACEIT, queue times are too long and balance is terrible."
      },
      {
        name: "Steam Post (should be target='not_faceit', category='other')",
        title: "Steam client keeps crashing",
        body: "My Steam client crashes every time I try to launch CS2. Anyone else having this issue?"
      }
    ];

    for (const testCase of testCases) {
      console.log(`📝 ${testCase.name}`);
      console.log(`   Title: "${testCase.title}"`);
      
      try {
        const userPrompt = `Title: ${testCase.title}\n\nBody: ${testCase.body}`;
        
        const result = await this.googleAI.chatJSONWithRetry({
          system: `You are a precise labeller for Reddit content about FACEIT (a competitive gaming platform).

Output STRICT JSON only with these exact keys: intent, target, sentiment, category, summary, key_issues.

CRITICAL CLASSIFICATION RULES - FOLLOW EXACTLY:

1. TARGET (MOST IMPORTANT - ONLY 2 OPTIONS):
   - target MUST be EXACTLY 'faceit' if the post is about FACEIT platform/service
   - target MUST be EXACTLY 'not_faceit' if the post is about ANY other topic (ESEA, Steam, other games, etc.)
   - NEVER use any other value for target - ONLY 'faceit' or 'not_faceit'

FINAL WARNING:
- TARGET field MUST be EXACTLY 'faceit' or 'not_faceit' - NO OTHER VALUES ACCEPTED
- If uncertain about target, use 'not_faceit' as default
- Always return valid JSON with exactly these 6 keys`,
          user: userPrompt
        });

        const validation = validateAnalysis(result.json, 'post');
        console.log(`   Result: target='${result.json.target}', category='${result.json.category}'`);
        console.log(`   Valid: ${validation.isValid ? '✅' : '❌'}`);
        
        if (!validation.isValid) {
          console.log(`   Errors: ${validation.errors.join(', ')}`);
        }
        console.log();
        
      } catch (error) {
        console.log(`   Error: ${error.message}`);
        console.log();
      }
    }
  }
}

// Run tests
async function runPromptTests() {
  const tester = new PromptTester();
  
  try {
    await tester.testProblematicPost();
    await tester.testMultipleScenarios();
    console.log('✅ Prompt testing completed');
  } catch (error) {
    console.error('❌ Prompt testing failed:', error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('test_improved_prompts.js'))) {
  runPromptTests();
}

export { PromptTester };
