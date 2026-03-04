import { chromium } from 'playwright';
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('request', r => {
        if (r.url().includes('audioSrc') || r.resourceType() === 'media' || r.url().includes('api')) {
            console.log('REQ:', r.url());
        }
    });
    // Use the player wrapper route /tingpage/index... directly to see if we can trigger it
    await page.goto('http://yuetingba.cn/book/detail/3a1c0235-9335-5f9b-b236-e3b92dda9baa/1', {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2000);
    console.log('--- Clicking specific ting ---');
    try {
        await page.evaluate(() => {
            document.getElementById("iframe_tingPlay").contentWindow.testFun('3a154a1f-02f3-11b3-c15c-bbda68a8dc0e');
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
