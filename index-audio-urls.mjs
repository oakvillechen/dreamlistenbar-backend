#!/usr/bin/env node
/**
 * DreamListenBar Audio URL Indexer
 * 
 * Uses Playwright to fetch audio URLs from yuetingba.cn
 * Stores results locally and syncs to Supabase
 * 
 * Usage:
 *   node index-audio-urls.mjs --book=<bookId> [--chapters=1-10] [--headless]
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL || '', SUPABASE_ANON_KEY || '');

// Parse args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const bookId = args.book;
const chapterRange = args.chapters; // e.g., "1-10" or "50-100"
const headless = args.headless !== false; // default true

if (!bookId) {
  console.log('Usage: node index-audio-urls.mjs --book=<bookId> [--chapters=1-10] [--headless]');
  console.log('\nExample:');
  console.log('  node index-audio-urls.mjs --book=3a1f9bd4-3d45-efc2-3081-d0eac07ef799 --chapters=1-20');
  process.exit(1);
}

// Parse chapter range
let startChapter = 1;
let endChapter = Infinity;
if (chapterRange) {
  const [start, end] = chapterRange.split('-').map(Number);
  startChapter = start || 1;
  endChapter = end || Infinity;
}

async function getBookInfo(bookId) {
  // Try local API first
  try {
    const res = await fetch(`http://localhost:3001/api/yuetingba/chapters/${bookId}`);
    const data = await res.json();
    if (data && data.chapters) {
      return {
        bookName: data.book?.title || bookId,
        list: data.chapters.map(c => ({
          id: c.tingId,
          title: c.title,
          tingNo: c.tingNo,
          bookId: bookId,
        }))
      };
    }
  } catch (e) {
    console.log('Local API failed, trying external...');
  }
  
  // Fallback to external API
  try {
    const res = await fetch(`http://www.yuetingba.cn/api/app/docs-listen/ting-list-with-efi/${bookId}?tingNo=1`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('Failed to get book info:', e.message);
    return null;
  }
}

async function indexBook(bookId) {
  console.log(`\n📚 Indexing book: ${bookId}`);
  console.log(`📁 Chapters: ${chapterRange || 'all'}`);
  console.log(`🖥️  Headless: ${headless}`);
  
  // Get book info
  const bookInfo = await getBookInfo(bookId);
  if (!bookInfo || !bookInfo.list) {
    console.error('❌ Failed to get book chapters');
    return;
  }
  
  const chapters = bookInfo.list.filter(c => c.tingNo >= startChapter && c.tingNo <= endChapter);
  console.log(`📚 Found ${chapters.length} chapters to index\n`);
  
  if (chapters.length === 0) {
    console.log('No chapters to index');
    return;
  }
  
  // Get book name from first chapter
  const bookTitle = bookInfo.bookName || chapters[0].bookName || bookId;
  const bookDir = path.join(__dirname, '../downloads', bookTitle);
  
  // Create directory
  if (!fs.existsSync(bookDir)) {
    fs.mkdirSync(bookDir, { recursive: true });
  }
  
  // Load existing cache
  const cacheFile = path.join(bookDir, 'audio-urls.json');
  let cachedUrls = [];
  if (fs.existsSync(cacheFile)) {
    cachedUrls = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    console.log(`📦 Loaded ${cachedUrls.length} existing URLs from cache\n`);
  }
  
  const urlMap = new Map(cachedUrls.map(u => [u.tingId, u]));
  
  // Launch browser
  console.log('🚀 Launching browser...');
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  
  // Track audio requests
  const audioUrls = new Map();
  
  context.on('request', (request) => {
    const url = request.url();
    if (url.includes('.mp3') || url.includes('.m4a') || url.includes('audio')) {
      // Filter out ads
      if (url.includes('googlevideo') || url.includes('gvt1.com') || url.includes('youtube')) {
        return;
      }
      audioUrls.set(url, true);
      console.log(`  🎵 Audio found: ${url.substring(0, 60)}...`);
    }
  });
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const tingId = chapter.id;
    
    // Skip if already cached
    if (urlMap.has(tingId) && urlMap.get(tingId).audioUrl) {
      console.log(`[${i + 1}/${chapters.length}] ⏭️  Skipping cached: ${chapter.title}`);
      successCount++;
      continue;
    }
    
    console.log(`[${i + 1}/${chapters.length}] 📖 Indexing: ${chapter.title}`);
    
    const page = await context.newPage();
    audioUrls.clear();
    
    try {
      // Visit chapter page
      const chapterUrl = `http://www.yuetingba.cn/book/Ting/${tingId}`;
      await page.goto(chapterUrl, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Wait for audio to load
      await page.waitForTimeout(2000);
      
      // Try to click play button
      try {
        const playButton = await page.$('.play-btn, .audio-play, button[title*="播放"], .player-play');
        if (playButton) {
          await playButton.click();
          await page.waitForTimeout(3000);
        }
      } catch (e) {}
      
      // Check for audio element
      const audioSrc = await page.$eval('audio source, audio', (el) => el.src || el.currentSrc).catch(() => null);
      
      // Collect found URLs
      const foundUrls = Array.from(audioUrls.keys());
      let audioUrl = audioSrc || foundUrls[0];
      
      if (audioUrl) {
        urlMap.set(tingId, {
          tingId,
          title: chapter.title,
          tingNo: chapter.tingNo,
          audioUrl,
          indexedAt: new Date().toISOString(),
        });
        successCount++;
        console.log(`  ✅ Found: ${audioUrl.substring(0, 60)}...`);
        
        // Save progress every 10 chapters
        if ((i + 1) % 10 === 0) {
          saveCache(cacheFile, Array.from(urlMap.values()));
        }
      } else {
        failCount++;
        console.log(`  ❌ No audio found`);
        urlMap.set(tingId, {
          tingId,
          title: chapter.title,
          tingNo: chapter.tingNo,
          audioUrl: null,
          indexedAt: new Date().toISOString(),
        });
      }
      
    } catch (err) {
      failCount++;
      console.log(`  ❌ Error: ${err.message}`);
    }
    
    await page.close();
    
    // Delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }
  
  await browser.close();
  
  // Save final cache
  const finalUrls = Array.from(urlMap.values());
  saveCache(cacheFile, finalUrls);
  
  console.log(`\n========== Indexing Complete ==========`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📁 Saved to: ${cacheFile}`);
  
  // Sync to Supabase
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    console.log(`\n📤 Syncing to Supabase...`);
    await syncToSupabase(finalUrls.filter(u => u.audioUrl));
  }
  
  return finalUrls;
}

function saveCache(cacheFile, urls) {
  fs.writeFileSync(cacheFile, JSON.stringify(urls, null, 2));
  console.log(`  💾 Saved ${urls.length} URLs to cache`);
}

async function syncToSupabase(urls) {
  if (!urls.length) {
    console.log('No URLs to sync');
    return;
  }
  
  // Batch insert
  const batchSize = 100;
  let synced = 0;
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    
    const { error } = await supabase
      .from('audio_cache')
      .upsert(batch, { onConflict: 'tingId' });
    
    if (error) {
      console.error(`  ❌ Sync error: ${error.message}`);
    } else {
      synced += batch.length;
      console.log(`  📤 Synced ${synced}/${urls.length}`);
    }
  }
  
  console.log(`  ✅ Supabase sync complete`);
}

// Run
indexBook(bookId).catch(console.error);
