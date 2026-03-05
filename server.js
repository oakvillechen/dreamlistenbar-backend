import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Serve local downloaded audio
app.use('/local-audio', express.static(path.join(__dirname, '../downloads/')));

// 我们使用单例 browser 提高响应速度
let browser;

function formatFilename(index, title) {
  const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
  return `${safeTitle}.mp3`;
}

// 缓存章节信息，提高查找速度
let xianniChaptersCache = null;

function getLocalXianniAudio(tingId, hostHost) {
  if (!xianniChaptersCache) {
    try {
      const urlsFile = path.join(__dirname, '../downloads/仙逆/audio-urls-from-1250.json');
      if (fs.existsSync(urlsFile)) {
        xianniChaptersCache = JSON.parse(fs.readFileSync(urlsFile, 'utf-8'));
      }
    } catch (e) {
      return null;
    }
  }

  if (xianniChaptersCache) {
    const idx = xianniChaptersCache.findIndex(c => c.tingId === tingId);
    if (idx !== -1) {
      const chapter = xianniChaptersCache[idx];
      const filename = formatFilename(idx + 1250, chapter.title);
      const hostUrl = hostHost || process.env.BACKEND_URL || 'http://localhost:3001';
      // 检查文件是否存在
      const audioPath = path.join(__dirname, '../downloads/仙逆/audio', filename);
      if (fs.existsSync(audioPath)) {
         return `${hostUrl}/local-audio/仙逆/audio/${encodeURIComponent(filename)}`;
      } else {
         console.log(`[SERVER] Local audio NOT FOUND even though URL exists in JSON: ${audioPath}`);
      }
    }
  }
  return null;
}

app.get('/api/audio', async (req, res) => {
  const { url } = req.query; 
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid url parameter' });
  }

    console.log(`\n[SERVER] -> Received GET /api/audio?url=${url}`);
  try {
    // 优先返回本地文件 (仅针对已下载的《仙逆》1250章后内容测试)
    let tingIdParam = null;
    if (url.includes('/book/Ting/')) {
       tingIdParam = url.split('/').pop();
       // ---- 停用本地测试方案 ----
       // const protocol = req.headers["x-forwarded-proto"] || req.protocol; const hostStr = protocol + "://" + req.get("host"); const localUrl = getLocalXianniAudio(tingIdParam, hostStr);
       // if (localUrl) {
       //   console.log(`[SERVER] -> Serving local audio for ${tingIdParam}: ${localUrl}`);
       //   return res.json({ success: true, audio_url: localUrl, from_local: true });
       // }
       // ------------------------
    }

    // 确保 browser 是有效的
    if (!browser || !browser.isConnected()) {
       browser = await chromium.launch({ headless: true });
    }
    
    const context = await browser.newContext();
    const page = await context.newPage();
    let audioSrc = null;

    // 屏蔽阻止正常渲染的脚本和其他无用的广告脚本
    await page.route('**/{disable-devtool,fundingchoicesmessages,pagead2,google,baidu}*', route => route.abort());

    // 监听网络请求寻找媒体文件
    page.on('request', request => {
      const type = request.resourceType();
      const reqUrl = request.url();
      
      // 过滤常见广告域名
      const isAd = reqUrl.includes('gvt1.com') || 
                   reqUrl.includes('googlevideo.com') || 
                   reqUrl.includes('doubleclick.net') ||
                   reqUrl.includes('youtube.com');

      if ((type === 'media' || reqUrl.match(/\.(m4a|mp3|m3u8)/i)) && !isAd) {
        if (!audioSrc || audioSrc.includes('gvt1.com')) {
          console.log(`[DEBUG] intercepted valid media request: ${reqUrl}`);
          audioSrc = reqUrl;
        }
      } else if (isAd && (type === 'media' || reqUrl.match(/\.(m4a|mp3|m3u8)/i))) {
        console.log(`[DEBUG] Skipped ad media request: ${reqUrl}`);
      }
    });

    let targetUrl = url;
    let tingId = null;
    if (url.includes('/book/Ting/')) {
       tingId = url.split('/').pop();
       targetUrl = 'http://yuetingba.cn/book/detail/3a1c0235-9335-5f9b-b236-e3b92dda9baa/1'; // Player wrapper
    }

    // 开始访问
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => console.error(e.message));
    
    if (tingId) {
        try {
            await page.waitForFunction(() => {
                const iframe = document.getElementById("iframe_tingPlay");
                return iframe && iframe.contentWindow && typeof iframe.contentWindow.testFun === 'function';
            }, { timeout: 10000 });
            
            await page.evaluate((id) => {
                const iframe = document.getElementById("iframe_tingPlay");
                iframe.contentWindow.testFun(id);
            }, tingId);
            
            let waitAttempts = 0;
            while (!audioSrc && waitAttempts < 75) {  // 增加到15秒
                await page.waitForTimeout(200);
                waitAttempts++;
            }
            
            // 如果还是没找到，再等一会儿
            if (!audioSrc) {
                console.log('[DEBUG] First wait timeout, extending...');
                await page.waitForTimeout(3000);
                waitAttempts = 0;
                while (!audioSrc && waitAttempts < 25) {
                    await page.waitForTimeout(200);
                    waitAttempts++;
                }
            }
        } catch(e) { 
            console.error('[SERVER] Iframe testFun failed:', e.message); 
        }
    } else {
        // 如果没有拦截到，也可能是详情页，点击第一章触发
        if (!audioSrc) {
           await page.waitForTimeout(2000);
           const playBtn = await page.$('.ting-list-content-item-playicon');
           if (playBtn) {
               await playBtn.evaluate(b => b.click());
               await page.waitForTimeout(3000); 
           }
        }
    }

    if (!audioSrc) {
       const innerSrc = await page.evaluate(() => {
           let audioUrl = null;
           // 直接在主页找
           const a = document.querySelector('audio, source');
           if (a && a.src) audioUrl = a.src;
           
           // 如果有 iframe (yuetingba 特色)
           const iframe = document.querySelector('#iframe_tingPlay');
           if (!audioUrl && iframe && iframe.contentDocument) {
               const frameA = iframe.contentDocument.querySelector('audio, source');
               if (frameA && frameA.src) audioUrl = frameA.src;
           }
           return audioUrl;
       }).catch(() => null);
       
       if (innerSrc) {
           audioSrc = innerSrc;
       }
    }

    // 添加获取HTML保存下来，便于查看 playwright 到底看到了什么
    if (!audioSrc) {
       const htmlContent = await page.content();
       try {
           const fs = await import('fs');
           fs.writeFileSync('/tmp/page_error.html', htmlContent);
       } catch (err) {
           console.error('Failed to write debug html:', err.message);
       }
    }

    await context.close();

    if (audioSrc) {
      res.json({ success: true, audio_url: audioSrc });
    } else {
      res.status(404).json({ success: false, error: 'Could not extract audio url from the provided page within viewport.' });
    }
  } catch (err) {
    console.error('Error fetching audio:', err);
    res.status(500).json({ success: false, error: 'Failed to access source website.' });
  }
});

