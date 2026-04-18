import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import CryptoJS from 'crypto-js';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ================== 音频缓存 ==================
// Multi-tier cache: Supabase (primary) -> Local JSON (fallback)
const localCache = new Map(); // tingId -> audioUrl

function loadLocalCache() {
  const downloadsDir = path.join(__dirname, '../downloads');
  if (!fs.existsSync(downloadsDir)) {
    console.log('[CACHE] Downloads directory not found');
    return;
  }

  const bookDirs = fs.readdirSync(downloadsDir).filter(f => {
    const stat = fs.statSync(path.join(downloadsDir, f));
    return stat.isDirectory();
  });

  for (const book of bookDirs) {
    const audioFile = path.join(downloadsDir, book, 'audio-urls.json');
    if (fs.existsSync(audioFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(audioFile, 'utf-8'));
        let count = 0;
        for (const item of data) {
          if (item.tingId && item.audioUrl) {
            localCache.set(item.tingId, item.audioUrl);
            count++;
          }
        }
        console.log(`[CACHE] Loaded ${count} cached URLs for ${book}`);
      } catch (e) {
        console.error(`[CACHE] Error loading ${audioFile}:`, e.message);
      }
    }
  }
  console.log(`[CACHE] Total local cache: ${localCache.size} URLs`);
}

// Get audio URL from cache (Supabase first, then local)
async function getAudioUrl(tingId) {
  // 1. Try Supabase first
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const { data, error } = await supabase
        .from('audio_cache')
        .select('audioUrl')
        .eq('tingId', tingId)
        .single();
      
      if (data && data.audioUrl) {
        return { url: data.audioUrl, source: 'supabase' };
      }
    } catch (e) {
      // Table might not exist yet, fall through to local cache
    }
  }
  
  // 2. Fall back to local cache
  const localUrl = localCache.get(tingId);
  if (localUrl) {
    return { url: localUrl, source: 'local' };
  }
  
  return null;
}

// Load local cache at startup
loadLocalCache();

app.get('/api/version', (req, res) => {
  res.json({ version: '1.0.1-debug-proxy', timestamp: '2026-03-13T03:07:00Z' });
});

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase environment variables!');
}

const supabase = createClient(SUPABASE_URL || '', SUPABASE_ANON_KEY || '');

// ================== 用户数据 API ==================

