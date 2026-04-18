#!/usr/bin/env node
/**
 * Sync local audio cache to Supabase
 * 
 * Usage:
 *   node sync-to-supabase.mjs [--book=<bookName>]
 */

import { createClient } from '@supabase/supabase-js';
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

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Parse args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const bookFilter = args.book;

async function ensureTable() {
  console.log('🔧 Ensuring audio_cache table exists...');
  
  // Try direct insert to create table via upsert
  const testRecord = {
    tingId: '00000000-0000-0000-0000-000000000000',
    title: 'test',
    audioUrl: 'https://test.mp3',
  };
  
  const { error: insertError } = await supabase
    .from('audio_cache')
    .upsert(testRecord, { onConflict: 'tingId' });
  
  if (insertError) {
    console.log('⚠️  Table may not exist. Please run the SQL in Supabase Dashboard:');
    console.log('');
    console.log('   Open: https://supabase.com/dashboard/project/cwpxcqutrzzkuyaeweir/sql');
    console.log('   Run: backend/supabase-audio-cache.sql');
    return false;
  }
  
  // Delete test record
  await supabase.from('audio_cache').delete().eq('tingId', '00000000-0000-0000-0000-000000000000');
  console.log('✅ Table verified\n');
  return true;
}

async function syncBook(bookDir) {
  const audioFile = path.join(bookDir, 'audio-urls.json');
  
  if (!fs.existsSync(audioFile)) {
    console.log(`⏭️  No audio-urls.json in ${path.basename(bookDir)}`);
    return { total: 0, synced: 0 };
  }
  
  const data = JSON.parse(fs.readFileSync(audioFile, 'utf-8'));
  const validItems = data.filter(item => item.tingId && item.audioUrl);
  
  console.log(`📚 ${path.basename(bookDir)}: ${validItems.length}/${data.length} valid URLs`);
  
  if (validItems.length === 0) {
    return { total: data.length, synced: 0 };
  }
  
  // Batch upsert
  const batchSize = 100;
  let synced = 0;
  
  for (let i = 0; i < validItems.length; i += batchSize) {
    const batch = validItems.slice(i, i + batchSize).map(item => ({
      tingId: item.tingId,
      title: item.title,
      tingNo: item.tingNo,
      audioUrl: item.audioUrl,
      source: 'indexed',
      indexedAt: item.indexedAt || new Date().toISOString(),
    }));
    
    const { error } = await supabase
      .from('audio_cache')
      .upsert(batch, { onConflict: 'tingId' });
    
    if (error) {
      console.error(`  ❌ Batch ${Math.floor(i/batchSize) + 1} error:`, error.message);
    } else {
      synced += batch.length;
      process.stdout.write(`  📤 Synced ${synced}/${validItems.length}\r`);
    }
  }
  
  console.log(`  ✅ Synced ${synced}/${validItems.length}     `);
  return { total: data.length, synced };
}

async function main() {
  console.log('📤 Sync Local Cache to Supabase\n');
  console.log(`URL: ${SUPABASE_URL}\n`);
  
  // Ensure table exists
  const tableReady = await ensureTable();
  if (!tableReady) {
    console.log('\n⚠️  Please create the table first, then re-run this script.');
    process.exit(1);
  }
  
  // Find all book directories
  const downloadsDir = path.join(__dirname, '../downloads');
  if (!fs.existsSync(downloadsDir)) {
    console.log('❌ Downloads directory not found');
    process.exit(1);
  }
  
  const bookDirs = fs.readdirSync(downloadsDir)
    .filter(f => {
      const stat = fs.statSync(path.join(downloadsDir, f));
      return stat.isDirectory() && (!bookFilter || f === bookFilter);
    })
    .map(f => path.join(downloadsDir, f));
  
  console.log(`Found ${bookDirs.length} book(s) to sync\n`);
  
  let totalItems = 0;
  let totalSynced = 0;
  
  for (const bookDir of bookDirs) {
    const result = await syncBook(bookDir);
    totalItems += result.total;
    totalSynced += result.synced;
  }
  
  console.log(`\n========== Sync Complete ==========`);
  console.log(`📚 Total items: ${totalItems}`);
  console.log(`✅ Synced: ${totalSynced}`);
  console.log(`❌ Failed: ${totalItems - totalSynced}`);
}

main().catch(console.error);
