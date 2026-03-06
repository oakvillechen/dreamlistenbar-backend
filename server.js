import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import CryptoJS from 'crypto-js';
import * as cheerio from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json());

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cwpxcqutrzzkuyaeweir.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3cHhjcXV0cnp6a3V5YWV3ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTcwNTgsImV4cCI6MjA4ODM3MzA1OH0.PvpM1pEk_B1K5xueePctLlxhpwBm6GGaLhhttwF-334';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// ================== 悦听吧音频解密 API ==================
// 解密密钥和IV (从悦听吧JS代码中提取)
const YUETINGBA_KEY = CryptoJS.enc.Base64.parse('le95G3hnFDJsBE+1/v9eYw==');
const YUETINGBA_IV = CryptoJS.enc.Base64.parse('IvswQFEUdKYf+d1wKpYLTg==');
const YUETINGBA_DEFAULT_SERVER = 'http://oss.fileserver.yuetingba.cn:52001';

// 解密 assl 字段获取音频服务器列表
function decryptAssl(assl) {
  try {
    const decrypted = CryptoJS.AES.decrypt(assl, YUETINGBA_KEY, { 
      iv: YUETINGBA_IV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    // 转成字符串
    const hex = decrypted.toString();
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    
    // 解析 JSON
    const servers = JSON.parse(str);
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      }
    });
    
    // 提取 assl 字段
    const asslMatch = bookDetailResp.data.match(/var assl = '([^']+)'/);
    let audioServer = YUETINGBA_DEFAULT_SERVER;
    
    if (asslMatch && asslMatch[1]) {
      const servers = decryptAssl(asslMatch[1]);
      if (servers) {
        const found = findAudioServer(servers, data.bookId);
        if (found) {
          audioServer = found.url;
          console.log(`[YUETINGBA] -> Found audio server for book ${data.bookId}: ${audioServer}`);
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
      creationTime: data.creationTime,
    });
    
  } catch (err) {
    console.error('[YUETINGBA] Error:', err.message);
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
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
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
