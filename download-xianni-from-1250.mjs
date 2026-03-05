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
const AUDIO_URL_FILE = path.join(OUTPUT_DIR, 'audio-urls-from-1250.json');
const START_CHAPTER = 1250; // 从第1250章开始

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
  
  return { chapters, tabs };
}

// 获取所有章节
async function fetchAllChapters(bookId) {
  console.log(`📚 获取《${BOOK_TITLE}》章节列表...\n`);
  
  const firstPage = await fetchChapters(bookId, '0');
  const allChapters = [...firstPage.chapters];
  
  console.log(`📄 总页数: ${firstPage.tabs.length} 页`);
  
  for (let i = 1; i < firstPage.tabs.length; i++) {
    const tab = firstPage.tabs[i];
    try {
      const page = await fetchChapters(bookId, tab.offset);
      allChapters.push(...page.chapters);
      process.stdout.write(`\r   获取进度: ${allChapters.length} 章`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`\n   ⚠️ 页 ${i + 1} 获取失败`);
    }
  }
  
  console.log(`\n✅ 总计: ${allChapters.length} 章\n`);
  return allChapters;
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
  console.log(`🎧 《${BOOK_TITLE}》音频下载器 (从第 ${START_CHAPTER} 章开始)`);
  console.log('==========================================\n');
  
  const backendUrl = 'http://localhost:3001';
  
  // 测试后端
  try {
    await axios.get(`${backendUrl}/api/category?id=latest`, { timeout: 5000 });
    console.log('✓ 后端服务可用\n');
  } catch (e) {
    console.log('✗ 后端服务不可用，请先启动: cd backend && node server.js\n');
    return;
  }
  
  // 检查已有进度
  let chapters = null;
  let startIndex = START_CHAPTER - 1; // 0-indexed
  
  if (fs.existsSync(AUDIO_URL_FILE)) {
    console.log('📂 发现已保存的进度，继续...\n');
    chapters = JSON.parse(fs.readFileSync(AUDIO_URL_FILE, 'utf-8'));
  } else {
    // 获取所有章节
    const allChapters = await fetchAllChapters(BOOK_ID);
    
    // 只保留从 START_CHAPTER 开始的章节
    chapters = allChapters.slice(startIndex);
    console.log(`📖 从第 ${START_CHAPTER} 章开始，共 ${chapters.length} 章\n`);
    
    // 保存初始章节列表
    fs.writeFileSync(AUDIO_URL_FILE, JSON.stringify(chapters, null, 2));
  }
  
  const total = chapters.length;
  const completed = chapters.filter(c => c.audioUrl).length;
  
  console.log(`📊 进度: ${completed}/${total} (${(completed/total*100).toFixed(1)}%)\n`);
  
  if (completed === total) {
    console.log('✅ 所有章节URL已获取完成！');
    console.log(`📄 文件: ${AUDIO_URL_FILE}\n`);
    return;
  }
  
  // 批量获取音频URL
  console.log('🎵 开始获取音频URL...\n');
  
  const concurrency = 20;
  let successCount = completed;
  let failCount = 0;
  
  for (let i = 0; i < chapters.length; i += concurrency) {
    if (i >= 50) break; // [测试模式] 限制前 50章

    const batch = chapters.slice(i, Math.min(i + concurrency, chapters.length));
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
      
      // 保存进度
      fs.writeFileSync(AUDIO_URL_FILE, JSON.stringify(chapters, null, 2));
    }
    
    const progress = (successCount / total * 100).toFixed(1);
    process.stdout.write(`\r   [${progress}%] 已获取 ${successCount}/${total} 章 URL...`);
  }
  
  console.log('\n\n==========================================');
  console.log('📊 获取结果');
  console.log('==========================================\n');
  console.log(`✅ 成功: ${successCount} 章`);
  console.log(`❌ 失败: ${failCount} 章`);
  console.log(`📄 文件: ${AUDIO_URL_FILE}`);
  
  const estimatedSizeGB = (successCount * 1.5 / 1024).toFixed(2);
  console.log(`\n💾 预估大小: ${estimatedSizeGB} GB`);
  console.log(`📁 目录: ${OUTPUT_DIR}\n`);
}

main().catch(console.error);
