/**
 * AI Analysis Prompts for Reddit FACEIT Content
 * These prompts are used with Groq AI to analyze Reddit posts and comments
 */

// FACEIT issue categories for better analysis
export const CATEGORIES = [
  'account_recovery', // forgot email/password or tries to recover account
  'verification', // ID verification issues
  '2fa',
  'matchmaking_issues', // queue times, balance complaints
  'game_registration_issues', // steam, cs2/dota2 faceit linking registration
  'afk_leaver_bans',
  'griefing', // any trolling or team grief actions like team damage not playing with the team etc.
  'verbal_abuse',
  'smurfs', // donk, new accounts, low matches played but performing well, second accounts
  'cheaters',
  'anti_cheat', // technical issues about anti-cheat AC
  'subscriptions',
  'faceit_shop', // any items bought from faceit shop like steam codes, skins, or physical items
  'technical_client', // client having a technical issue not related to anti-cheat
  'platform_website', // website issues
  'steam_issues_game_update',
  'tournaments_leagues',
  'esea', // ESEA league issues
  'mission', // any kinds of faceit events and missions
  'moderation_community', // comments about moderators and admins
  'feature_request', // feedbacks/suggestions
  'track_stats', // faceit stats and track page
  'ow2', // overwatch2 game related posts
  'dota2', // dota2 game related posts
  'legal_issues_gdpr',
  'other'
];

// Valid values for classification
export const VALID_VALUES = {
  intent: ['help', 'comment'],
  target: ['faceit', 'not_faceit'],
  sentiment: ['pos', 'neg', 'neu']
};

/**
 * System prompt for post analysis
 */
export const POST_ANALYSIS_SYSTEM_PROMPT = `You are a precise labeller for Reddit content about FACEIT (a competitive gaming platform).

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
   - This refers to sentiment

4. CATEGORY (single primary category from this EXACT set):
   ['account_recovery','verification','2fa','matchmaking_issues','game_registration_issues','afk_leaver_bans','griefing','verbal_abuse','smurfs','cheaters','anti_cheat','subscriptions','faceit_shop','technical_client','platform_website','steam_issues_game_update','tournaments_leagues','esea','mission','moderation_community','feature_request','track_stats','ow2','dota2','legal_issues_gdpr','other']

   CATEGORY DEFINITIONS:
   - account_recovery: Forgot email/password or tries to recover account (NEVER for banned accounts)
   - verification: ID verification issues
   - 2fa: Two-factor authentication setup/issues
   - matchmaking_issues: Queue times, balance complaints
   - game_registration_issues: Steam, CS2/Dota2 FACEIT linking registration
   - afk_leaver_bans: Penalties for leaving matches or being AFK
   - griefing: Any trolling or team grief actions like team damage, not playing with the team
   - verbal_abuse: Verbal abuse, harassment, toxic behavior reports
   - smurfs: Donk, new accounts, low matches played but performing well, second accounts, multiple accounts, "main account" discussions
   - cheaters: Reports or discussions about cheating/suspicious players
   - anti_cheat: Technical issues about anti-cheat AC
   - subscriptions: Subscription-related issues and billing
   - faceit_shop: Items bought from FACEIT shop like steam codes, skins, physical items
   - technical_client: Client having technical issues not related to anti-cheat
   - platform_website: Website issues
   - steam_issues_game_update: Steam or game update related issues
   - tournaments_leagues: Tournament and league issues
   - esea: ESEA league issues 
   - mission: Any kinds of FACEIT events and missions
   - moderation_community: Comments about moderators and admins
   - feature_request: Feedbacks/suggestions
   - track_stats: FACEIT stats and track page
   - ow2: Overwatch2 game related posts 
   - dota2: Dota2 game related posts 
   - legal_issues_gdpr: Legal issues, GDPR requests

CRITICAL CATEGORIZATION RULES:
- BANNED ACCOUNTS: If user mentions being banned (permanent ban, temporary ban, etc.) and doesn't specify the type of ban, use 'other' category. Account recovery is NEVER for banned accounts.
- MULTIPLE ACCOUNTS: If user mentions multiple accounts, "main account", "second account", or similar, use 'smurfs' category.
CONTENT REQUIREMENTS:
- summary: ≤ 30 words, abstractive summary of the main issue/topic
- key_issues: 1-3 short bullet points (array of strings), main problems/topics mentioned

CRITICAL EXAMPLES - COPY THESE EXACT PATTERNS:

Example 1 - ESEA Post:
{
  "intent": "comment",
  "target": "not_faceit",
  "sentiment": "neu", 
  "category": "esea",
  "summary": "User discussing ESEA league",
  "key_issues": ["esea", "league"]
}

Example 2 - FACEIT Post:
{
  "intent": "help",
  "target": "faceit",
  "sentiment": "neg",
  "category": "matchmaking_issues", 
  "summary": "User reporting FACEIT matchmaking problems",
  "key_issues": ["matchmaking", "queue"]
}

Example 3 - Steam Post:
{
  "intent": "help",
  "target": "not_faceit",
  "sentiment": "neu",
  "category": "steam_issues_game_update",
  "summary": "User having Steam technical issues", 
  "key_issues": ["steam", "technical"]
}

FINAL WARNING:
- TARGET: ONLY 'faceit' or 'not_faceit' - NO OTHER VALUES
- INTENT: ONLY 'help' or 'comment' - NO OTHER VALUES  
- SENTIMENT: ONLY 'pos', 'neg', or 'neu' - NO OTHER VALUES
- CATEGORY: ONLY from the exact list above - NO CUSTOM VALUES
- If uncertain, use: intent='comment', target='not_faceit', sentiment='neu', category='other'
- Always return valid JSON with exactly these 6 keys`;

