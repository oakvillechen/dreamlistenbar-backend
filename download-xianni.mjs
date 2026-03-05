import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://yuetingba.cn';
const BOOK_ID = '3a1c0235-9335-5f9b-b236-e3b92dda9baa';
const BOOK_TITLE = '仙逆';
const OUTPUT_DIR = path.join(__dirname, '..', 'downloads', BOOK_TITLE);
const AUDIO_URL_FILE = path.join(OUTPUT_DIR, 'audio-urls.json');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 获取书籍详情和章节列表
async function fetchChapters(bookId, page = '0') {
  const url = `${BASE_URL}/book/detail/${bookId}/${page}`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  });
  
  const $ = cheerio.load(data);
  const bookTitle = $('.feature-box-detail h1').text().trim() || $('.box-detail-item-title').text().trim();
  const cover = $('.book-info-img img, .box-detail-item-img img').attr('src');
  
  const chapters = [];
  $('.ting-list-content-item').each((_, el) => {
    const tId = $(el).attr('id')?.replace('item_', '');
    const title = $(el).find('a[title]').first().text().trim();
    if (tId && title) {
      chapters.push({ tingId: tId, title, audioUrl: null });
    }
  });
  
  const tabs = [];
  $('.nav-tabs li a').each((_, el) => {
    const tabHref = $(el).attr('href');
    const tabOffset = tabHref ? tabHref.split('/').pop() : '0';
    const tabText = $(el).text().trim();
    tabs.push({ offset: tabOffset || '0', text: tabText });
  });
  
  return { bookTitle, cover, chapters, tabs };
}

// 获取所有章节（包括分页）
async function fetchAllChapters(bookId) {
  console.log(`📚 获取《${BOOK_TITLE}》章节列表...\n`);
  
  // 先获取第一页，确定总页数
  const firstPage = await fetchChapters(bookId, '0');
  const allChapters = [...firstPage.chapters];
  
  console.log(`📖 书名: ${firstPage.bookTitle}`);
  console.log(`📑 第一页章节: ${firstPage.chapters.length} 章`);
  console.log(`📄 分页数: ${firstPage.tabs.length} 页\n`);
  
  // 获取其他页
  for (let i = 1; i < firstPage.tabs.length; i++) {
    const tab = firstPage.tabs[i];
    console.log(`   获取第 ${i + 1} 页 (${tab.text})...`);
    
    try {
      const page = await fetchChapters(bookId, tab.offset);
      allChapters.push(...page.chapters);
      console.log(`   ✓ 已获取 ${allChapters.length} 章`);
      
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`   ✗ 获取失败: ${e.message}`);
    }
  }
  
  console.log(`\n✅ 总计: ${allChapters.length} 章\n`);
  return allChapters;
}

