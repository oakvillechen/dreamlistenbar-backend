import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOOK_TITLE = '仙逆';
const DATA_DIR = path.join(__dirname, '..', 'downloads', BOOK_TITLE);
const AUDIO_URL_FILE = path.join(DATA_DIR, 'audio-urls-from-1250.json');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

// 确保音频目录存在
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// 下载单个文件
async function downloadFile(url, outputPath, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 60000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'http://yuetingba.cn/'
        }
      });
      
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// 格式化文件名
function formatFilename(index, title) {
  // 直接使用章节标题，避免加入顺序导致的前缀错乱
  const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
  return `${safeTitle}.mp3`;
}

// 主函数
async function main() {
  console.log('==========================================');
  console.log(`📥 《${BOOK_TITLE}》音频下载器`);
  console.log('==========================================\n');
  
  // 检查音频URL文件
  if (!fs.existsSync(AUDIO_URL_FILE)) {
    console.log('❌ 音频URL文件不存在');
    console.log('请先运行: node download-xianni.mjs\n');
    return;
  }
  
  const chapters = JSON.parse(fs.readFileSync(AUDIO_URL_FILE, 'utf-8'));
  const withUrl = chapters.filter(c => c.audioUrl);
  const withoutUrl = chapters.filter(c => !c.audioUrl);
  
  console.log(`📊 统计信息:`);
  console.log(`   总章节: ${chapters.length}`);
  console.log(`   有音频URL: ${withUrl.length}`);
  console.log(`   无音频URL: ${withoutUrl.length}`);
  
  if (withUrl.length === 0) {
    console.log('\n❌ 没有可下载的音频URL');
    return;
  }
  
  // 检查已下载
  const downloaded = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  const downloadedCount = downloaded.length;
  
  console.log(`   已下载: ${downloadedCount}`);
  console.log(`   待下载: ${withUrl.length - downloadedCount}\n`);
  
  // 统计预估大小
  const estimatedSizeGB = (withUrl.length * 1.5 / 1024).toFixed(2);
  console.log(`💾 预估大小: ${estimatedSizeGB} GB`);
  console.log(`📁 保存位置: ${AUDIO_DIR}\n`);
  
  console.log('🚀 开始下载...\n');
  
  let success = downloadedCount;
  let fail = 0;
  const failed = [];
  
  // 并发控制
  const concurrency = 3;
  const batchSize = 50;
  
  for (let i = 0; i < withUrl.length; i += batchSize) {
    const batch = withUrl.slice(i, Math.min(i + batchSize, withUrl.length));
    
    for (let j = 0; j < batch.length; j += concurrency) {
      const group = batch.slice(j, Math.min(j + concurrency, batch.length));
      
      await Promise.all(group.map(async (chapter, k) => {
        const index = i + j + k;
        const filename = formatFilename(index + 1250, chapter.title);
        const outputPath = path.join(AUDIO_DIR, filename);
        
        // 跳过已下载
        if (fs.existsSync(outputPath)) {
          return;
        }
        
        const progress = ((index + 1) / withUrl.length * 100).toFixed(1);
        process.stdout.write(`\r   [${progress}%] 下载: ${chapter.title.substring(0, 25)}...`);
        
        try {
          await downloadFile(chapter.audioUrl, outputPath);
          success++;
          
          // 每10章保存进度
          if (success % 10 === 0) {
            const progressFile = path.join(DATA_DIR, 'progress.json');
            fs.writeFileSync(progressFile, JSON.stringify({
              total: withUrl.length,
              downloaded: success,
              failed: fail,
              lastUpdate: new Date().toISOString()
            }, null, 2));
          }
        } catch (e) {
          fail++;
          failed.push({ index: index + 1250, title: chapter.title, error: e.message });
        }
      }));
      
      // 批次间延迟
      if (j + concurrency < batch.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    // 批次间延迟
    if (i + batchSize < withUrl.length) {
      console.log(`\n   已完成: ${Math.min(i + batchSize, withUrl.length)}/${withUrl.length} (${((i + batchSize) / withUrl.length * 100).toFixed(1)}%)`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  console.log('\n\n==========================================');
  console.log('📊 下载完成');
  console.log('==========================================\n');
  console.log(`✅ 成功: ${success}`);
  console.log(`❌ 失败: ${fail}`);
  console.log(`📁 位置: ${AUDIO_DIR}`);
  
  // 计算实际大小
  const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  let totalSize = 0;
  files.forEach(f => {
    const stat = fs.statSync(path.join(AUDIO_DIR, f));
    totalSize += stat.size;
  });
  const totalSizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(2);
  console.log(`💾 实际大小: ${totalSizeGB} GB`);
  
  if (failed.length > 0 && failed.length <= 20) {
    console.log('\n失败的章节:');
    failed.forEach(f => {
      console.log(`   ${f.index}. ${f.title} - ${f.error}`);
    });
  }
  
  console.log('\n✅ 完成！');
}

main().catch(console.error);
