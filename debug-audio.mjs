#!/usr/bin/env node
/**
 * Debug script to check if audio is available on yuetingba.cn
 */

import { chromium } from 'playwright';

const tingId = process.argv[2] || '3a1fafdd-c2fb-50d9-b498-93adb96d1545';

async function debug() {
  console.log(`\n🔍 Debugging audio for tingId: ${tingId}\n`);
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  let audioUrls = [];
  
  // Intercept ALL network requests
  page.on('request', (request) => {
    const url = request.url();
    const resourceType = request.resourceType();
    
    if (resourceType === 'media' || url.includes('.mp3') || url.includes('.m4a') || url.includes('.m3u8')) {
      console.log(`🎵 Audio request: ${url.substring(0, 100)}...`);
      audioUrls.push(url);
    }
  });
  
  // Also track responses
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('.mp3') || url.includes('.m4a') || url.includes('.m3u8')) {
      console.log(`📥 Audio response: ${response.status()} - ${url.substring(0, 100)}...`);
    }
  });
  
  const chapterUrl = `http://www.yuetingba.cn/book/Ting/${tingId}`;
  console.log(`📄 Navigating to: ${chapterUrl}\n`);
  
  await page.goto(chapterUrl, { waitUntil: 'networkidle', timeout: 60000 });
  
  console.log(`\n⏳ Waiting for page to load...\n`);
  await page.waitForTimeout(5000);
  
  // Check page content
  const title = await page.title();
  console.log(`📄 Page title: ${title}`);
  
  // Check for audio elements
  const audioElements = await page.$$('audio');
  console.log(`🔊 Found ${audioElements.length} audio elements`);
  
  for (const audio of audioElements) {
    const src = await audio.getAttribute('src');
    console.log(`  Audio src: ${src}`);
  }
  
  // Check for iframes
  const iframes = await page.$$('iframe');
  console.log(`🖼️  Found ${iframes.length} iframes`);
  
  for (const iframe of iframes) {
    const id = await iframe.getAttribute('id');
    const src = await iframe.getAttribute('src');
    console.log(`  Iframe: id=${id}, src=${src?.substring(0, 50)}...`);
  }
  
  // Try to click play button
  const playButtons = await page.$$('button, .play-btn, .player-play');
  console.log(`\n▶️  Found ${playButtons.length} potential play buttons`);
  
  // Take screenshot
  await page.screenshot({ path: `/tmp/yuetingba-debug-${tingId}.png`, fullPage: true });
  console.log(`📸 Screenshot saved to /tmp/yuetingba-debug-${tingId}.png`);
  
  console.log(`\n🎵 Total audio URLs found: ${audioUrls.length}`);
  audioUrls.forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });
  
  // Keep browser open for 10 seconds
  console.log(`\n⏳ Keeping browser open for 10 seconds...`);
  await page.waitForTimeout(10000);
  
  await browser.close();
  
  console.log(`\n✅ Debug complete\n`);
}

debug().catch(console.error);