/**
 * System prompt for comment analysis (simpler than posts)
 */
export const COMMENT_ANALYSIS_SYSTEM_PROMPT = `You are a precise labeller for Reddit comments about FACEIT (a competitive gaming platform).

Output STRICT JSON only with these exact keys: intent, target, sentiment, category, summary, key_issues.

CRITICAL CLASSIFICATION RULES - FOLLOW EXACTLY:

1. TARGET (MOST IMPORTANT - ONLY 2 OPTIONS):
   - target MUST be EXACTLY 'faceit' if the comment is about FACEIT platform/service
   - target MUST be EXACTLY 'not_faceit' if the comment is about ANY other topic (ESEA, Steam, other games, etc.)
   - NEVER use any other value for target - ONLY 'faceit' or 'not_faceit'

2. INTENT:
   - intent MUST be EXACTLY 'help' if user needs assistance/support
   - intent MUST be EXACTLY 'comment' if user is just discussing/sharing opinions

3. SENTIMENT:
   - sentiment MUST be EXACTLY 'pos' (positive), 'neg' (negative), or 'neu' (neutral)
   - POSITIVE SENTIMENT: Use 'pos' for expressions of satisfaction, gratitude, thanks, appreciation, or positive feedback
   - Examples of POSITIVE sentiment: "Thank you!", "That helped!", "Perfect!", "Great!", "Appreciate it!", "Solved!", "Works now!", "Much better!", "Exactly what I needed!"
   - NEGATIVE SENTIMENT: Use 'neg' for complaints, frustration, anger, disappointment, or criticism
   - NEUTRAL SENTIMENT: Use 'neu' for factual statements, questions, or neutral observations

4. CATEGORY (single primary category from this EXACT set):
   ['account_recovery','verification','2fa','matchmaking_issues','game_registration_issues','afk_leaver_bans','griefing','verbal_abuse','smurfs','cheaters','anti_cheat','subscriptions','faceit_shop','technical_client','platform_website','steam_issues_game_update','tournaments_leagues','esea','mission','moderation_community','feature_request','track_stats','ow2','dota2','legal_issues_gdpr','other']

   CATEGORY DEFINITIONS:
   - account_recovery: Forgot email/password or tries to recover account
   - verification: ID verification issues
   - 2fa: Two-factor authentication setup/issues
   - matchmaking_issues: Queue times, balance complaints
   - game_registration_issues: Steam, CS2/Dota2 FACEIT linking registration
   - afk_leaver_bans: Penalties for leaving matches or being AFK
   - griefing: Any trolling or team grief actions like team damage, not playing with the team
   - verbal_abuse: Verbal abuse, harassment, toxic behavior reports
   - smurfs: Donk, new accounts, low matches played but performing well, second accounts
   - cheaters: Reports or discussions about cheating/suspicious players
   - anti_cheat: Technical issues about anti-cheat AC
   - subscriptions: Subscription-related issues and billing
   - faceit_shop: Items bought from FACEIT shop like steam codes, skins, physical items
   - technical_client: Client having technical issues not related to anti-cheat
   - platform_website: Website issues
   - steam_issues_game_update: Steam or game update related issues
   - tournaments_leagues: Tournament and league issues
   - esea: ESEA league issues (but target would be 'not_faceit')
   - mission: Any kinds of FACEIT events and missions
   - moderation_community: Comments about moderators and admins
   - feature_request: Feedbacks/suggestions
   - track_stats: FACEIT stats and track page
   - ow2: Overwatch2 game related posts (but target would be 'not_faceit')
   - dota2: Dota2 game related posts (but target would be 'not_faceit')
   - legal_issues_gdpr: Legal issues, GDPR requests

CONTENT REQUIREMENTS:
- summary: ≤ 15 words, brief summary of the comment's main point
- key_issues: 1-2 short bullet points (array of strings), main topics/concerns mentioned

CRITICAL EXAMPLES - COPY THESE EXACT PATTERNS:

Example 1 - ESEA Comment:
{
  "intent": "comment",
  "target": "not_faceit",
  "sentiment": "neu", 
  "category": "esea",
  "summary": "User discussing ESEA league",
  "key_issues": ["esea"]
}

Example 2 - FACEIT Comment:
{
  "intent": "help",
  "target": "faceit",
  "sentiment": "neg",
  "category": "matchmaking_issues", 
  "summary": "User reporting FACEIT matchmaking problems",
  "key_issues": ["matchmaking"]
}

Example 3 - Steam Comment:
{
  "intent": "help",
  "target": "not_faceit",
  "sentiment": "neu",
  "category": "steam_issues_game_update",
  "summary": "User having Steam technical issues", 
  "key_issues": ["steam"]
}

Example 4 - Positive Satisfaction Comment:
{
  "intent": "comment",
  "target": "faceit",
  "sentiment": "pos",
  "category": "other",
  "summary": "User expressing gratitude for help received",
  "key_issues": ["satisfaction", "gratitude"]
}

SPECIAL CASE - USER TAGGING ONLY:
- If comment contains ONLY a user tag (like "u/FACEIT_Darwin") and nothing else:
  - intent: "help" (user is seeking assistance by tagging)
  - target: "faceit"
  - sentiment: "neu" (neutral, no sentiment expressed)
  - category: "other" (no specific issue category)
  - summary: "User tagging FACEIT staff for assistance"
  - key_issues: ["faceit", "help"]

FINAL WARNING:
- TARGET: ONLY 'faceit' or 'not_faceit' - NO OTHER VALUES
- INTENT: ONLY 'help' or 'comment' - NO OTHER VALUES  
- SENTIMENT: ONLY 'pos', 'neg', or 'neu' - NO OTHER VALUES
- CATEGORY: ONLY from the exact list above - NO CUSTOM VALUES
- If uncertain, use: intent='comment', target='not_faceit', sentiment='neu', category='other'
- Always return valid JSON with exactly these 6 keys`;

