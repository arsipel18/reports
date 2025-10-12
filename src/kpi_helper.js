/**
 * Helper functions for KPI filtering
 */

/**
 * Build WHERE clause for keyword filtering
 * @param {boolean} useKeywordFilter - Whether to apply filtering
 * @param {Object} filter - Filter service instance
 * @returns {string} - SQL WHERE clause addition
 */
export function buildKeywordFilterClause(useKeywordFilter, filter) {
  if (!useKeywordFilter) {
    return ''; // No additional filtering
  }

  const config = filter.getConfig();
  
  if (config.includeCount === 0 && config.excludeCount === 0) {
    return ''; // No keywords configured
  }

  let clauses = [];

  // Include keywords (at least one must match)
  if (config.includeCount > 0) {
    const includeConditions = config.includeKeywords.map(keyword => 
      `(LOWER(p.title) LIKE '%${keyword}%' OR LOWER(p.body) LIKE '%${keyword}%' OR LOWER(p.link_flair_text) LIKE '%${keyword}%')`
    );
    clauses.push(`(${includeConditions.join(' OR ')})`);
  }

  // Exclude keywords (none should match)
  if (config.excludeCount > 0) {
    const excludeConditions = config.excludeKeywords.map(keyword => 
      `(LOWER(p.title) NOT LIKE '%${keyword}%' AND LOWER(p.body) NOT LIKE '%${keyword}%' AND LOWER(p.link_flair_text) NOT LIKE '%${keyword}%')`
    );
    clauses.push(`(${excludeConditions.join(' AND ')})`);
  }

  return clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '';
}

/**
 * Add keyword filter info to report metadata
 */
export function addFilterMetadata(report, useKeywordFilter, filter) {
  if (useKeywordFilter) {
    report.metadata.keywordFilterApplied = true;
    report.metadata.filterStats = {
      includeKeywords: filter.getConfig().includeKeywords,
      excludeKeywords: filter.getConfig().excludeKeywords,
      includeCount: filter.getConfig().includeCount,
      excludeCount: filter.getConfig().excludeCount
    };
  } else {
    report.metadata.keywordFilterApplied = false;
    report.metadata.filterStats = null;
  }
  return report;
}