app.get('/api/search', async (req, res) => {
  const { keyword, type = '1' } = req.query; // 1: 书名, 2: 作者, 3: 主播
  if (!keyword) return res.status(400).json({ error: 'Missing keyword parameter' });
  try {
    const url = `http://yuetingba.cn/Search?type=${type}&name=${encodeURIComponent(keyword)}`;
    const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(html);
    const books = [];
    $('.section-box-list-item').each((_, el) => {
      const aNode = $(el).find('.box-list-item-text-title a');
      const title = aNode.text().trim();
      const href = aNode.attr('href'); // /book/detail/3a042a1a.../0
      const bookId = href ? href.split('/')[3] : '';
      const cover = $(el).find('.box-list-item-img img').attr('src');
      const summary = $(el).find('.box-list-item-text-intro').text().trim();
      
      const authorText = $(el).find('span[title]').first().text().trim();
      const speakerText = $(el).find('span[title]').last().text().trim();
      
      if (title && bookId) {
        books.push({ title, bookId, href, cover: cover ? (cover.startsWith('http') ? cover : 'http://yuetingba.cn' + cover) : '', author: authorText, speaker: speakerText, summary });
      }
    });
    res.json({ success: true, list: books });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/category', async (req, res) => {
  const { id = '1', page = '1' } = req.query;
  try {
    const url = id === 'latest' 
        ? `http://yuetingba.cn/top/latest/${page}` 
        : `http://yuetingba.cn/book/${id}/${page}`;
    const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
        books.push({ title, bookId, href, cover: cover ? (cover.startsWith('http') ? cover : 'http://yuetingba.cn' + cover) : '', author: authorText, speaker: speakerText, summary });
      }
    });
    res.json({ success: true, list: books });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/book/:id', async (req, res) => {
  const { id } = req.params;
  const { page = '0' } = req.query;
  try {
    const url = `http://yuetingba.cn/book/detail/${id}/${page}`;
    const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(html);
    
    // Header Info
    const bookTitle = $('.feature-box-detail h1').text().trim() || $('.box-detail-item-title').text().trim();
    const cover = $('.book-info-img img, .box-detail-item-img img').attr('src');
    
    // Chapters
    const chapters = [];
    $('.ting-list-content-item').each((_, el) => {
      const tId = $(el).attr('id')?.replace('item_', '');
      const title = $(el).find('a[title]').first().text().trim() || $(el).find('a').last().text().trim();
      if (tId && title) {
        chapters.push({ tingId: tId, title, url: `http://yuetingba.cn/book/Ting/${tId}` });
      }
    });
    
    // Tabs (Pagination)
    const tabs = [];
    $('.nav-tabs li a').each((_, el) => {
       const tabHref = $(el).attr('href');
       const tabOffset = tabHref ? tabHref.split('/').pop() : '0';
       const tabText = $(el).text().trim();
       tabs.push({ offset: tabOffset, text: tabText });
    });
    
    res.json({
        success: true,
        book: { title: bookTitle, cover: cover ? 'http://yuetingba.cn' + cover : '' },
        chapters,
        tabs
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Audio Scraper API running on http://localhost:${PORT}`);
});
