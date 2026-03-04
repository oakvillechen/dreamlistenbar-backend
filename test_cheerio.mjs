import * as cheerio from 'cheerio';
import fs from 'fs';
const html = fs.readFileSync('/Users/guodong.chen/.gemini/antigravity/scratch/test_detail.html', 'utf8');
const $ = cheerio.load(html);
const chapters = [];
$('.ting-list-content-item').each((_, el) => {
    const tId = $(el).attr('id')?.replace('item_', '');
    const title = $(el).find('a[title]').first().text().trim() || $(el).find('a').last().text().trim();
    if (tId && title) chapters.push({tId, title});
});
console.log('Parsed chapters count:', chapters.length);
if (chapters.length > 0) console.log('Sample:', chapters[0]);
