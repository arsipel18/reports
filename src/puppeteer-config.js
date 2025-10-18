import fs from 'fs';
import puppeteer from 'puppeteer';

export function getPuppeteerLaunchOptions() {
  // Base arguments that work on most Linux servers
  const baseArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--single-process",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=TranslateUI",
    "--disable-ipc-flooding-protection",
    "--disable-extensions",
    "--disable-plugins",
    "--disable-images", // Faster rendering for reports
    "--disable-javascript", // Not needed for static reports
    "--disable-default-apps",
    "--disable-sync",
    "--disable-translate",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-pings",
    "--disable-logging",
    "--disable-permissions-api",
    "--disable-presentation-api",
    "--disable-print-preview",
    "--disable-speech-api",
    "--disable-file-system",
    "--disable-notifications",
    "--disable-background-networking",
    "--disable-client-side-phishing-detection",
    "--disable-component-extensions-with-background-pages",
    "--disable-default-apps",
    "--disable-hang-monitor",
    "--disable-prompt-on-repost",
    "--disable-domain-reliability",
    "--disable-component-update",
    "--disable-background-downloads",
    "--disable-add-to-shelf",
    "--disable-client-side-phishing-detection",
    "--disable-sync-preferences",
    "--disable-web-security",
    "--allow-running-insecure-content",
    "--disable-features=VizDisplayCompositor"
  ];

  // Environment-specific configurations
  const config = {
    headless: true,
    args: baseArgs,
    ignoreDefaultArgs: ["--disable-extensions"],
    timeout: 30000, // 30 second timeout
    protocolTimeout: 30000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false
  };

  // Use system Chrome if available (Amazon Linux)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    config.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    // Check for common Chrome paths
    const chromePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/opt/google/chrome/chrome'
    ];
    
    for (const path of chromePaths) {
      if (fs.existsSync(path)) {
        config.executablePath = path;
        break;
      }
    }
  }

  // Add memory management for low-memory servers
  if (process.env.NODE_ENV === 'production' || process.env.LOW_MEMORY) {
    config.args.push(
      "--memory-pressure-off",
      "--max_old_space_size=4096",
      "--disable-background-timer-throttling"
    );
  }

  // Add Docker-specific args if running in container
  if (process.env.DOCKER || process.env.CONTAINER) {
    config.args.push(
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0"
    );
  }

  // Add virtual display if no display available
  if (!process.env.DISPLAY) {
    config.args.push(
      "--virtual-time-budget=5000",
      "--run-all-compositor-stages-before-draw"
    );
  }

  return config;
}

// Alternative configuration for systems with very limited resources
export function getMinimalPuppeteerConfig() {
  const config = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=TranslateUI",
      "--disable-ipc-flooding-protection",
      "--memory-pressure-off",
      "--disable-images",
      "--disable-javascript",
      "--disable-extensions",
      "--disable-plugins",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-default-browser-check",
      "--disable-logging",
      "--disable-permissions-api",
      "--disable-presentation-api",
      "--disable-print-preview",
      "--disable-speech-api",
      "--disable-file-system",
      "--disable-notifications"
    ],
    timeout: 60000, // Longer timeout for minimal config
    protocolTimeout: 60000
  };

  // Use system Chrome if available (Amazon Linux)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    config.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    // Check for common Chrome paths
    const chromePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/opt/google/chrome/chrome'
    ];
    
    for (const path of chromePaths) {
      if (fs.existsSync(path)) {
        config.executablePath = path;
        break;
      }
    }
  }

  return config;
}

// Error handling wrapper for Puppeteer operations
export async function safePuppeteerLaunch(config, operation) {
  let browser;
  try {
    browser = await puppeteer.launch(config);
    return await operation(browser);
  } catch (error) {
    console.error('❌ Puppeteer launch failed:', error.message);
    
    // Handle specific Puppeteer errors
    if (error.message.includes('Session closed') || error.message.includes('Protocol error')) {
      console.log('🔄 Session closed error detected, trying minimal configuration...');
    }
    
    // Try fallback minimal configuration
    if (config !== getMinimalPuppeteerConfig()) {
      console.log('🔄 Trying minimal Puppeteer configuration...');
      try {
        const minimalConfig = getMinimalPuppeteerConfig();
        browser = await puppeteer.launch(minimalConfig);
        return await operation(browser);
      } catch (minimalError) {
        console.error('❌ Minimal Puppeteer configuration also failed:', minimalError.message);
        throw minimalError;
      }
    }
    
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