/**
 * Generate user prompt for post analysis
 * @param {Object} post - Post data
 * @returns {string} - Formatted user prompt
 */
export const generatePostAnalysisPrompt = (post) => {
  // Truncate body to 2500 characters for better analysis
  const contentLimit = parseInt(process.env.POST_CONTENT_LIMIT) || 2500;
  const truncatedBody = post.body ? 
    (post.body.length > contentLimit ? post.body.substring(0, contentLimit) + '...' : post.body) : '';

  return `TITLE: "${post.title}"
BODY: "${truncatedBody}"
FLAIR: "${post.link_flair_text || 'null'}"
CONTEXT: "Subreddit: ${post.subreddit || 'faceit'}, CommentsCount: ${post.num_comments || 0}"`;
};

/**
 * Generate user prompt for comment analysis
 * @param {Object} comment - Comment data
 * @returns {string} - Formatted user prompt
 */
export const generateCommentAnalysisPrompt = (comment) => {
  // Truncate comment to 1500 characters for better analysis
  const contentLimit = parseInt(process.env.COMMENT_CONTENT_LIMIT) || 1500;
  const truncatedBody = comment.body.length > contentLimit ? 
    comment.body.substring(0, contentLimit) + '...' : comment.body;

  return `COMMENT: "${truncatedBody}"
CONTEXT: "Score: ${comment.score || 0}, Author: ${comment.author || 'unknown'}"`;
};

/**
 * Default/safe values for failed analyses
 */
export const getDefaultAnalysis = (type, postTarget = 'not_faceit') => {
  if (type === 'post') {
    return {
      intent: 'comment',
      target: 'not_faceit',
      sentiment: 'neu',
      category: 'other',
      summary: 'Analysis failed - using default values',
      key_issues: ['Unable to analyze content']
    };
  } else if (type === 'comment') {
    return {
      intent: 'comment',
      target: postTarget, // Inherit from post if available
      sentiment: 'neu',
      category: 'other',
      summary: 'Analysis failed - using default values',
      key_issues: ['Unable to analyze content']
    };
  }
};

