import { Storage } from 'megajs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, '..', 'downloads', '仙逆', 'audio');

async function main() {
  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;

  if (!email || !password) {
    console.error('❌ MEGA_EMAIL 和 MEGA_PASSWORD 环境变量未设置！');
    console.error('请在 backend 目录下的 .env 文件中配置：');
    console.error('MEGA_EMAIL=your_mega_email@example.com');
    console.error('MEGA_PASSWORD=your_mega_password');
    process.exit(1);
  }

  console.log('🔄 正在登录 MEGA...');
  
  let storage;
  try {
    storage = await new Storage({
      email,
      password,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }).ready;
    console.log(`✅ 登录成功！账户: ${storage.name || email}`);
  } catch (err) {
    console.error('❌ 登录失败:', err.message);
    process.exit(1);
  }

  // 计算空间
  const info = await storage.getAccountInfo();
  const totalGB = (info.spaceTotal / (1024 ** 3)).toFixed(2);
  const usedGB = (info.spaceUsed / (1024 ** 3)).toFixed(2);
  console.log(`📊 空间使用: ${usedGB} GB / ${totalGB} GB`);

  // 1. 查找或创建 DreamListenBar 目录
  let rootFol = storage.root;
  let dlbFolder = rootFol.children ? rootFol.children.find(f => f.name === 'DreamListenBar' && f.directory) : null;
  
  if (!dlbFolder) {
    console.log('📁 创建目录: DreamListenBar');
    dlbFolder = await storage.mkdir('DreamListenBar');
  } else {
    console.log('📁 找到目录: DreamListenBar');
  }

  // 2. 查找或创建 书籍目录
  const bookName = '仙逆';
  let bookFolder = dlbFolder.children ? dlbFolder.children.find(f => f.name === bookName && f.directory) : null;
  
  if (!bookFolder) {
    console.log(`📁 创建子目录: ${bookName}`);
    bookFolder = await dlbFolder.mkdir(bookName);
  } else {
    console.log(`📁 找到子目录: ${bookName}`);
  }

  // 3. 开始上传文件
  const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  console.log(`\n🚀 准备上传 ${files.length} 个音频文件到 MEGA...`);

  let successCount = 0;
  let failCount = 0;
  
  // existing files check
  const existingFiles = bookFolder.children ? bookFolder.children.map(f => f.name) : [];

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filePath = path.join(AUDIO_DIR, filename);
    const size = fs.statSync(filePath).size;
    const sizeMB = (size / 1024 / 1024).toFixed(2);

    if (existingFiles.includes(filename)) {
      console.log(`   ⏭️ [${i+1}/${files.length}] 已存在，跳过: ${filename}`);
      continue;
    }

    process.stdout.write(`   ⬆️ [${i+1}/${files.length}] 上传中: ${filename} (${sizeMB} MB)...`);
    
    try {
      const stream = fs.createReadStream(filePath);
      await bookFolder.upload({
        name: filename,
        size: size,
        allowUploadBuffering: true
      }, stream).complete; // 等待上传完成
      successCount++;
      console.log(` [完成]`);
    } catch (err) {
      failCount++;
      console.log(` [失败: ${err.message}]`);
    }
  }

  console.log('\n==========================================');
  console.log('🎉 上传总结');
  console.log('==========================================');
  console.log(`✅ 成功: ${successCount}`);
  console.log(`❌ 失败: ${failCount}`);
  console.log(`⏭️ 跳过: ${files.length - successCount - failCount}`);
  console.log('==========================================');
}

main().catch(console.error);