// 获取单个章节的音频URL
async function fetchAudioUrl(tingId) {
  const url = `http://yuetingba.cn/book/Ting/${tingId}`;
  
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    
    // 尝试直接从页面提取
    const match = data.match(/(https?:\/\/[^\s"']+\.(m4a|mp3)[^\s"']*)/i);
    if (match) {
      return match[1];
    }
    
    // 尝试找 audio 标签
    const $ = cheerio.load(data);
    const audioSrc = $('audio source').attr('src') || $('audio').attr('src');
    if (audioSrc) {
      return audioSrc.startsWith('http') ? audioSrc : BASE_URL + audioSrc;
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// 使用后端Playwright服务获取音频URL
async function fetchAudioUrlViaBackend(tingId, backendUrl) {
  try {
    const { data } = await axios.get(`${backendUrl}/api/audio`, {
      params: { url: `${BASE_URL}/book/Ting/${tingId}` },
      headers: { 
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 30000
    });
    
    return data.success ? data.audio_url : null;
  } catch (e) {
    return null;
  }
}

// 主函数
async function main() {
  console.log('==========================================');
  console.log(`🎧 《${BOOK_TITLE}》音频下载器`);
  console.log('==========================================\n');
  
  // Step 1: 检查是否有已保存的进度
  let chapters = null;
  const savedFile = AUDIO_URL_FILE;
  
  if (fs.existsSync(savedFile)) {
    console.log('📂 发现已保存的进度，继续...\n');
    chapters = JSON.parse(fs.readFileSync(savedFile, 'utf-8'));
    
    const withUrl = chapters.filter(c => c.audioUrl).length;
    const total = chapters.length;
    console.log(`📊 进度: ${withUrl}/${total} (${(withUrl/total*100).toFixed(1)}%)\n`);
    
    if (withUrl === total) {
      console.log('✅ 所有章节URL已获取完成！');
      console.log('📄 文件: ' + savedFile);
      return;
    }
  } else {
    // Step 1: 获取所有章节
    chapters = await fetchAllChapters(BOOK_ID);
    
    // 保存章节列表
    const chaptersFile = path.join(OUTPUT_DIR, 'chapters.json');
    fs.writeFileSync(chaptersFile, JSON.stringify(chapters, null, 2));
    console.log(`📄 章节列表已保存: ${chaptersFile}\n`);
  }
  
  // Step 2: 获取音频URL
  console.log('🎵 开始获取音频URL...\n');
  console.log('   提示: 使用本地后端服务 (localhost:3001)');
  console.log('   如果ngrok运行中，会自动使用\n');
  
  const backendUrl = 'http://localhost:3001';
  let successCount = 0;
  let failCount = 0;
  const failedChapters = [];
  
  // 先测试后端是否可用
  try {
    await axios.get(`${backendUrl}/api/category?id=latest`, { timeout: 5000 });
    console.log('   ✓ 后端服务可用\n');
  } catch (e) {
    console.log('   ✗ 后端服务不可用，请先启动后端');
    console.log('   运行: cd backend && node server.js\n');
    return;
  }
  
  // 批量获取音频URL
  const concurrency = 10; // 提升到 10 并发
  for (let i = 0; i < chapters.length; i += concurrency) {
    const batch = chapters.slice(i, Math.min(i + concurrency, chapters.length));
    
    // 过滤掉已经有 URL 的章节
    const tasks = batch.filter(c => !c.audioUrl);
    
    if (tasks.length > 0) {
      await Promise.all(tasks.map(async (chapter) => {
        try {
          const audioUrl = await fetchAudioUrlViaBackend(chapter.tingId, backendUrl);
          if (audioUrl) {
            chapter.audioUrl = audioUrl;
            successCount++;
          } else {
            failCount++;
          }
        } catch (e) {
          failCount++;
        }
      }));
      
      // 每次处理完一个 batch 就保存一次，确保进度万无一失
      fs.writeFileSync(AUDIO_URL_FILE, JSON.stringify(chapters, null, 2));
    }

    const completed = chapters.filter(c => c.audioUrl).length;
    const progress = (completed / chapters.length * 100).toFixed(1);
    process.stdout.write(`\r   [${progress}%] 已获取 ${completed}/${chapters.length} 章 URL...`);
  }
  
  // 最终保存
  fs.writeFileSync(AUDIO_URL_FILE, JSON.stringify(chapters, null, 2));
  
  console.log('\n\n==========================================');
  console.log('📊 获取结果');
  console.log('==========================================\n');
  console.log(`✅ 成功: ${successCount} 章`);
  console.log(`❌ 失败: ${failCount} 章`);
  console.log(`📄 音频URL文件: ${AUDIO_URL_FILE}`);
  
  if (failedChapters.length > 0 && failedChapters.length <= 10) {
    console.log('\n失败的章节:');
    failedChapters.forEach(c => {
      console.log(`   ${c.index}. ${c.title}`);
    });
  }
  
  // 统计预估大小
  const estimatedSizeGB = (successCount * 1.5 / 1024).toFixed(2);
  console.log(`\n💾 预估音频大小: ${estimatedSizeGB} GB`);
  console.log(`📁 下载目录: ${OUTPUT_DIR}`);
  
  console.log('\n==========================================');
  console.log('📥 下一步: 下载音频文件');
  console.log('==========================================\n');
  console.log('运行以下命令下载音频:');
  console.log(`  node download-audio.mjs`);
  console.log('');
}

main().catch(console.error);
