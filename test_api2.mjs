import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('request', r => {
        if (r.url().includes('audioSrc') || r.resourceType() === 'media' || r.url().match(/\.(mp3|m4a|m3u8)/)) {
            console.log('REQ:', r.url());
        }
    });
    await page.goto('http://yuetingba.cn/book/detail/3a1c0235-9335-5f9b-b236-e3b92dda9baa/1200', {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2000);
    console.log('--- Clicking specific ting ---');
    try {
        await page.evaluate(() => {
            document.getElementById("iframe_tingPlay").contentWindow.testFun('3a1c0241-acb5-985c-22f9-babcfce46dfa');
        });
    } catch(e) { console.error('Error invoking testFun:', e.message); }
    await page.waitForTimeout(3000);
    const audioUrl = await page.evaluate(() => {
        const frameA = document.getElementById("iframe_tingPlay").contentDocument.querySelector('audio, source');
        return frameA ? frameA.src : null;
    });
    console.log('Extracted audio URL:', audioUrl);
    await browser.close();
})();