/**
 * Validate analysis results against expected schema
 * @param {Object} analysis - Analysis result to validate
 * @param {string} type - 'post' or 'comment'
 * @returns {Object} - { isValid: boolean, errors: string[] }
 */
export const validateAnalysis = (analysis, type) => {
  const errors = [];
  
  // Check required fields
  if (type === 'post') {
    const requiredFields = ['intent', 'target', 'sentiment', 'category', 'summary', 'key_issues'];
    for (const field of requiredFields) {
      if (!(field in analysis)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Validate category is string
    if (analysis.category && typeof analysis.category !== 'string') {
      errors.push('category must be a string');
    }
    
    // Validate key_issues is array
    if (analysis.key_issues && !Array.isArray(analysis.key_issues)) {
      errors.push('key_issues must be an array');
    }
    
    // Validate category values
    if (analysis.category && !CATEGORIES.includes(analysis.category)) {
      errors.push(`Invalid category: ${analysis.category}. Must be one of: ${CATEGORIES.join(', ')}`);
    }
    
  } else if (type === 'comment') {
    const requiredFields = ['intent', 'target', 'sentiment', 'category', 'summary', 'key_issues'];
    for (const field of requiredFields) {
      if (!(field in analysis)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }
  
  // Validate enum values
  for (const [field, validValues] of Object.entries(VALID_VALUES)) {
    if (analysis[field] && !validValues.includes(analysis[field])) {
      errors.push(`Invalid ${field}: ${analysis[field]}. Must be one of: ${validValues.join(', ')}`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Sanitize and fix analysis results
 * @param {Object} analysis - Raw analysis result
 * @param {string} type - 'post' or 'comment'
 * @returns {Object} - Sanitized analysis
 */
export const sanitizeAnalysis = (analysis, type) => {
  const sanitized = { ...analysis };
  
  // Fix enum values with more aggressive targeting
  for (const [field, validValues] of Object.entries(VALID_VALUES)) {
    if (sanitized[field] && !validValues.includes(sanitized[field])) {
      console.warn(`⚠️ Invalid ${field} value: ${sanitized[field]}, defaulting to safe value`);
      if (field === 'intent') sanitized[field] = 'comment';
      else if (field === 'target') sanitized[field] = 'not_faceit';
      else if (field === 'sentiment') sanitized[field] = 'neu';
    }
  }
  
  if (type === 'post') {
    // Fix category
    if (!sanitized.category || !CATEGORIES.includes(sanitized.category)) {
      console.warn(`⚠️ Invalid category value: ${sanitized.category}, defaulting to 'other'`);
      sanitized.category = 'other';
    }
    
    // Fix key_issues array
    if (!Array.isArray(sanitized.key_issues)) {
      sanitized.key_issues = ['Unable to extract key issues'];
    }
    
    // Ensure summary exists and is reasonable length
    if (!sanitized.summary || sanitized.summary.length > 200) {
      sanitized.summary = 'Content analysis completed';
    }
  } else if (type === 'comment') {
    // Fix category for comments
    if (!sanitized.category || !CATEGORIES.includes(sanitized.category)) {
      console.warn(`⚠️ Invalid category value: ${sanitized.category}, defaulting to 'other'`);
      sanitized.category = 'other';
    }
    
    // Fix key_issues array for comments
    if (!Array.isArray(sanitized.key_issues)) {
      sanitized.key_issues = ['Unable to extract key issues'];
    }
    
    // Ensure summary exists and is reasonable length for comments
    if (!sanitized.summary || sanitized.summary.length > 200) {
      sanitized.summary = 'Comment analysis completed';
    }
  }
  
  return sanitized;
};

/**
 * Example usage and test data
 */
export const EXAMPLE_POST = {
  title: "FACEIT anti-cheat keeps crashing my game",
  body: "Every time I try to play on FACEIT, the anti-cheat software crashes my CS2. This has been happening for weeks and I can't play ranked matches. Anyone else having this issue?",
  link_flair_text: "Technical Issue",
  num_comments: 5,
  subreddit: "faceit"
};

export const EXAMPLE_COMMENT = {
  body: "I had the same problem. Try reinstalling the FACEIT client and make sure your antivirus isn't blocking it.",
  score: 3,
  author: "helpful_user"
};