// 获取用户数据
app.get('/api/user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { data, error } = await supabase
      .from('user_data')
      .select('history, favorites')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json({
      success: true,
      history: data?.history || [],
      favorites: data?.favorites || [],
    });
  } catch (err) {
    console.error('[USER] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 保存用户数据
app.post('/api/user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { history, favorites } = req.body;

    const { data, error } = await supabase
      .from('user_data')
      .upsert(
        {
          email,
          history: history || [],
          favorites: favorites || [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      )
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('[USER] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 添加历史记录
app.post('/api/user/:email/history', async (req, res) => {
  try {
    const { email } = req.params;
    const item = req.body;

    // 获取现有数据
    const { data: existing } = await supabase
      .from('user_data')
      .select('history')
      .eq('email', email)
      .single();

    let history = existing?.history || [];
    
    // 移除同一条记录
    history = history.filter(h => h.tingId !== item.tingId);
    
    // 添加到最前面，保留最近100条
    history = [item, ...history].slice(0, 100);

    // 更新
    const { error } = await supabase
      .from('user_data')
      .upsert(
        { email, history, updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      );

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[HISTORY] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 添加收藏
app.post('/api/user/:email/favorites', async (req, res) => {
  try {
    const { email } = req.params;
    const item = req.body;

    const { data: existing } = await supabase
      .from('user_data')
      .select('favorites')
      .eq('email', email)
      .single();

    let favorites = existing?.favorites || [];
    
    if (!favorites.some(f => f.bookId === item.bookId)) {
      favorites = [{ ...item, timestamp: Date.now() }, ...favorites];
    }

    const { error } = await supabase
      .from('user_data')
      .upsert(
        { email, favorites, updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      );

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[FAVORITES] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除收藏
app.delete('/api/user/:email/favorites/:bookId', async (req, res) => {
  try {
    const { email, bookId } = req.params;

    const { data: existing } = await supabase
      .from('user_data')
      .select('favorites')
      .eq('email', email)
      .single();

    const favorites = (existing?.favorites || []).filter(f => f.bookId !== bookId);

    const { error } = await supabase
      .from('user_data')
      .upsert(
        { email, favorites, updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      );

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[FAVORITES] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除单条历史记录
app.delete('/api/user/:email/history/:tingId', async (req, res) => {
  try {
    const { email, tingId } = req.params;

    const { data: existing } = await supabase
      .from('user_data')
      .select('history')
      .eq('email', email)
      .single();

    const history = (existing?.history || []).filter(h => h.tingId !== tingId);

    const { error } = await supabase
      .from('user_data')
      .upsert(
        { email, history, updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      );

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[HISTORY DELETE] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 清除所有历史记录
app.delete('/api/user/:email/history', async (req, res) => {
  try {
    const { email } = req.params;

    const { error } = await supabase
      .from('user_data')
      .upsert(
        { email, history: [], updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      );

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[HISTORY CLEAR] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================== 音频 API ==================

// ================== 悦听吧音频解密 API ==================
// 解密密钥和IV (从悦听吧JS代码中提取)
const YUETINGBA_KEY = CryptoJS.enc.Base64.parse('le95G3hnFDJsBE+1/v9eYw==');
const YUETINGBA_IV = CryptoJS.enc.Base64.parse('IvswQFEUdKYf+d1wKpYLTg==');
const YUETINGBA_DEFAULT_SERVER = 'http://oss.fileserver.yuetingba.cn:52001';

// 模拟 Unblock Youku 的头部
const UNBLOCK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Forwarded-For': '114.114.114.114',
  'X-Real-IP': '114.114.114.114',
  'X-Forwarded-Proto': 'http',
};

// 解密 assl 字段获取音频服务器列表
// 网站在 assl 密文中嵌入了一个32字符的噪声字符串，需要先移除
const ASSL_NOISE_STRING = 'xMiP5W1DHBxC5PwQ5oj5QfRn0tsT5UBk';

function decryptAssl(assl) {
  try {
    // 移除嵌入的噪声字符串
    const cleanAssl = assl.replace(ASSL_NOISE_STRING, '');
    
    const decrypted = CryptoJS.AES.decrypt(cleanAssl, YUETINGBA_KEY, { 
      iv: YUETINGBA_IV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    
    if (!result) {
      console.error('[DECRYPT ASSL] Decryption produced empty result');
      return null;
    }
    
    // 解析 JSON
    const servers = JSON.parse(result);
    console.log(`[DECRYPT ASSL] Successfully decrypted ${servers.length} audio servers`);
    return servers;
  } catch (err) {
    console.error('[DECRYPT ASSL] Error:', err.message);
    return null;
  }
}

// 根据 bookId 查找对应的音频服务器
function findAudioServer(servers, bookId) {
  if (!servers || !bookId) return null;
  
  // 提取 bookId 的短格式 (去掉横线后的最后12位)
  const shortBookId = bookId.replace(/-/g, '').slice(-12);
  
  for (const server of servers) {
    if (server.BookIds && server.BookIds.includes(shortBookId)) {
      return {
        url: `${server.Scheme}://${server.Value}:${server.Port}`,
        name: server.Name,
        type: server.AsType
      };
    }
  }
  
  // 如果没找到，返回默认服务器
  return null;
}

// 动态密钥派生函数 gk(tingId, creationTime)
function deriveKey(tingId, creationTime) {
  let result = '';
  for (let i = 0; i < 20; i++) {
    const charCode = tingId.charCodeAt(i) + Number(creationTime[i]);
    result += String.fromCharCode(charCode);
  }
  for (let i = 20; i < tingId.length; i++) {
    const charCode = tingId.charCodeAt(i) + Number(creationTime[i - 20]);
    result += String.fromCharCode(charCode);
  }
  return result;
}

// 动态IV派生函数 gi(tingId, creationTime)
function deriveIV(tingId, creationTime) {
  let result = '';
  for (let i = 20; i > 4; i--) {
    const charCode = tingId.charCodeAt(i) + Number(creationTime[i - 1]);
    result += String.fromCharCode(charCode);
  }
  return result;
}

// 解密efi字段获取音频路径 (使用动态密钥)
function decryptEfiDynamic(efi, tingId, creationTime) {
  try {
    const processedTingId = tingId.replaceAll('-', '');
    const processedTime = creationTime
      .replaceAll('-', '')
      .replaceAll(':', '')
      .replaceAll('T', '')
      .replaceAll('.', '')
      .replaceAll(' ', '')
      .padEnd(20, '0');
    
    const derivedKeyStr = deriveKey(processedTingId, processedTime);
    const derivedIVStr = deriveIV(processedTingId, processedTime);
    
    const derivedKey = CryptoJS.enc.Base64.parse(btoa(derivedKeyStr));
    const derivedIV = CryptoJS.enc.Base64.parse(btoa(derivedIVStr));
    
    const decrypted = CryptoJS.AES.decrypt(efi, derivedKey, { 
      iv: derivedIV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    const path = decrypted.toString(CryptoJS.enc.Utf8);
    return path;
  } catch (err) {
    console.error('[DECRYPT] Error:', err.message);
    return null;
  }
}

// 获取悦听吧音频URL (无需Playwright!)
app.get('/api/yuetingba/audio/:tingId', async (req, res) => {
  const { tingId } = req.params;
  
  // 0. 检查缓存 (Supabase + Local)
  const cached = await getAudioUrl(tingId);
  if (cached) {
    console.log(`[CACHE] -> Found cached URL for ${tingId} (source: ${cached.source})`);
    return res.json({
      success: true,
      tingId,
      audioUrl: cached.url,
      source: cached.source,
    });
  }
  
  try {
    console.log(`[YUETINGBA] -> Fetching audio for tingId: ${tingId}`);
    
    // 1. 获取章节信息 (包含 efi)
    const apiUrl = `http://www.yuetingba.cn/api/app/docs-listen/${tingId}/ting-with-efi`;
    const { data } = await axios.get(apiUrl, { 
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
      }
    });
    
    if (!data || !data.efi) {
      return res.status(404).json({ 
        success: false, 
        error: 'No efi field in response',
        raw: data 
      });
    }
    
    // 2. 获取书籍详情页的 assl 字段 (音频服务器列表)
    const bookDetailUrl = `http://www.yuetingba.cn/book/detail/${data.bookId}/0`;
    const bookDetailResp = await axios.get(bookDetailUrl, {
      timeout: 10000,
      headers: { ...UNBLOCK_HEADERS, 'Referer': 'http://www.yuetingba.cn/' }
    });
    
    // 提取 assl 字段 - 兼容单引号、双引号和反引号
    const asslMatch = bookDetailResp.data.match(/var assl = ['"`]([^'"`]+)['"`]/);
    let audioServer = YUETINGBA_DEFAULT_SERVER;
    
    if (asslMatch && asslMatch[1]) {
      const servers = decryptAssl(asslMatch[1]);
      if (servers) {
        console.log(`[YUETINGBA] -> Available servers:`, servers.map(s => `${s.Name}: ${s.Scheme}://${s.Value}:${s.Port}`));
        const shortBookId = data.bookId.replace(/-/g, '').slice(-12);
        console.log(`[YUETINGBA] -> Looking for shortBookId: ${shortBookId}`);
        const found = findAudioServer(servers, data.bookId);
        if (found) {
          audioServer = found.url;
          console.log(`[YUETINGBA] -> Found audio server for book ${data.bookId}: ${audioServer}`);
        } else {
          // 没找到匹配的服务器，保存服务器列表用于后续尝试
          console.log(`[YUETINGBA] -> No matching server found, will try all servers as fallback`);
          req.availableServers = servers.map(s => `${s.Scheme}://${s.Value}:${s.Port}`);
        }
      }
    }
    
    // 3. 解密 efi 获取音频路径
    const audioPath = decryptEfiDynamic(data.efi, tingId, data.creationTime);
    
    if (!audioPath) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to decrypt efi field',
        efi: data.efi,
        tingId,
        creationTime: data.creationTime
      });
    }
    
    // 4. 组合完整URL
    const audioUrl = `${audioServer}${audioPath}`;
    
    // 5. 如果没有匹配到特定服务器，返回所有可用服务器让前端尝试
    const availableServers = req.availableServers || [audioServer];
    
    console.log(`[YUETINGBA] -> Decrypted audio URL: ${audioUrl}`);
    
    res.json({
      success: true,
      tingId: data.id,
      bookId: data.bookId,
      title: data.title,
      tingNo: data.tingNo,
      audioPath,
      audioUrl,
      audioServer,
      availableServers,
      creationTime: data.creationTime,
    });
    
  } catch (err) {
    console.error('[YUETINGBA] API failed:', err.message);
    
    // Fallback to Playwright if API fails
    console.log('[YUETINGBA] -> Trying Playwright fallback...');
    
    try {
      const browser = await getBrowser();
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      
      let audioUrl = null;
      
      // Intercept network requests
      page.on('request', (request) => {
        const url = request.url();
        const resourceType = request.resourceType();
        
        if (resourceType === 'media' || url.match(/\.(mp3|m4a|m3u8)/i)) {
          if (!url.includes('googlevideo') && !url.includes('gvt1.com') && !url.includes('youtube')) {
            console.log(`[PLAYWRIGHT] Found audio: ${url.substring(0, 80)}...`);
            audioUrl = url;
          }
        }
      });
      
      const chapterUrl = `http://www.yuetingba.cn/book/Ting/${tingId}`;
      await page.goto(chapterUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      
      // Try iframe testFun
      try {
        await page.waitForFunction(() => {
          const iframe = document.getElementById('iframe_tingPlay');
          return iframe && iframe.contentWindow && typeof iframe.contentWindow.testFun === 'function';
        }, { timeout: 10000 });
        
        await page.evaluate((id) => {
          const iframe = document.getElementById('iframe_tingPlay');
          if (iframe && iframe.contentWindow && iframe.contentWindow.testFun) {
            iframe.contentWindow.testFun(id);
          }
        }, tingId);
        
        let waitAttempts = 0;
        while (!audioUrl && waitAttempts < 25) {
          await page.waitForTimeout(200);
          waitAttempts++;
        }
      } catch (e) {}
      
      // Try play button
      if (!audioUrl) {
        try {
          const playBtn = await page.$('.play-btn, .audio-play, button[title*="播放"], .player-play');
          if (playBtn) {
            await playBtn.click();
            await page.waitForTimeout(3000);
          }
        } catch (e) {}
      }
      
      await context.close();
      
      if (audioUrl) {
        console.log(`[PLAYWRIGHT] Success! Audio URL: ${audioUrl.substring(0, 80)}...`);
        return res.json({
          success: true,
          tingId,
          audioUrl,
          source: 'playwright-fallback',
        });
      }
    } catch (pwErr) {
      console.error('[PLAYWRIGHT] Fallback failed:', pwErr.message);
    }
    
    res.status(500).json({ 
      success: false, 
      error: err.message,
      tingId 
    });
  }
});

// 获取书籍章节列表
app.get('/api/yuetingba/chapters/:bookId', async (req, res) => {
  const { bookId } = req.params;
  const { tingNo = 1 } = req.query;
  
  try {
    console.log(`[YUETINGBA] -> Fetching chapters for bookId: ${bookId}`);
    
    const apiUrl = `http://www.yuetingba.cn/api/app/docs-listen/ting-list-with-efi/${bookId}?tingNo=${tingNo}`;
    const { data } = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
      }
    });
    
    // API 直接返回数组
    const chapters = Array.isArray(data) ? data : (data.list || []);
    
    res.json({
      success: true,
      bookId,
      chapters: chapters.map(ch => ({
        id: ch.id,
        tingId: ch.id,
        tingNo: ch.tingNo,
        title: ch.title,
        efi: ch.efi,
        creationTime: ch.creationTime,
      })),
      total: chapters.length,
    });
    
  } catch (err) {
    console.error('[YUETINGBA] Error:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      bookId 
    });
  }
});

// ================== 分类/搜索 API ==================
// 使用 HTML 爬取方式（悦听吧 API 不稳定）

app.get('/api/category', async (req, res) => {
  const { id = 'latest', page = '1' } = req.query;
  // 悦听吧页码从1开始，如果前端传0则改为1
  const pageNum = page === '0' || page === 0 ? '1' : page;
  
  try {
    const url = id === 'latest'
      ? `http://www.yuetingba.cn/top/latest/${pageNum}`
      : `http://www.yuetingba.cn/book/${id}/${pageNum}`;
    
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
      timeout: 10000
    });

    const $ = cheerio.load(html);
    const books = [];

    $('.section-box-list-item').each((_, el) => {
      const aNode = $(el).find('.box-list-item-text-title a');
      const title = aNode.text().trim();
      const href = aNode.attr('href');
      const bookId = href ? href.split('/')[3] : '';
      const cover = $(el).find('.box-list-item-img img').attr('src');
      const summary = $(el).find('.box-list-item-text-intro').text().trim();
      const authorText = $(el).find('span[title]').first().text().trim();
      const speakerText = $(el).find('span[title]').last().text().trim();

      if (title && bookId) {
        books.push({
          title,
          bookId,
          href: href || '',
          cover: cover ? (cover.startsWith('http') ? cover : 'http://www.yuetingba.cn' + cover) : '',
          author: authorText,
          speaker: speakerText,
          summary
        });
      }
    });

    res.json({ success: true, list: books });
  } catch (err) {
    console.error('[CATEGORY] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  const { keyword } = req.query;
  
  if (!keyword) {
    return res.status(400).json({ success: false, error: 'Missing keyword' });
  }

  try {
    const url = `http://www.yuetingba.cn/Search?name=${encodeURIComponent(keyword)}`;
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
      timeout: 10000
    });

    const $ = cheerio.load(html);
    const books = [];

    $('.section-box-list-item').each((_, el) => {
      const aNode = $(el).find('.box-list-item-text-title a');
      const title = aNode.text().trim();
      const href = aNode.attr('href');
      const bookId = href ? href.split('/')[3] : '';
      const cover = $(el).find('.box-list-item-img img').attr('src');
      const summary = $(el).find('.box-list-item-text-intro').text().trim();
      const authorText = $(el).find('span[title]').first().text().trim();
      const speakerText = $(el).find('span[title]').last().text().trim();

      if (title && bookId) {
        books.push({
          title,
          bookId,
          href: href || '',
          cover: cover ? (cover.startsWith('http') ? cover : 'http://www.yuetingba.cn' + cover) : '',
          author: authorText,
          speaker: speakerText,
          summary
        });
      }
    });

    res.json({ success: true, list: books });
  } catch (err) {
    console.error('[SEARCH] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/book/:id', async (req, res) => {
  const { id } = req.params;
  const { page = '0' } = req.query;
  const pageNum = page === '0' || page === 0 ? '0' : page; // 书籍详情页0是首页

  try {
    // 获取书籍详情页
    const detailUrl = `http://www.yuetingba.cn/book/detail/${id}/${pageNum}`;
    const { data: detailHtml } = await axios.get(detailUrl, {
      headers: { ...UNBLOCK_HEADERS, 'Referer': 'http://www.yuetingba.cn/' },
      timeout: 10000
    });

    const $ = cheerio.load(detailHtml);
    
    // 解析书籍信息
    const book = {
      title: $('.book-detail-title').text().trim() || $('h1').first().text().trim(),
      cover: $('.books-detail-img img').attr('src') || $('.ting-detail-img img').attr('src') || '',
      author: $('.books-detail-detail').find('span:contains("作者")').next().text().trim() || 
              $('.books-detail-detail').find('a[href*="/Search?"]').first().text().trim(),
      speaker: $('.books-detail-detail').find('span:contains("主播")').next().text().trim() || 
               $('.books-detail-detail').find('a[href*="/Search?"]').last().text().trim(),
      summary: $('.books-detail-detail p').last().text().trim(),
    };

    // 处理封面 URL
    if (book.cover && !book.cover.startsWith('http')) {
      book.cover = 'http://www.yuetingba.cn' + book.cover;
    }

    // 解析章节列表
    const chapters = [];
    $('.ting-list-content-item').each((_, el) => {
      const id = $(el).attr('id')?.replace('item_', '') || '';
      const title = $(el).find('.col-md-10 a').attr('title') || 
                    $(el).find('.col-md-10').text().trim();
      if (id && title) {
        chapters.push({
          tingId: id,
          title: title,
          tingNo: chapters.length + 1,
        });
      }
    });

    // 解析分页
    const tabs = [];
    $('.nav-tabs li a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const offset = href.split('/').pop();
      tabs.push({
        text: $(el).text().trim(),
        offset: offset || '0',
      });
    });

    res.json({
      success: true,
      book,
      chapters,
      tabs,
    });
  } catch (err) {
    console.error('[BOOK] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 音频代理端点
const KNOWN_SERVERS = [
  'http://oss.fileserver.yuetingba.cn:52001',
  'http://185.242.234.59:36512',
  'http://106.13.91.31:43134',
  'http://oss.fileserver.yuetingba.cn:52002',
  'http://oss.fileserver.yuetingba.cn:52003',
  'http://oss.fileserver.yuetingba.cn:52005',
];

app.get('/api/proxy-audio', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const tryProxy = async (targetUrl) => {
    const encodedUrl = encodeURI(targetUrl);
    console.log(`[PROXY] -> Attempting: ${encodedUrl.substring(0, 80)}...`);
    
    return await axios({
      method: 'GET',
      url: encodedUrl,
      responseType: 'stream',
      timeout: 15000, // Slightly shorter timeout per attempt
      headers: {
        ...UNBLOCK_HEADERS,
        'Referer': 'http://www.yuetingba.cn/',
        'Range': req.headers.range || 'bytes=0-',
      }
    });
  };

  try {
    let response;
    try {
      response = await tryProxy(url);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.log(`[PROXY] 404 for primary URL, trying fallbacks...`);
        // Extract the path from the URL
        const pathMatch = url.match(/(\/myfiles\/.*)/);
        if (pathMatch) {
          const path = pathMatch[1];
          for (const server of KNOWN_SERVERS) {
             const fallbackUrl = `${server}${path}`;
             if (fallbackUrl === url) continue;
             try {
                response = await tryProxy(fallbackUrl);
                console.log(`[PROXY] Success with fallback: ${server}`);
                break;
             } catch (fErr) {
                console.log(`[PROXY] Fallback failed: ${server} (${fErr.response?.status || 'Error'})`);
             }
          }
        }
      }
      
      if (!response) throw err;
    }

    res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
      res.status(206);
    }

    response.data.pipe(res);
  } catch (err) {
    console.error(`[PROXY] Final failure for ${url.substring(0, 50)}...:`, err.message);
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to proxy audio',
      message: err.message,
      status: err.response?.status,
      target: url.substring(0, 80)
    });
  }
});

const PORT = process.env.PORT || 3001;
// ================== Playwright 音频提取 ==================
// 用于当 API 方式失败时，通过浏览器自动化提取音频 URL
import { chromium } from 'playwright';

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ]
    });
  }
  return browserInstance;
}

const AD_FINISHER_SCRIPT = `
(function() {
  console.log('%c🚀 DreamListenBar Ad-Finisher Active', 'color: #6366f1; font-weight: bold; font-size: 14px;');
  
  // 1. 禁用反调试工具 detection
  try {
    window.disableDevtool = null;
    if (window.console && window.console.clear) {
      const originalClear = window.console.clear;
      window.console.clear = function() {
        console.log('🛡️ Blocked an attempt to clear console');
      };
    }
  } catch(e) {}

  // 2. 注入样式隐藏广告 (使用更兼容的 textContent)
  const injectStyle = () => {
    if (document.getElementById('dlb-ad-styles')) return;
    const style = document.createElement('style');
    style.id = 'dlb-ad-styles';
    style.textContent = \`
      .adsbygoogle, .ad, .adv, .gg, .ad-wrapper, .pop-ad, .bottom-ad,
      iframe[id^="aswift_"], div[id^="google_ads_iframe_"],
      #iframe_tingPlay + div, .footer-ad, .player-ad, [id*="player-ad"],
      .side-ad, .top-ad, .float-ad, #ad-container, [id*="ad-"] { 
        display: none !important; 
        visibility: hidden !important;
        opacity: 0 !important;
        height: 0 !important;
        pointer-events: none !important;
        z-index: -1 !important;
      }
      /* 强制主要内容可见 */
      #section-box, .section-box, #iframe_tingPlay {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
    \`;
    (document.head || document.documentElement).appendChild(style);
  };
  injectStyle();

  // 3. 核心逻辑：自动提速并强制跳过视频广告
  const autoSkip = () => {
    // A. 处理视频广告
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      // 识别短视频（通常小于65秒为广告）
      if (v.duration > 0 && v.duration < 65) {
        if (v.playbackRate < 10) {
          console.log('⚡ Detected ad video. Accelerating to 16x...');
          v.playbackRate = 16.0;
          v.muted = true;
        }
        // 强制跳转到接近结束的位置，加速“跳过”
        if (v.currentTime < v.duration - 0.2) {
          console.log('⏭️ Skipping forward...');
          v.currentTime = v.duration - 0.1;
        }
        v.play().catch(() => {});
      }
    });

    // B. 自动点击具有特定文本或类名的跳过按钮
    const keywords = ['跳过', 'Skip', '关闭广告', '关闭', '我知道了', '不再提示', '点击播放'];
    const selectors = 'div, span, button, a, .skip-button, [class*="skip"], .close-btn, [id*="close"]';
    
    document.querySelectorAll(selectors).forEach(el => {
      // 只检查叶子节点或近似叶子节点以防误触
      if (el.children.length <= 1) {
        const text = (el.innerText || el.textContent || '').trim();
        if (keywords.some(k => text.includes(k)) && text.length < 10) {
          if (el.style.display !== 'none' && el.style.visibility !== 'hidden') {
            console.log('✅ Auto-clicked element: "' + text + '"');
            el.click();
          }
        }
      }
    });
  };

  // 轮询执行，确保动态加载的广告也能被捕获
  setInterval(autoSkip, 800);
  setInterval(injectStyle, 2000);
  
  // 4. 清理、阻断恶意广告容器和各种广告 iframe
  const cleanIframes = () => {
    document.querySelectorAll('iframe').forEach(frame => {
      try {
        const url = frame.src || '';
        const id = frame.id || '';
        // 保护播放器 iframe
        if (id.includes('tingPlay') || url.includes('/book/TingPlay/')) return;
        
        if (url.includes('google') || url.includes('doubleclick') || url.includes('pos.baidu.com') || url.includes('ads') || url.includes('union')) {
           frame.remove();
        }
      } catch (e) {}
    });
  };
  setInterval(cleanIframes, 3000);
})();
\`;
   const keywords = ['跳过', 'Skip', '关闭广告', '关闭', '我知道了', '不再提示'];
    const selectors = 'div, span, button, a, .skip-button, [class*="skip"]';
    
    document.querySelectorAll(selectors).forEach(el => {
      // 只检查叶子节点以防误触
      if (el.children.length <= 1) {
        const text = (el.innerText || el.textContent || '').trim();
        if (keywords.some(k => text.includes(k)) && text.length < 10) {
          if (el.style.display !== 'none' && el.style.visibility !== 'hidden') {
            console.log('✅ Auto-clicked skip button: "' + text + '"');
            el.click();
          }
        }
      }
    });
  };

  // 轮询执行，确保动态加载的广告也能被捕获
  setInterval(autoSkip, 800);
  setInterval(injectStyle, 2000);
  
  // 4. 清理恶意的广告 iframe
  const cleanIframes = () => {
    document.querySelectorAll('iframe').forEach(frame => {
      try {
        const url = frame.src || '';
        if (url.includes('google') || url.includes('doubleclick') || url.includes('pos.baidu.com') || url.includes('ads')) {
          if (!frame.id.includes('tingPlay')) { // 保护主播放器 iframe
             frame.remove();
          }
        }
      } catch (e) {}
    });
  };
  setInterval(cleanIframes, 3000);
})();
`;

// Playwright-based audio extraction endpoint
app.get('/api/audio-playwright/:tingId', async (req, res) => {
  const { tingId } = req.params;
  
  console.log(`[PLAYWRIGHT] -> Extracting audio for tingId: ${tingId}`);
  
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    
    // 注入脚本绕过检测
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.disableDevtool = null;
    });

    const page = await context.newPage();
    
    let audioUrl = null;
    
    // Intercept network requests
    page.on('request', (request) => {
      const url = request.url();
      const resourceType = request.resourceType();
      
      // Look for audio/media requests
      if (resourceType === 'media' || url.match(/\.(mp3|m4a|m3u8)/i)) {
        // Filter out ads
        if (!url.includes('googlevideo') && !url.includes('gvt1.com') && !url.includes('youtube')) {
          console.log(`[PLAYWRIGHT] Found audio: ${url.substring(0, 80)}...`);
          audioUrl = url;
        }
      }
    });
    
    // Visit the chapter page
    const chapterUrl = `http://www.yuetingba.cn/book/Ting/${tingId}`;
    console.log(`[PLAYWRIGHT] Visiting: ${chapterUrl}`);
    
    await page.goto(chapterUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    // Wait for potential audio to load
    await page.waitForTimeout(2000);
    
    // Try to trigger playback via iframe
    try {
      await page.waitForFunction(() => {
        const iframe = document.getElementById('iframe_tingPlay');
        return iframe && iframe.contentWindow && typeof iframe.contentWindow.testFun === 'function';
      }, { timeout: 10000 });
      
      await page.evaluate((id) => {
        const iframe = document.getElementById('iframe_tingPlay');
        if (iframe && iframe.contentWindow && iframe.contentWindow.testFun) {
          iframe.contentWindow.testFun(id);
        }
      }, tingId);
      
      console.log('[PLAYWRIGHT] Triggered testFun for playback');
      
      // Wait for audio request
      let waitAttempts = 0;
      while (!audioUrl && waitAttempts < 25) {
        await page.waitForTimeout(200);
        waitAttempts++;
      }
    } catch (e) {
      console.log('[PLAYWRIGHT] Iframe testFun not available:', e.message);
    }
    
    // If still no audio, try clicking play button
    if (!audioUrl) {
      try {
        const playBtn = await page.$('.play-btn, .audio-play, button[title*="播放"], .player-play');
        if (playBtn) {
          await playBtn.click();
          await page.waitForTimeout(3000);
        }
      } catch (e) {}
    }
    
    // Last resort: check for audio element
    if (!audioUrl) {
      const audioSrc = await page.$eval('audio source, audio', (el) => el.src || el.currentSrc).catch(() => null);
      if (audioSrc) {
        audioUrl = audioSrc;
      }
    }
    
    await context.close();
    
    if (audioUrl) {
      console.log(`[PLAYWRIGHT] Success! Audio URL: ${audioUrl.substring(0, 80)}...`);
      res.json({
        success: true,
        tingId,
        audioUrl,
        source: 'playwright',
      });
    } else {
      console.log('[PLAYWRIGHT] No audio found');
      res.status(404).json({
        success: false,
        error: 'No audio found via Playwright',
        tingId,
      });
    }
  } catch (err) {
    console.error('[PLAYWRIGHT] Error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      tingId,
    });
  }
});

/**
 * 核心功能：全路径反向代理 (Catch-All Reverse Proxy)
 * 模拟 yuetingba.cn 的路径结构，以便 iframe 内部的相对路径资源 (JS/CSS) 能正确加载
 */
app.all('/yuetingba_proxy/*', async (req, res) => {
  const targetPath = req.params[0] || '';
  // 构造目标 URL，保留查询参数
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = `http://www.yuetingba.cn/${targetPath}${queryString}`;
  
  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: { 
        ...UNBLOCK_HEADERS, 
        'Referer': 'http://www.yuetingba.cn/',
        'User-Agent': req.headers['user-agent'] || UNBLOCK_HEADERS['User-Agent']
      },
      data: req.body,
      responseType: 'arraybuffer',
      timeout: 15000,
      validateStatus: false // 允许转发 404 等状态
    });
    
    // 转发响应头
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(response.status).send(response.data);
  } catch (err) {
    console.error(`[REVERSE-PROXY] Error for ${targetUrl}:`, err.message);
    res.status(500).send(`Proxy Error: ${err.message}`);
  }
});

/**
 * 核心功能：原站播放器净化代理 (Clean Player Proxy)
 * 抓取原站页面，注入广告过滤器和自动化脚本，然后返回给前端
 */
app.get('/api/yuetingba/clean-player/:tingId', async (req, res) => {
  const { tingId } = req.params;
  const targetUrl = `http://www.yuetingba.cn/book/Ting/${tingId}`;
  
  try {
    const response = await axios.get(targetUrl, {
      headers: { ...UNBLOCK_HEADERS, 'Referer': 'http://www.yuetingba.cn/' },
      timeout: 10000
    });
    
    let html = response.data;
    
    // 获取当前后端的代理前缀，用于将 http 资源转为 https 代理
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const proxyBase = `${protocol}://${host}/yuetingba_proxy/`;

    // 1. 核心改进：使用路径映射代理 (Reverse Proxy) 替换原本的 Query Proxy
    // 这使得资源内部的相对路径能够基于 /yuetingba_proxy/ 正确解析
    
    // 处理所有以 / 开头的路径，将其重写为我们的代理路径
    html = html.replace(/(src|href)=["']\/([^"']+)["']/g, `$1="${proxyBase}$2"`);
    
    // 处理所有以 http://www.yuetingba.cn 开头的绝对路径
    html = html.replace(/(src|href)=["']http:\/\/www\.yuetingba\.cn\/([^"']+)["']/g, `$1="${proxyBase}$2"`);

    // 2. 注入 Ad-Finisher 脚本和强化后的净化样式
    const injection = `
      <style>
        /* 强制深色外观 */
        body { 
          background: #0f172a !important; 
          color: #f8fafc !important; 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        
        /* 隐藏原站所有导航、边栏和页脚 */
        header, footer, .navbar, .breadcrumb, .footer-box, .side-bar, .top-nav, .footer-ad { 
          display: none !important; 
        }
        
        /* 美化并居中播放器正文 */
        .section-box, #section-box { 
          background: transparent !important; 
          border: none !important; 
          padding: 20px !important;
          max-width: 900px !important;
          width: 95% !important;
          margin: 0 auto !important;
        }
        
        .section-box-title, .ting-title {
          font-size: 22px !important;
          font-weight: 800 !important;
          text-align: center !important;
          margin-bottom: 24px !important;
          color: #fff !important;
        }

        /* 优化链接样式 (上一集/下一集等) */
        a { 
          color: #818cf8 !important; 
          text-decoration: none !important; 
          font-weight: 600 !important;
        }
        a:hover { color: #a5b4fc !important; }

        /* 强制主播放器 iframe 样式 */
        #iframe_tingPlay {
          width: 100% !important;
          height: 180px !important;
          border-radius: 20px !important;
          background: #1e293b !important;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5) !important;
          margin: 20px 0 !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
        }
      </style>
      <script>${AD_FINISHER_SCRIPT}</script>
    `;
    
    html = html.replace('</head>', `${injection}</head>`);
    
    res.send(html);
  } catch (err) {
    console.error('[CLEAN-PLAYER] Proxy failed:', err.message);
    res.status(500).send(`Failed to proxy player: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Audio Scraper API running on http://localhost:${PORT}`);
});
