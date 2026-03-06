import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cwpxcqutrzzkuyaeweir.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3cHhjcXV0cnp6a3V5YWV3ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTcwNTgsImV4cCI6MjA4ODM3MzA1OH0.PvpM1pEk_B1K5xueePctLlxhpwBm6GGaLhhttwF-334';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let browser = null;

// 广告域名黑名单
const AD_DOMAINS = [
  'googlevideo.com',
  'gvt1.com',
  'doubleclick.net',
  'youtube.com',
  'youtu.be',
];

function isAdUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return AD_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

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

// ================== 音频 API ==================

app.get('/api/audio', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  console.log(`[SERVER] -> Received GET /api/audio?url=${url}`);

  try {
    // 确保 browser 是有效的
    if (!browser || !browser.isConnected()) {
       browser = await chromium.launch({ headless: true });
    }
    
    const context = await browser.newContext();
    const page = await context.newPage();

    let audioSrc = null;

    // 监听网络请求
    page.on('response', async (response) => {
      const responseUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      // 检查是否是音频
      if (contentType.includes('audio/') || contentType.includes('video/') || 
          responseUrl.includes('.m4a') || responseUrl.includes('.mp3')) {
        
        if (isAdUrl(responseUrl)) {
          console.log('[DEBUG] Skipped ad media request:', responseUrl.substring(0, 100));
          return;
        }
        
        console.log('[DEBUG] intercepted valid media request:', responseUrl.substring(0, 100));
        audioSrc = responseUrl;
      }
    });

    // 访问页面
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // 执行测试函数
    try {
      await page.evaluate(() => {
        if (typeof testFun === 'function') {
          testFun();
        }
      });
    } catch (e) {
      console.log('[DEBUG] testFun not available');
    }

    // 等待音频出现
    let waitAttempts = 0;
    while (!audioSrc && waitAttempts < 75) {
      await page.waitForTimeout(200);
      waitAttempts++;
    }
    
    if (!audioSrc) {
      console.log('[DEBUG] First wait timeout, extending...');
      await page.waitForTimeout(3000);
      waitAttempts = 0;
      while (!audioSrc && waitAttempts < 25) {
        await page.waitForTimeout(200);
        waitAttempts++;
      }
    }

    await context.close();

    if (audioSrc) {
      console.log(`[SERVER] -> Found audio URL:`, audioSrc.substring(0, 100));
      return res.json({ success: true, audio_url: audioSrc });
    } else {
      return res.json({ success: false, error: 'Could not extract audio url from the provided page within viewport.' });
    }
  } catch (err) {
    console.error('Error fetching audio:', err);
    return res.json({ success: false, error: 'Failed to access source website.' });
  }
});

// ================== 分类/搜索 API ==================

app.get('/api/category', async (req, res) => {
  const { id = 'latest', page = '0' } = req.query;
  
  try {
    const url = `https://yuetingba.cn/api/book/list?category=${id}&page=${page}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    res.json(data);
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
    const url = `https://yuetingba.cn/api/book/search?keyword=${encodeURIComponent(keyword)}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    res.json(data);
  } catch (err) {
    console.error('[SEARCH] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/book/:id', async (req, res) => {
  const { id } = req.params;
  const { page = '0' } = req.query;

  try {
    const detailUrl = `https://yuetingba.cn/api/book/detail/${id}`;
    const { data: detailData } = await axios.get(detailUrl, { timeout: 10000 });
    
    const chaptersUrl = `https://yuetingba.cn/api/book/chapters/${id}?page=${page}`;
    const { data: chaptersData } = await axios.get(chaptersUrl, { timeout: 10000 });

    res.json({
      success: true,
      book: detailData.data || {},
      chapters: chaptersData.list || [],
      tabs: chaptersData.tabs || [],
    });
  } catch (err) {
    console.error('[BOOK] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 音频代理端点
app.get('/api/proxy-audio', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    console.log(`[PROXY] -> Proxying audio: ${url.substring(0, 100)}...`);
    
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'http://yuetingba.cn/'
      }
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Content-Length', response.headers['content-length'] || 0);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    response.data.pipe(res);
  } catch (err) {
    console.error('[PROXY] Error:', err.message);
    res.status(500).json({ error: 'Failed to proxy audio' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Audio Scraper API running on http://localhost:${PORT}`);
});
