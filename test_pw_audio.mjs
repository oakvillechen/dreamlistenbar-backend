import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let interceptedAudioUrl = null;
    page.on('request', req => {
        const type = req.resourceType();
        const url = req.url();
        if (type === 'media' || url.includes('.m3u8') || url.includes('.m4a') || url.includes('.mp3')) {
            console.log("INTERCEPTED AUDIO: ", url);
            interceptedAudioUrl = url;
        }
    });

    await page.goto("http://yuetingba.cn/book/Ting/3a1c0241-acb5-985c-22f9-babcfce46dfa", { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000); // give it time to load or fail
    
    await page.screenshot({ path: '/Users/guodong.chen/.gemini/antigravity/scratch/ting_screenshot.png' });
    const html = await page.content();
    fs.writeFileSync('/Users/guodong.chen/.gemini/antigravity/scratch/ting_pw.html', html);

    if (!interceptedAudioUrl) {
        console.log("No audio intercepted. Let's look for audio tag.");
        const innerSrc = await page.evaluate(() => {
            let audioUrl = null;
            const a = document.querySelector('audio, source');
            if (a && a.src) audioUrl = a.src;
            return audioUrl;
        }).catch(() => null);
        console.log("Audio tag src: ", innerSrc);
    }
    
    await browser.close();
})();
