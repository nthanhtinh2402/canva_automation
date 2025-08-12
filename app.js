require('dotenv').config();
const express = require('express');
// Using GoLogin browser for better stability
const { initializeGologinBrowser, closeBrowser, getBrowser, getPage, saveSessionData, loadCookiesOnly, humanClick, humanType, humanScroll, randomMouseMovement, navigateWithRetry, sleep } = require('./gologin-browser');
const SheetsManager = require('./sheets-manager');
const QueueManager = require('./queue-manager');
const AccountManager = require('./account-manager');

const app = express();
const port = process.env.PORT || 3000;


// API route config via .env
const API_ROUTE_1M = process.env.API_ROUTE_1M || '/addmail1m-sync';
const API_ROUTE_1Y = process.env.API_ROUTE_1Y || '/addmail1y-sync';
const API_ENABLE_1M = (process.env.API_ENABLE_1M || 'true').toLowerCase() !== 'false';
const API_ENABLE_1Y = (process.env.API_ENABLE_1Y || 'true').toLowerCase() !== 'false';
const API_KEY = process.env.API_KEY || process.env.API_TOKEN; // optional auth

function apiAuth(req, res, next) {
    if (!API_KEY) return next();
    const headerKey = req.headers['x-api-key'];
    const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const queryKey = req.query.api_key;
    const key = headerKey || bearer || queryKey;
    if (key && key === API_KEY) return next();
    return res.status(401).json({ success: false, message: 'Unauthorized' });
}

// Message templates (customizable via .env)
const SUCCESS_MSG_TEMPLATE = process.env.SUCCESS_MSG_TEMPLATE || 'Đã mời thành công {email}';
const FAIL_MSG_TEMPLATE = process.env.FAIL_MSG_TEMPLATE || 'Mời {email} không thành công. Vui lòng thử lại sau. (Gợi ý: kiểm tra email có thể đã được mời trước đó hoặc xảy ra lỗi tạm thời từ Canva)';
function formatMessage(tpl, data) {
    return (tpl || '').replace(/\{email\}/g, data.email || '').replace(/\{reason\}/g, data.reason || '');
}


let currentPage;
let currentBrowser;
let isInitializing = false; // Flag để tránh khởi tạo nhiều lần

// Khởi tạo managers
const sheetsManager = new SheetsManager();
const queueManager = new QueueManager();
const accountManager = new AccountManager();


// UI cache for headless (store selectors and coordinates)
const path = require('path');
const fs = require('fs');
const UI_CACHE_FILE = path.join(__dirname, 'user-data', 'ui-cache.json');
function ensureDirExists(dir) { try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {} }
function loadUiCache() {
    try {
        ensureDirExists(path.dirname(UI_CACHE_FILE));
        if (!fs.existsSync(UI_CACHE_FILE)) return {};
        const raw = fs.readFileSync(UI_CACHE_FILE, 'utf8');
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}
function saveUiCache(cache) {
    try {
        ensureDirExists(path.dirname(UI_CACHE_FILE));
        fs.writeFileSync(UI_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch {}
}
function getCachedRegion(key) { const cache = loadUiCache(); return cache[key]; }
function setCachedRegion(key, region) {
    const cache = loadUiCache();
    cache[key] = { ...(cache[key] || {}), ...region };
    saveUiCache(cache);
}
function setCachedSelector(key, selector) {
    if (!selector) return;
    const cache = loadUiCache();
    cache[key] = { ...(cache[key] || {}), selector };
    saveUiCache(cache);
}
async function tryClickCached(key, page) {
    const cached = getCachedRegion(key);
    if (!cached) return false;
    try {
        if (cached.selector) {
            const el = await page.$(cached.selector);
            if (el) {
                await el.click({ delay: 50 });
                console.log(`✓ Click bằng selector cache (${key}): ${cached.selector}`);
                return true;
            }
        }
        const vp = await page.viewport();
        const scaleX = vp.width && cached.viewport?.width ? vp.width / cached.viewport.width : 1;
        const scaleY = vp.height && cached.viewport?.height ? vp.height / cached.viewport.height : 1;
        const cx = Math.round((cached.centerX || 0) * scaleX);
        const cy = Math.round((cached.centerY || 0) * scaleY);
        const clicked = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return false;
            const btn = el.closest('button') || (el.tagName === 'BUTTON' ? el : null);
            if (btn) { btn.click(); return true; }
            el.click();
            return true;
        }, { x: cx, y: cy });
        if (clicked) {
            console.log(`✓ Click bằng vị trí cache (${key}): (${cx}, ${cy})`);
            return true;
        }
    } catch (e) {
        console.log(`⚠️ Không thể click bằng cache (${key}):`, e.message);
    }
    return false;
}
async function cacheElementCenter(page, key, selector) {
    try {
        const rect = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        }, selector);
        if (rect && rect.width > 0 && rect.height > 0) {
            const vp = await page.viewport();
            const centerX = Math.round(rect.left + rect.width / 2);
            const centerY = Math.round(rect.top + rect.height / 2);
            setCachedRegion(key, { centerX, centerY, viewport: { width: vp.width, height: vp.height } });
            setCachedSelector(key, selector);
            console.log(`🧭 Lưu cache (${key}): center=(${centerX},${centerY}), selector=${selector}`);
        }
    } catch {}
}
function clearCachedRegion(key) {
    const cache = loadUiCache();
    if (cache && cache[key]) { delete cache[key]; saveUiCache(cache); console.log(`🧹 Đã xoá cache: ${key}`); }
}

// Map để theo dõi kết quả task


const taskResults = new Map();

// Function để đợi task hoàn thành
async function waitForTaskCompletion(taskId, timeout = 300000) { // 5 phút timeout
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const checkInterval = setInterval(() => {
            // Kiểm tra timeout
            if (Date.now() - startTime > timeout) {
                clearInterval(checkInterval);
                reject(new Error(`Task ${taskId} timeout sau ${timeout/1000} giây`));
                return;
            }

            // Kiểm tra kết quả
            if (taskResults.has(taskId)) {
                const result = taskResults.get(taskId);
                taskResults.delete(taskId); // Cleanup
                clearInterval(checkInterval);
                resolve(result);
                return;
            }
        }, 1000); // Kiểm tra mỗi giây
    });
}

// Event handlers cho queue manager
queueManager.on('executeTask', async (task, callback) => {
    const startTime = Date.now();

    try {
        console.log(`🎯 Thực thi task: ${task.email} (${task.duration})`);

        // Đảm bảo có tài khoản khả dụng trước khi thao tác UI
        const prevAccount = accountManager.getCurrentAccount();
        let currentAccountForTask;
        try {
            currentAccountForTask = await accountManager.ensureActiveAccount();
        } catch (e) {
            console.log('❌ Không có tài khoản On nào khả dụng để xử lý task hiện tại');
            const result = {
                success: false,
                message: 'Không có tài khoản On nào khả dụng',
                processingTime: `${Math.round((Date.now() - startTime) / 1000)}s`
            };
            if (task.id) taskResults.set(task.id, result);
            callback(result);
            return;
        }

        // Nếu tài khoản đã bị chuyển khác, cần khởi tạo lại trình duyệt và đăng nhập
        if (!prevAccount || parseInt(currentAccountForTask.id) !== parseInt(prevAccount.id)) {
            try {
                console.log(`🔄 Đã chuyển account → re-login với ID ${currentAccountForTask.id}`);
                await restartBrowserWithNewAccount(currentAccountForTask);
            } catch (reErr) {
                console.error('❌ Lỗi khi restart browser sau khi chuyển account:', reErr.message);
                const result = {
                    success: false,
                    message: `Không thể khởi tạo lại trình duyệt cho account mới: ${reErr.message}`,
                    processingTime: `${Math.round((Date.now() - startTime) / 1000)}s`
                };
                if (task.id) taskResults.set(task.id, result);
                callback(result);
                return;
            }
        }

        // Thực hiện invite member
        const inviteResult = await inviteMemberToCanva(task.email);

        if (inviteResult.success) {
            // Ghi log vào Google Sheets
            let logResult = false;
            let isDuplicateEmail = false;

            console.log(`📝 Đang ghi log vào Google Sheets cho ${task.email}...`);

            try {
                // Đảm bảo có tài khoản Active khả dụng trước khi ghi log
                const currentAccount = await accountManager.ensureActiveAccount();

                if (task.duration === '1m') {
                    logResult = await sheetsManager.logOneMonth(task.email, currentAccount);
                } else if (task.duration === '1y') {
                    logResult = await sheetsManager.logOneYear(task.email, currentAccount);
                }

                if (logResult) {
                    console.log(`✅ Đã ghi log thành công cho ${task.email}`);
                } else {
                    console.log(`❌ Không ghi được log cho ${task.email}`);
                }
            } catch (logError) {
                if (logError.message.includes('đã được mời trước đó')) {
                    console.log(`⚠️ Email ${task.email} đã được mời trước đó`);
                    isDuplicateEmail = true;

                    // Trả về thất bại cho email trùng
                    const result = {
                        success: false,
                        message: `Email ${task.email} đã được mời trước đó`,
                        isDuplicate: true,
                        processingTime: `${Math.round((Date.now() - startTime) / 1000)}s`
                    };

                    // Lưu kết quả cho sync API
                    if (task.id) {
                        taskResults.set(task.id, result);
                    }

                    callback(result);
                    return;
                } else {
                    console.log(`❌ Lỗi ghi log cho ${task.email}:`, logError.message);
                }
            }

            // Tăng count cho tài khoản hiện tại (chỉ khi không phải email trùng và mời thành công)
            if (!isDuplicateEmail && inviteResult.success) {
                // Log email vào các cột tuần tự trước
                await accountManager.logEmailToSequentialColumns(task.email, task.duration);

                const countIncremented = await accountManager.incrementSuccessCount();

                // Kiểm tra xem có cần relogin không
                let reloginSuccess = true;
                if (countIncremented && countIncremented.needRelogin) {
                    console.log(`🔄 Cần đóng trình duyệt và khởi tạo lại với tài khoản: ${countIncremented.newAccount.username}`);

                    // Đóng trình duyệt hiện tại và khởi tạo lại
                    try {
                        console.log('🚪 Đang đóng trình duyệt và khởi tạo lại...');
                        await restartBrowserWithNewAccount(countIncremented.newAccount);
                        console.log('✅ Đã khởi tạo lại trình duyệt thành công');
                        reloginSuccess = true;
                    } catch (reloginError) {
                        console.error('❌ Lỗi khi khởi tạo lại trình duyệt:', reloginError.message);
                        reloginSuccess = false;

                        // Nếu khởi tạo lại thất bại, cần rollback count
                        console.log('🔄 Rollback count do khởi tạo lại thất bại...');
                        try {
                            await accountManager.rollbackCount();
                        } catch (rollbackError) {
                            console.error('❌ Lỗi rollback count:', rollbackError.message);
                        }
                    }
                }

                // Chỉ tính thành công nếu không cần relogin hoặc relogin thành công
                const finalSuccess = inviteResult.success && reloginSuccess;

                const result = {
                    success: finalSuccess,
                    message: finalSuccess
                        ? formatMessage(SUCCESS_MSG_TEMPLATE, { email: task.email })
                        : formatMessage(FAIL_MSG_TEMPLATE, { email: task.email, reason: (inviteResult.message || (reloginSuccess ? 'Mời thất bại' : 'Login lại thất bại')) }),
                    rawError: inviteResult.message || (reloginSuccess ? 'Mời thất bại' : 'Login lại thất bại'),
                    loggedToSheets: logResult,
                    accountCountIncremented: countIncremented,
                    accountUsed: accountManager.getCurrentAccount()?.username || 'unknown',
                    processingTime: `${Math.round((Date.now() - startTime) / 1000)}s`,
                    accountSwitched: countIncremented?.needRelogin || false
                };

                // Lưu kết quả cho sync API
                if (task.id) {
                    taskResults.set(task.id, result);
                }

                callback(result);
            }
        } else {
            const result = {
                success: false,
                message: formatMessage(FAIL_MSG_TEMPLATE, { email: task.email, reason: inviteResult.message }),
                rawError: inviteResult.message,
                processingTime: `${Math.round((Date.now() - startTime) / 1000)}s`
            };

            // Lưu kết quả cho sync API
            if (task.id) {
                taskResults.set(task.id, result);
            }

            callback(result);
        }

    } catch (error) {
        callback({
            success: false,
            message: error.message
        });
    }
});

queueManager.on('taskCompleted', (task, result) => {
    console.log(`✅ Task hoàn thành: ${task.email} - ${result.message}`);
});

queueManager.on('taskFailed', (task, error) => {
    console.log(`❌ Task thất bại: ${task.email} - ${error.message}`);
    // Cập nhật status trong Google Sheets nếu cần
    sheetsManager.updateStatus(task.email, task.duration, 'Failed').catch(console.error);
});

queueManager.on('queueCompleted', (stats) => {
    console.log('🎉 Hàng đợi đã hoàn thành!');
    console.log(`📊 Thống kê: ${stats.completed} thành công, ${stats.failed} thất bại`);
});

// sleep function đã được import từ puppeteer-browser

/**
 * Hàm gõ chậm như người thật
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @param {string} text - Text to type
 */
async function humanLikeType(page, selector, text) {
    await page.click(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await sleep(100);

    // Gõ từng ký tự với tốc độ ngẫu nhiên
    for (const char of text) {
        await page.keyboard.type(char);
        // Tốc độ gõ ngẫu nhiên từ 50-150ms giữa các ký tự
        const delay = Math.random() * 100 + 50;
        await sleep(delay);
    }
}

/**
 * Hàm mời member vào Canva (dùng cho queue)
 * @param {string} email - Email to invite
 */
async function inviteMemberToCanva(email) {
    const maxAttempts = 3; // tổng 3 lần (1 lần + 2 lần thử lại)
    let lastErrorMsg = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (!currentPage || !currentBrowser) {
                throw new Error('Trình duyệt chưa được khởi tạo');
            }

            console.log(`🎯 Bắt đầu mời: ${email} (lần ${attempt}/${maxAttempts})`);

            // Điều hướng về trang quản lý thành viên mỗi lần thử
            console.log('📍 Điều hướng về trang quản lý thành viên...');
            await currentPage.goto('https://www.canva.com/settings/people', { waitUntil: 'networkidle0', timeout: 30000 });
            await sleep(1500);

            // Tìm và click nút mời thành viên
            console.log('🔍 Tìm và click nút mời thành viên...');
            const inviteClicked = await clickInviteButton(currentPage);
            if (!inviteClicked) {
                throw new Error('Không thể tìm thấy nút mời thành viên');
            }
            await sleep(600);

            // Click "Mời qua email"
            console.log('📧 Click "Mời qua email"...');
            const emailTabClicked = await clickInviteByEmailButton(currentPage);
            if (!emailTabClicked) {
                throw new Error('Không thể tìm thấy tab "Mời qua email"');
            }
            await sleep(600);

            // Nhập email với tốc độ như người thật
            console.log(`⌨️ Nhập email với tốc độ người thật: ${email}`);
            const emailEntered = await enterEmailHumanLike(currentPage, email);
            if (!emailEntered) {
                throw new Error('Không thể nhập email vào form');
            }
            await sleep(600);

            // Click nút "Gửi lời mời"
            console.log('📤 Click nút "Gửi lời mời"...');
            const inviteSent = await clickSendInviteButton(currentPage);
            if (!inviteSent) {
                throw new Error('Không thể gửi lời mời');
            }
            await sleep(1500);

            // Kiểm tra error message từ Canva
            console.log('🔍 Kiểm tra error message từ Canva...');
            const hasError = await checkCanvaErrorMessage(currentPage);
            if (hasError) {
                throw new Error('Canva đã xảy ra lỗi và không thể gửi thư mời. Vui lòng thử lại sau.');
            }

            console.log(`✅ Đã mời thành công: ${email}`);
            return { success: true, message: `Đã gửi lời mời thành công đến ${email}` };
        } catch (error) {
            lastErrorMsg = error?.message || String(error);
            console.error(`❌ Lỗi khi mời ${email} (lần ${attempt}/${maxAttempts}):`, lastErrorMsg);

            if (attempt < maxAttempts) {
                // Hồi phục nhẹ trước khi thử lại: refresh trang và chờ ngẫu nhiên
                try {
                    await currentPage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
                } catch {}
                const backoff = 1000 + Math.floor(Math.random() * 1000) + attempt * 500;
                console.log(`⏳ Chờ ${backoff}ms trước khi thử lại...`);
                await sleep(backoff);
                continue;
            } else {
                // Hết số lần thử
                return { success: false, message: lastErrorMsg };
            }
        }
    }

    // Phòng hờ (không bao giờ tới đây)
    return { success: false, message: lastErrorMsg || 'Không xác định' };
}

/**
 * Hàm nhập email với tốc độ như người thật
 * @param {Page} page - Puppeteer page
 * @param {string} email - Email to enter
 */
async function enterEmailHumanLike(page, email) {
    console.log(`⌨️ Tìm input field để nhập email: ${email}`);

    const emailInputSelectors = [
        'input[type="email"]',
        'input[placeholder*="email"]',
        'input[placeholder*="Email"]',
        'input[name="email"]',
        'input[aria-label*="email"]',
        'textarea[placeholder*="email"]',
        'input[data-testid*="email"]'
    ];

    for (const selector of emailInputSelectors) {
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 3000 });

            // Nhập email với tốc độ như người thật
            await page.click(selector);
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await sleep(100);

            // Gõ từng ký tự với tốc độ ngẫu nhiên
            for (const char of email) {
                await page.keyboard.type(char);
                // Tốc độ gõ ngẫu nhiên từ 80-200ms giữa các ký tự (như người thật)
                const delay = Math.random() * 120 + 80;
                await sleep(delay);
            }

            console.log('✅ Đã nhập email với tốc độ người thật');
            return true;
        } catch (error) {
            console.log(`❌ Không tìm thấy input với selector: ${selector}`);
        }
    }

    return false;
}

/**
 * CRITICAL FIX: Kiểm tra error message từ Canva
 * @param {import('puppeteer').Page} page - Thể hiện của trang Puppeteer
 * @returns {Promise<boolean>} True nếu có error message
 */
async function checkCanvaErrorMessage(page) {
    try {
        console.log('🔍 Đang kiểm tra error message từ Canva...');

        // Chờ một chút để error message hiển thị
        await sleep(1000);

        // Kiểm tra error message cụ thể từ Canva
        const hasError = await page.evaluate(() => {
            // Tìm error message với text cụ thể
            const errorTexts = [
                'Canva đã xảy ra lỗi và không thể gửi thư mời của bạn',
                'Canva đã xảy ra lỗi và không thể gửi thư mời',
                'không thể gửi thư mời',
                'xảy ra lỗi',
                'Something went wrong',
                'Unable to send invitation',
                'Error sending invitation'
            ];

            // Tìm trong tất cả text content
            const allText = document.body.innerText || document.body.textContent || '';

            for (const errorText of errorTexts) {
                if (allText.toLowerCase().includes(errorText.toLowerCase())) {
                    console.log('Found error text:', errorText);
                    return true;
                }
            }

            // Tìm error alert/notification elements
            const errorSelectors = [
                '[role="alert"]',
                '.error',
                '.alert',
                '.notification',
                '.toast',
                '.message',
                '[class*="error"]',
                '[class*="alert"]',
                '[class*="notification"]'
            ];

            for (const selector of errorSelectors) {
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    const text = element.innerText || element.textContent || '';
                    if (text && (text.includes('lỗi') || text.includes('error') || text.includes('thất bại'))) {
                        console.log('Found error element:', text);
                        return true;
                    }
                }
            }

            return false;
        });

        if (hasError) {
            console.log('❌ Phát hiện error message từ Canva');
            return true;
        } else {
            console.log('✅ Không có error message');
            return false;
        }

    } catch (error) {
        console.log('⚠️ Lỗi khi kiểm tra error message:', error.message);
        return false; // Nếu không kiểm tra được, coi như không có lỗi
    }
}

/**
 * Click vào nút "Mời thành viên" dựa trên HTML cụ thể
 * @param {import('puppeteer').Page} page - Thể hiện của trang Puppeteer
 * @returns {Promise<boolean>} True nếu click thành công
 */
async function clickInviteButton(page) {
    console.log('Tìm nút "Mời thành viên" với nhiều phương pháp...');

    try {
        // Ưu tiên dùng cache (selector/toạ độ)
        if (await tryClickCached('invite_button', page)) return true;

        // Phương pháp 1: Tìm theo text content
        const inviteTexts = ['Mời thành viên', 'Invite members', 'Add members', 'Invite people'];

        for (const text of inviteTexts) {
            const found = await page.evaluate((searchText) => {
                // Tìm tất cả các element có text phù hợp
                const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                    return el.textContent && el.textContent.trim() === searchText;
                });

                for (const element of elements) {
                    // Tìm button gần nhất
                    const button = element.closest('button') ||
                                 (element.tagName === 'BUTTON' ? element : null) ||
                                 element.querySelector('button');

                    if (button && button.offsetParent !== null) { // Visible check
                        button.setAttribute('data-invite-button', 'found');
                        return true;
                    }
                }
                return false;
            }, text);

            if (found) {
                await page.click('[data-invite-button="found"]', { delay: 100 });
                await cacheElementCenter(page, 'invite_button', '[data-invite-button="found"]');
                console.log(`✓ Đã click nút mời với text: "${text}"`);
                return true;
            }
        }

        // Phương pháp 2: Tìm theo các selector phổ biến
        const inviteSelectors = [
            'button[aria-label*="invite"]',
            'button[aria-label*="Invite"]',
            'button[aria-label*="mời"]',
            'button[data-testid*="invite"]',
            // ':has-text' không phải của Puppeteer, giữ lại cho một số môi trường hỗ trợ
            'button:has-text("Mời thành viên")',
            'button:has-text("Invite members")',
            '[role="button"]:has-text("Mời thành viên")',
            '.invite-button',
            '.add-member-button'
        ];

        for (const selector of inviteSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.click(selector, { delay: 100 });
                await cacheElementCenter(page, 'invite_button', selector);
                console.log(`✓ Đã click nút mời với selector: ${selector}`);
                return true;
            } catch (error) {
                console.log(`Không tìm thấy selector: ${selector}`);
            }
        }

        console.log('✗ Không tìm thấy nút "Mời thành viên" với bất kỳ phương pháp nào');
        return false;

    } catch (error) {
        console.error('Lỗi khi click nút mời:', error.message);
        return false;
    }
}

/**
 * Click vào nút "Mời qua email" dựa trên HTML cụ thể
 * @param {import('puppeteer').Page} page - Thể hiện của trang Puppeteer
 * @returns {Promise<boolean>} True nếu click thành công
 */
async function clickInviteByEmailButton(page) {
    console.log('Tìm nút "Mời qua email" với nhiều phương pháp...');

    try {
        // Ưu tiên cache
        if (await tryClickCached('invite_by_email', page)) return true;

        // Phương pháp 1: Tìm theo text content
        const emailTexts = ['Mời qua email', 'Invite via email', 'Email invite', 'By email'];

        for (const text of emailTexts) {
            const found = await page.evaluate((searchText) => {
                // Tìm tất cả các element có text phù hợp
                const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                    return el.textContent && el.textContent.trim() === searchText;
                });

                for (const element of elements) {
                    // Tìm button hoặc tab gần nhất
                    const button = element.closest('button') ||
                                 element.closest('[role="tab"]') ||
                                 (element.tagName === 'BUTTON' ? element : null);

                    if (button && button.offsetParent !== null) { // Visible check
                        button.setAttribute('data-email-button', 'found');
                        return true;
                    }
                }
                return false;
            }, text);

            if (found) {
                await page.click('[data-email-button="found"]', { delay: 100 });
                await cacheElementCenter(page, 'invite_by_email', '[data-email-button="found"]');
                console.log(`✓ Đã click nút email với text: "${text}"`);
                return true;
            }
        }

        // Phương pháp 2: Tìm theo các selector phổ biến
        const emailSelectors = [
            'button[role="tab"]:has-text("email")',
            'button[role="tab"]:has-text("Email")',
            'button[role="tab"]:has-text("Mời qua email")',
            '[role="tab"][aria-label*="email"]',
            'button[data-testid*="email"]',
            '.email-tab',
            '.invite-email-tab'
        ];

        for (const selector of emailSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.click(selector, { delay: 100 });
                await cacheElementCenter(page, 'invite_by_email', selector);
                console.log(`✓ Đã click tab email với selector: ${selector}`);
                return true;
            } catch (error) {
                console.log(`Không tìm thấy selector: ${selector}`);
            }
        }

        console.log('✗ Không tìm thấy nút "Mời qua email" với bất kỳ phương pháp nào');
        return false;

    } catch (error) {
        console.error('Lỗi khi click nút mời qua email:', error.message);
        return false;
    }
}

/**
 * Click vào nút "Gửi lời mời" dựa trên HTML cụ thể
 * @param {import('puppeteer').Page} page - Thể hiện của trang Puppeteer
 * @returns {Promise<boolean>} True nếu click thành công
 */
async function clickSendInviteButton(page) {
    console.log('Tìm nút "Gửi lời mời" với nhiều phương pháp...');

    try {
        // Ưu tiên cache
        if (await tryClickCached('send_invite', page)) return true;

        // Phương pháp 1: Tìm theo text content
        const sendTexts = ['Gửi lời mời', 'Send invite', 'Send invitation', 'Send', 'Invite'];

        for (const text of sendTexts) {
            const found = await page.evaluate((searchText) => {
                // Tìm tất cả các element có text phù hợp
                const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                    return el.textContent && el.textContent.trim() === searchText;
                });

                for (const element of elements) {
                    // Tìm button gần nhất
                    const button = element.closest('button') ||
                                 (element.tagName === 'BUTTON' ? element : null);

                    if (button && button.offsetParent !== null) { // Visible check
                        button.setAttribute('data-send-button', 'found');
                        return true;
                    }
                }
                return false;
            }, text);

            if (found) {
                await page.click('[data-send-button="found"]', { delay: 100 });
                await cacheElementCenter(page, 'send_invite', '[data-send-button="found"]');
                console.log(`✓ Đã click nút gửi với text: "${text}"`);
                return true;
            }
        }

        // Phương pháp 2: Tìm theo các selector phổ biến
        const sendSelectors = [
            'button[type="submit"]',
            'button[aria-label*="send"]',
            'button[aria-label*="Send"]',
            'button[aria-label*="gửi"]',
            'button[data-testid*="send"]',
            'button[data-testid*="invite"]',
            '.send-button',
            '.invite-send-button',
            '.submit-button'
        ];

        for (const selector of sendSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.click(selector, { delay: 100 });
                await cacheElementCenter(page, 'send_invite', selector);
                console.log(`✓ Đã click nút gửi với selector: ${selector}`);
                return true;
            } catch (error) {
                console.log(`Không tìm thấy selector: ${selector}`);
            }
        }

        console.log('✗ Không tìm thấy nút "Gửi lời mời" với bất kỳ phương pháp nào');
        return false;

    } catch (error) {
        console.error('Lỗi khi click nút gửi lời mời:', error.message);
        return false;
    }
}





/**
 * Tìm và nhập email vào input field như người thật
 * @param {import('puppeteer').Page} page - Thể hiện của trang Puppeteer
 * @param {string} email - Email cần nhập
 * @returns {Promise<boolean>} True nếu nhập thành công
 */
async function typeEmailInInput(page, email) {
    console.log(`Tìm input field để nhập email: ${email}`);

    try {
        // Tìm input field bằng nhiều cách khác nhau
        const inputSelector = await page.evaluate(() => {
            // Thử tìm input có thể nhập email
            const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])');
            for (const input of inputs) {
                // Kiểm tra nếu input visible và có thể nhập
                if (input.offsetParent !== null && !input.disabled && !input.readOnly) {
                    // Kiểm tra placeholder hoặc attributes liên quan đến email
                    const placeholder = input.placeholder?.toLowerCase() || '';
                    const autocomplete = input.autocomplete?.toLowerCase() || '';
                    const inputmode = input.inputMode?.toLowerCase() || '';

                    if (placeholder.includes('email') ||
                        autocomplete.includes('email') ||
                        inputmode.includes('email') ||
                        autocomplete.includes('team-member')) {
                        input.setAttribute('data-email-input', 'found');
                        return '[data-email-input="found"]';
                    }
                }
            }
            return null;
        });

        if (inputSelector) {
            // Click vào input để focus
            await page.click(inputSelector);
            await sleep(200);

            // Xóa nội dung cũ nếu có
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await sleep(100);

            // Nhập email
            await page.keyboard.type(email);
            await sleep(300);

            // Trigger events để đảm bảo form nhận diện input
            await page.evaluate((selector) => {
                const input = document.querySelector(selector);
                if (input) {
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            }, inputSelector);

            console.log('✓ Đã nhập email thành công');
            return true;
        } else {
            console.log('✗ Không tìm thấy input field phù hợp');
            return false;
        }
    } catch (error) {
        console.error('Lỗi khi nhập email:', error.message);
        return false;
    }
}

/**
 * Tìm và click vào một phần tử chứa văn bản cụ thể.
 * Hàm này dùng cho các nút có văn bản rõ ràng mà selector khác khó bắt.
 * @param {import('puppeteer').Page} page - Thể hiện của trang Puppeteer.
 * @param {string} textToClick - Văn bản cần tìm và click.
 * @param {string} [parentSelector='*'] - Selector CSS hoặc XPath của phần tử cha để giới hạn phạm vi tìm kiếm (mặc định là toàn bộ trang).
 * @param {number} [timeout=30000] - Thời gian chờ tối đa cho phần tử xuất hiện.
 * @returns {Promise<boolean>} True nếu tìm thấy và click thành công, ngược lại là false.
 */
async function clickElementByText(page, textToClick, parentSelector = '*', timeout = 30000) {
    console.log(`Đang tìm và click văn bản: "${textToClick}" trong phạm vi: "${parentSelector}"`);

    try {
        // Sử dụng page.evaluate để tìm element chứa text
        const elementFound = await page.evaluate((text, parent) => {
            const elements = document.querySelectorAll(`${parent} *`);
            for (let element of elements) {
                if (element.textContent && element.textContent.toLowerCase().includes(text.toLowerCase())) {
                    // Tạo một unique identifier cho element
                    element.setAttribute('data-temp-id', 'temp-click-target');
                    return true;
                }
            }
            return false;
        }, textToClick, parentSelector);

        if (elementFound) {
            // Chờ element xuất hiện và click
            await page.waitForSelector('[data-temp-id="temp-click-target"]', { visible: true, timeout: timeout });
            console.log(`Đã tìm thấy văn bản "${textToClick}". Đang click...`);
            await page.click('[data-temp-id="temp-click-target"]', { delay: 50 });

            // Xóa attribute tạm thời
            await page.evaluate(() => {
                const element = document.querySelector('[data-temp-id="temp-click-target"]');
                if (element) {
                    element.removeAttribute('data-temp-id');
                }
            });

            return true;
        } else {
            console.error(`Không tìm thấy phần tử chứa văn bản "${textToClick}".`);
            return false;
        }
    } catch (error) {
        console.error(`Lỗi khi tìm hoặc click văn bản "${textToClick}":`, error);
        return false;
    }
}


// Hàm đăng nhập vào Canva với tài khoản cụ thể
async function loginToCanva(account) {
    try {
        console.log(`🔑 Bắt đầu đăng nhập với tài khoản: ${account.username}`);

        // Điều hướng đến trang login
        await currentPage.goto('https://www.canva.com/login/', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        await sleep(3000);

        // Tìm và click nút "Continue with email"
        console.log('Tìm nút "Continue with email"...');
        const continueEmailClicked = await clickElementByText(currentPage, 'Continue with email', 'button', 10000);

        if (!continueEmailClicked) {
            // Thử các text khác
            const alternativeTexts = ['Tiếp tục với email', 'Email', 'Log in with email'];
            for (const text of alternativeTexts) {
                const clicked = await clickElementByText(currentPage, text, 'button', 5000);
                if (clicked) {
                    console.log(`✓ Đã click "${text}"`);
                    break;
                }
            }
        }

        await sleep(3000);

        // Tìm trường email
        console.log('Tìm trường email...');
        const emailSelector = 'input[type="email"], input[name="email"], input[placeholder*="email"]';
        await currentPage.waitForSelector(emailSelector, { visible: true, timeout: 10000 });

        // Nhập email
        console.log(`Nhập email: ${account.username}`);
        await currentPage.type(emailSelector, account.username, { delay: 50 });
        await sleep(500);

        // Nhấn Enter
        await currentPage.keyboard.press('Enter');
        await sleep(5000);

        // Tìm trường password
        console.log('Tìm trường password...');
        const passwordSelector = 'input[type="password"], input[name="password"]';
        await currentPage.waitForSelector(passwordSelector, { visible: true, timeout: 15000 });

        // Nhập password
        console.log('Nhập password...');
        await currentPage.type(passwordSelector, account.password, { delay: 50 });
        await sleep(500);

        // Nhấn Enter để đăng nhập
        await currentPage.keyboard.press('Enter');

        // Chờ đăng nhập thành công
        console.log('Chờ đăng nhập hoàn tất...');
        await sleep(10000);

        // Điều hướng đến trang quản lý thành viên
        console.log('Điều hướng đến trang quản lý thành viên...');
        await currentPage.goto('https://www.canva.com/settings/people', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        await sleep(3000);

        // Kiểm tra xem có nút "Mời thành viên" không
        const inviteButtonFound = await clickElementByText(currentPage, 'Mời thành viên', '*', 5000);
        if (inviteButtonFound) {
            // Đóng popup nếu mở
            await currentPage.keyboard.press('Escape');
            await sleep(1000);
            console.log('✓ Đã tìm thấy nút "Mời thành viên" - đăng nhập thành công');
        }

        // Lưu session data
        await saveSessionData(currentPage);

        return true;

    } catch (error) {
        console.error('❌ Lỗi đăng nhập:', error.message);
        throw error;
    }
}

// Hàm đóng trình duyệt và khởi tạo lại với tài khoản mới
async function restartBrowserWithNewAccount(newAccount) {
    try {
        console.log(`🔄 Đang đóng trình duyệt hiện tại...`);

        // Bước 1: Đóng trình duyệt hiện tại hoàn toàn
        if (currentBrowser) {
            try {
                await currentBrowser.close();
                console.log('✓ Đã đóng trình duyệt');
            } catch (closeError) {
                console.log('⚠️ Lỗi khi đóng trình duyệt:', closeError.message);
            }
        }

        // Bước 2: Reset các biến global
        currentBrowser = null;
        currentPage = null;

        // Bước 3: Đóng GoLogin browser nếu có
        const { closeBrowser } = require('./gologin-browser');
        try {
            await closeBrowser();
            console.log('✓ Đã đóng GoLogin browser');
        } catch (gologinError) {
            console.log('⚠️ Lỗi khi đóng GoLogin:', gologinError.message);
        }

        // Bước 4: Chờ một chút để đảm bảo tất cả đã đóng
        await sleep(3000);

        // Bước 5: Reset flag để cho phép khởi tạo lại
        isInitializing = false;

        // Bước 6: Khởi tạo lại trình duyệt với tài khoản mới
        console.log(`🚀 Đang khởi tạo lại trình duyệt với tài khoản: ${newAccount.username}`);

        // Gọi lại setupBrowserAndLogin để khởi tạo hoàn toàn từ đầu (bỏ qua check isInitializing)
        await setupBrowserAndLogin(true);

        console.log(`✅ Đã khởi tạo lại trình duyệt thành công với tài khoản: ${newAccount.username}`);

        return true;

    } catch (error) {
        console.error('❌ Lỗi khởi tạo lại trình duyệt:', error.message);
        throw error;
    }
}

async function setupBrowserAndLogin(forceRestart = false) {
    try {
        // Kiểm tra xem có đang khởi tạo không (trừ khi là restart)
        if (isInitializing && !forceRestart) {
            console.log('⏳ Hệ thống đang khởi tạo, chờ hoàn tất...');
            // Chờ cho đến khi khởi tạo xong
            while (isInitializing) {
                await sleep(1000);
            }
            console.log('✅ Hệ thống đã khởi tạo xong, sử dụng instance hiện tại');
            return;
        }

        // Đặt flag để tránh khởi tạo nhiều lần
        isInitializing = true;

        if (forceRestart) {
            console.log('🔄 Khởi tạo lại hệ thống (restart mode)...');
        } else {
            console.log('🚀 Bắt đầu khởi tạo hệ thống...');
        }

        // Khởi tạo Account Manager trước (chỉ khi không phải restart)
        if (!forceRestart) {
            console.log('👤 Khởi tạo Account Manager...');
        } else {
            console.log('👤 Sử dụng lại Account Manager hiện tại...');
        }

        // Chỉ khởi tạo Account Manager khi không phải restart
        if (!forceRestart) {
            const accountInitialized = await accountManager.initialize();
            if (!accountInitialized) {
                throw new Error('Không thể khởi tạo Account Manager');
            }
        }

        console.log('🌐 Khởi tạo GoLogin browser và đăng nhập Canva...');
        const { browser, page } = await initializeGologinBrowser();
        currentBrowser = browser;
        currentPage = page;
        await currentPage.bringToFront();
        console.log('Trình duyệt đã được khởi tạo thành công.');



        // --- Logic kiểm tra đăng nhập đáng tin cậy hơn ---
        console.log('Kiểm tra trạng thái đăng nhập...');
        try {
            console.log('Cố gắng điều hướng đến trang quản lý thành viên để kiểm tra đăng nhập...');
            await currentPage.goto('https://www.canva.com/settings/people', {
                waitUntil: 'networkidle0',
                timeout: 30000
            });



            // Sử dụng clickElementByText cho nút "Mời thành viên" để kiểm tra sự tồn tại
            const isInviteButtonVisible = await clickElementByText(currentPage, 'Mời thành viên', '*', 10000); // Chỉ kiểm tra sự tồn tại
            if (isInviteButtonVisible) {
                console.log('✅ Đã đăng nhập sẵn và ở đúng trang quản lý thành viên. Bỏ qua các bước đăng nhập.');
                isInitializing = false; // CRITICAL FIX: Reset flag
                return; // Return sớm khi đã login
            } else {
                 console.log('❌ Chưa đăng nhập hoặc session đã hết hạn/không hợp lệ. Bắt đầu quá trình đăng nhập đầy đủ...');
            }

        } catch (checkError) {
            console.log('Chưa đăng nhập hoặc session đã hết hạn/không hợp lệ. Bắt đầu quá trình đăng nhập đầy đủ...');
        }
        // --- Kết thúc logic kiểm tra đăng nhập ---


        // Bước 1: Điều hướng đến trang đăng nhập Canva
        console.log('Điều hướng đến trang đăng nhập Canva...');
        await currentPage.goto('https://www.canva.com/login/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await currentPage.evaluate(() => {
            window.scrollBy(0, window.innerHeight);
        });
        await sleep(500);

        // Bước 2: Tìm và click vào nút "Tiếp tục với email" với human behavior
        console.log('🤖 Thêm human-like behavior trước khi tìm nút email...');

        // Random mouse movements để tránh detection
        for (let i = 0; i < 3; i++) {
            await randomMouseMovement(currentPage);
            await sleep(Math.random() * 1000 + 500);
        }

        // Human-like scroll
        await humanScroll(currentPage);

        console.log('Tìm nút "Tiếp tục với email"...');
        await sleep(2000 + Math.random() * 2000);

        let clickedContinueEmail = false;

        try {
            // Tìm nút thứ 3 với text "Tiếp tục với email"
            const emailButton = await currentPage.evaluate(() => {
                const spans = document.querySelectorAll('span.khPe7Q');
                for (const span of spans) {
                    if (span.textContent && span.textContent.trim() === 'Tiếp tục với email') {
                        const button = span.closest('button');
                        if (button) {
                            button.setAttribute('data-email-login', 'found');
                            return true;
                        }
                    }
                }
                return false;
            });

            if (emailButton) {
                await currentPage.click('[data-email-login="found"]', { delay: 100 });
                console.log('✓ Đã click nút "Tiếp tục với email" thành công');
                clickedContinueEmail = true;
            }
        } catch (error) {
            console.log('Lỗi khi tìm nút email:', error.message);
        }

        // Fallback: Phương pháp đã test thành công - Phân tích tất cả buttons
        if (!clickedContinueEmail) {
            console.log('🔍 Fallback: Sử dụng phương pháp phân tích buttons...');

            // Debug: Chụp screenshot để xem trang hiện tại (với error handling)
            try {
                await currentPage.screenshot({ path: 'debug-canva-login.png', fullPage: true });
                console.log('📸 Debug screenshot: debug-canva-login.png');
            } catch (screenshotError) {
                console.log('⚠️ Không thể chụp screenshot:', screenshotError.message);
            }

            // Debug: Kiểm tra title và URL
            const currentTitle = await currentPage.title();
            const currentUrl = await currentPage.url();
            console.log('📄 Current title:', currentTitle);
            console.log('🔗 Current URL:', currentUrl);

            // Debug: Kiểm tra có bị Cloudflare block không
            if (currentTitle.includes('Just a moment') || currentTitle.includes('Attention Required') || currentTitle.includes('Checking your browser')) {
                console.log('🛡️ DETECTED: Cloudflare protection active!');
                console.log('⚠️ Need to bypass Cloudflare first');
                throw new Error('Cloudflare protection detected. Cannot proceed with login.');
            }

            try {
                const allButtons = await currentPage.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
                    const buttonDetails = buttons.map((btn, index) => {
                        const rect = btn.getBoundingClientRect();
                        return {
                            index: index,
                            text: btn.textContent?.trim(),
                            tagName: btn.tagName,
                            className: btn.className,
                            id: btn.id,
                            visible: rect.width > 0 && rect.height > 0 && btn.offsetParent !== null,
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2
                        };
                    }).filter(btn => btn.visible);

                    // Debug: Log all button details
                    console.log('🔍 All visible buttons:', buttonDetails.map(btn => ({
                        text: btn.text,
                        tagName: btn.tagName,
                        className: btn.className
                    })));

                    return buttonDetails.filter(btn => btn.text);
                });

                console.log(`📋 Tìm thấy ${allButtons.length} buttons visible`);

                // Tìm button theo thứ tự ưu tiên
                const buttonTexts = [
                    'continue with email',
                    'tiếp tục với email',
                    'tiếp tục với tài khoản khác',
                    'continue with another account'
                ];

                let targetButton = null;

                // Tìm button chính xác theo text
                for (const text of buttonTexts) {
                    targetButton = allButtons.find(btn =>
                        btn.text.toLowerCase() === text
                    );
                    if (targetButton) {
                        console.log(`✅ Tìm thấy "${targetButton.text}" tại (${Math.round(targetButton.x)}, ${Math.round(targetButton.y)})`);
                        break;
                    }
                }

                // Nếu không tìm thấy chính xác, tìm button có chứa từ khóa
                if (!targetButton) {
                    const keywords = ['email', 'tiếp tục', 'continue', 'tài khoản'];

                    for (const keyword of keywords) {
                        const buttons = allButtons.filter(btn =>
                            btn.text.toLowerCase().includes(keyword)
                        );

                        if (buttons.length > 0) {
                            targetButton = buttons[0];
                            console.log(`📧 Tìm thấy button chứa "${keyword}": "${targetButton.text}"`);
                            break;
                        }
                    }
                }

                if (targetButton) {
                    console.log(`🎯 Click "${targetButton.text}" tại (${Math.round(targetButton.x)}, ${Math.round(targetButton.y)})`);
                    await currentPage.mouse.click(targetButton.x, targetButton.y);
                    clickedContinueEmail = true;
                    console.log('✅ Đã click button thành công!');
                }

            } catch (e) {
                console.log('❌ Lỗi phân tích buttons:', e.message);
            }
        }

        if (!clickedContinueEmail) {
            console.log('🔍 Không tìm thấy nút bằng selector, thử sử dụng OCR...');

            // Fallback: Sử dụng OCR để tìm và click nút
            const ocrTexts = [
                'Tiếp tục với email',
                'Continue with email',
                'Tiếp tục với tài khoản khác',
                'Continue with another account',
                'Email',
                'Đăng nhập bằng email'
            ];

            for (const text of ocrTexts) {
                console.log(`🔍 OCR: Tìm text "${text}"...`);
                const ocrClicked = await clickElementByText(currentPage, text, '*', 5000);
                if (ocrClicked) {
                    console.log(`✅ OCR: Đã click thành công "${text}"`);
                    clickedContinueEmail = true;
                    break;
                }
            }

            if (!clickedContinueEmail) {
                // Thử chụp screenshot để debug
                try {
                    await currentPage.screenshot({ path: 'debug-login-failed.png', fullPage: true });
                    console.log('📸 Đã chụp screenshot debug: debug-login-failed.png');
                } catch (screenshotError) {
                    console.log('Không thể chụp screenshot:', screenshotError.message);
                }

                throw new Error('Không thể tìm thấy nút đăng nhập bằng cả selector và OCR.');
            }
        }

        // Chờ lâu hơn để trang load hoàn toàn
        console.log('Chờ trang load sau khi click "Tiếp tục với tài khoản khác"...');
        await sleep(5000);

        // Kiểm tra URL hiện tại
        console.log('Kiểm tra URL hiện tại...');
        const currentUrl = currentPage.url();
        console.log('🔗 URL hiện tại:', currentUrl);

        // Sau khi click "Tiếp tục với tài khoản khác", trang sẽ quay về giao diện đăng nhập ban đầu
        // Cần tìm lại nút "Tiếp tục với email" hoặc "Continue with email"
        console.log('🔍 Tìm lại nút "Tiếp tục với email" sau khi chuyển giao diện...');

        let foundEmailButton = false;
        const emailButtonTexts = [
            'Tiếp tục với email',
            'Continue with email',
            'Email',
            'Đăng nhập bằng email',
            'Log in with email'
        ];

        for (const buttonText of emailButtonTexts) {
            console.log(`🔍 Tìm nút: "${buttonText}"`);
            const emailButtonClicked = await clickElementByText(currentPage, buttonText, 'button', 5000);
            if (emailButtonClicked) {
                console.log(`✅ Đã click nút "${buttonText}" thành công!`);
                foundEmailButton = true;
                break;
            }
        }

        if (!foundEmailButton) {
            console.log('⚠️ Không tìm thấy nút email, thử phân tích lại tất cả buttons...');

            // Fallback: Phân tích lại tất cả buttons
            try {
                const allButtons = await currentPage.$$eval('button', buttons =>
                    buttons.filter(btn => btn.offsetParent !== null).map(btn => ({
                        text: btn.textContent.trim(),
                        x: btn.getBoundingClientRect().x + btn.getBoundingClientRect().width / 2,
                        y: btn.getBoundingClientRect().y + btn.getBoundingClientRect().height / 2
                    }))
                );

                console.log(`📋 Tìm thấy ${allButtons.length} buttons sau khi chuyển giao diện`);

                // Tìm button có chứa "email" hoặc "tiếp tục"
                const emailButton = allButtons.find(btn =>
                    btn.text.toLowerCase().includes('email') ||
                    btn.text.toLowerCase().includes('tiếp tục') ||
                    btn.text.toLowerCase().includes('continue')
                );

                if (emailButton) {
                    console.log(`🎯 Tìm thấy button: "${emailButton.text}"`);
                    await currentPage.mouse.click(emailButton.x, emailButton.y);
                    foundEmailButton = true;
                    console.log('✅ Đã click button email thành công!');
                }
            } catch (e) {
                console.log('❌ Lỗi phân tích buttons:', e.message);
            }
        }

        if (!foundEmailButton) {
            throw new Error('Không thể tìm thấy nút email sau khi chuyển giao diện');
        }

        // Chờ trang chuyển sang form nhập email
        console.log('⏳ Chờ form nhập email xuất hiện...');
        await sleep(5000);

        // XÓA TOÀN BỘ LOGIC MỚI SAI - CHỈ GIỮ LOGIC CŨ

        console.log('Đã click "Continue with email" và trường input email đã sẵn sàng.');

        // CRITICAL FIX: Sử dụng getCurrentAccountForLogin() để KHÔNG reload/logout
        const currentAccount = accountManager.getCurrentAccountForLogin();
        const email = currentAccount.username;

        if (!email) {
            throw new Error('Không có email để đăng nhập. Vui lòng cấu hình CANVA_EMAIL trong .env hoặc thêm account vào Google Sheet.');
        }

        console.log(`🎯 Sử dụng email từ current account (KHÔNG reload): ${email} (ID ${currentAccount.id})`);

        // KHÔI PHỤC LOGIC CŨ: Sử dụng enterEmailHumanLike function
        console.log(`⌨️ Nhập email với logic cũ: ${email}`);
        const emailEntered = await enterEmailHumanLike(currentPage, email);

        if (!emailEntered) {
            throw new Error('Không thể nhập email vào form với logic cũ');
        }

        console.log(`✅ Đã nhập email thành công với logic cũ`);
        await sleep(300);

        // Bước 4: Nhấn Enter để tiếp tục sau email
        console.log('Nhấn Enter để tiếp tục sau email...');
        await currentPage.keyboard.press('Enter');

        // Chờ trang chuyển hoặc trường password xuất hiện
        try {
            await currentPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });
            console.log('Đã chuyển sang trang nhập mật khẩu.');
        } catch (navError) {
            console.log('Không có navigation, có thể trường password đã xuất hiện trên cùng trang.');
            await sleep(2000);
        }



        // Bước 5: Chờ và nhập mật khẩu với thời gian chờ dài hơn
        console.log('Chờ input mật khẩu xuất hiện và nhập mật khẩu...');

        // Chờ lâu hơn để Canva load hoàn toàn (có thể có redirect)
        await sleep(5000);

        // Kiểm tra URL hiện tại
        const currentUrl2 = await currentPage.url();
        console.log('🔗 URL hiện tại:', currentUrl2);

        // Nếu bị redirect, chờ thêm
        if (currentUrl2 !== 'https://www.canva.com/login/') {
            console.log('📍 Đã bị redirect, chờ trang mới load...');
            await sleep(3000);
        }

        // Thử nhiều selector khác nhau cho trường password
        let passwordInputSelector = null;
        const possiblePasswordSelectors = [
            'input[type="password"]',
            'input[name="password"]',
            'input[autocomplete="current-password"]',
            'input[placeholder*="password"]',
            'input[placeholder*="Password"]',
            'input[placeholder="Enter password"]',
            'input.bCVoGQ',
            'input[id*=":r"]',
            'input[placeholder*="mật khẩu"]',
            'input[autocomplete="password"]',
            'input[id*="password"]'
        ];

        console.log('Đang tìm trường password...');
        for (const selector of possiblePasswordSelectors) {
            try {
                console.log(`Thử selector: ${selector}`);
                await currentPage.waitForSelector(selector, { visible: true, timeout: 8000 });
                passwordInputSelector = selector;
                console.log(`✓ Tìm thấy trường password với selector: ${selector}`);
                break;
            } catch (e) {
                console.log(`✗ Không tìm thấy với selector: ${selector}`);
            }
        }

        // Nếu vẫn không tìm thấy, thử tìm bằng cách khác
        if (!passwordInputSelector) {
            console.log('Thử tìm trường password bằng cách khác...');
            try {
                const foundByEvaluate = await currentPage.evaluate(() => {
                    const inputs = document.querySelectorAll('input');
                    for (let input of inputs) {
                        if (input.type === 'password' ||
                            input.name.toLowerCase().includes('password') ||
                            input.placeholder.toLowerCase().includes('password') ||
                            input.id.toLowerCase().includes('password')) {
                            input.setAttribute('data-temp-password', 'found');
                            return true;
                        }
                    }
                    return false;
                });

                if (foundByEvaluate) {
                    passwordInputSelector = '[data-temp-password="found"]';
                    console.log('✓ Tìm thấy trường password bằng JavaScript evaluation');
                }
            } catch (evalError) {
                console.log('Lỗi khi tìm password bằng evaluation:', evalError.message);
            }
        }

        if (!passwordInputSelector) {
            // Kiểm tra xem có phải Canva yêu cầu verification không
            const pageContent = await currentPage.content();
            const title = await currentPage.title();

            console.log('📄 Title hiện tại:', title);

            if (title.includes('Verify') || pageContent.includes('verify') || pageContent.includes('verification')) {
                console.log('📧 Canva yêu cầu email verification. Cần kiểm tra email để verify.');

                // Chụp screenshot
                await currentPage.screenshot({ path: 'canva-verification-required.png', fullPage: true });
                console.log('📸 Screenshot: canva-verification-required.png');

                throw new Error('Canva yêu cầu email verification. Vui lòng kiểm tra email và verify trước khi tiếp tục.');

            } else if (title.includes('Dashboard') || title.includes('Home') || currentUrl.includes('canva.com/') && !currentUrl.includes('login')) {
                console.log('🎉 Có thể đã đăng nhập thành công! Kiểm tra...');

                // Thử tìm elements của dashboard
                const isDashboard = await currentPage.evaluate(() => {
                    return document.querySelector('[data-testid="dashboard"]') ||
                           document.querySelector('.dashboard') ||
                           document.body.textContent.includes('Create a design') ||
                           document.body.textContent.includes('Tạo thiết kế');
                });

                if (isDashboard) {
                    console.log('✅ Đã đăng nhập thành công vào Canva!');
                    return; // Thoát khỏi function, đăng nhập thành công
                }
            }

            // Chụp screenshot để debug
            await currentPage.screenshot({ path: 'password-debug.png', fullPage: true });
            console.log('📸 Debug screenshot: password-debug.png');

            throw new Error('Không thể tìm thấy trường input password. Có thể cần verification hoặc có vấn đề khác.');
        }

        // Sử dụng password từ account manager
        const password = currentAccount ? currentAccount.password : process.env.CANVA_PASSWORD;

        if (!password) {
            throw new Error('Không có password để đăng nhập. Vui lòng cấu hình password trong Google Sheet.');
        }

        console.log(`Nhập password cho account: ${email}...`);
        await currentPage.type(passwordInputSelector, password.toString(), { delay: 20 });
        await sleep(300);

        // Bước 6: Nhấn Enter để đăng nhập
        console.log('Nhấn Enter để đăng nhập...');
        await currentPage.keyboard.press('Enter');

        // Chờ đăng nhập thành công
        try {
            await currentPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
            console.log('Đăng nhập thành công!');
        } catch (loginError) {
            console.log('Chờ thêm thời gian để đăng nhập hoàn tất...');
            await sleep(5000);
        }



        // Bước 7: Điều hướng đến trang quản lý thành viên (nếu chưa ở đó)
        console.log('Điều hướng đến trang quản lý thành viên Canva (settings/people)...');
        await currentPage.goto('https://www.canva.com/settings/people', { waitUntil: 'networkidle0', timeout: 60000 });

        // Chờ trang load hoàn toàn
        await sleep(5000);

        // Sử dụng hàm click cụ thể cho nút "Mời thành viên"
        let isInviteButtonReady = await clickInviteButton(currentPage);

        // Nếu không tìm thấy bằng selector cụ thể, thử các text khác
        if (!isInviteButtonReady) {
            const possibleInviteTexts = ['Invite members', 'Add members', 'Invite people'];
            for (const inviteText of possibleInviteTexts) {
                console.log(`Thử tìm nút với text: "${inviteText}"`);
                isInviteButtonReady = await clickElementByText(currentPage, inviteText, '*', 5000);
                if (isInviteButtonReady) {
                    console.log(`✓ Tìm thấy nút mời với text: "${inviteText}"`);
                    break;
                }
            }
        }

        // Đóng popup nếu đã mở
        if (isInviteButtonReady) {
            await currentPage.keyboard.press('Escape');
            await sleep(1000);
        }

        if (!isInviteButtonReady) {
            console.log('Không tìm thấy nút mời thành viên, nhưng vẫn tiếp tục...');
        } else {
            console.log('Đã đến trang quản lý thành viên và tìm thấy nút mời.');
        }

        // Lưu session data sau khi đăng nhập thành công
        console.log('Lưu session data sau khi đăng nhập thành công...');
        await saveSessionData(currentPage);

        // Reset flag khi khởi tạo thành công
        isInitializing = false;
        console.log('✅ Hệ thống đã khởi tạo hoàn tất');

    } catch (error) {
        // Reset flag khi có lỗi
        isInitializing = false;
        console.error('Lỗi nghiêm trọng trong quá trình khởi tạo trình duyệt hoặc đăng nhập:', error);
        if (currentPage) {
            console.error('URL hiện tại khi lỗi:', currentPage.url());
        }
        throw error;
    }
}

// Endpoint API để thêm thành viên
app.get('/apicanva', async (req, res) => {
    const { email } = req.query;

    if (!email) {
        return res.status(400).send('Tham số email bị thiếu. Sử dụng: /apicanva?email=abc@gmail.com');
    }

    if (!currentPage || currentPage.isClosed()) {
        console.warn('Page instance không hợp lệ hoặc đã đóng. Thử khởi tạo lại trình duyệt và đăng nhập...');
        try {
            await setupBrowserAndLogin();
            if (!currentPage || currentPage.isClosed()) {
                 return res.status(500).send('Không thể khôi phục trạng thái trình duyệt. Vui lòng kiểm tra log server.');
            }
        } catch (reloginError) {
            return res.status(500).send(`Không thể đăng nhập lại Canva để thêm thành viên. Lỗi: ${reloginError.message}`);
        }
    }

    try {
        console.log(`Đang cố gắng thêm thành viên: ${email}`);

        // Luôn điều hướng về trang settings/people cho mỗi request mới
        console.log('Điều hướng về trang quản lý thành viên...');
        await currentPage.goto('https://www.canva.com/settings/people', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });
        await sleep(3000); // Chờ trang load hoàn toàn

        // Chờ một chút để trang load
        await sleep(2000);

        // Bước 8: Click "Mời thành viên" bằng selector cụ thể
        console.log('Tìm và click nút mời thành viên...');

        let clickedInviteMember = await clickInviteButton(currentPage);

        // Nếu không thành công, thử các text khác
        if (!clickedInviteMember) {
            const possibleInviteTexts = ['Invite members', 'Add members', 'Invite people'];
            for (const inviteText of possibleInviteTexts) {
                console.log(`Thử click với text: "${inviteText}"`);
                clickedInviteMember = await clickElementByText(currentPage, inviteText, '*', 5000);
                if (clickedInviteMember) break;
            }
        }

        if (!clickedInviteMember) {
            throw new Error('Không thể tìm thấy và click nút mời thành viên.');
        }
        await sleep(2000); // Tạm dừng cho popup ổn định



        // Bước 9: Click "Mời qua email"
        console.log('Click "Mời qua email"...');

        const clickedInviteByEmail = await clickInviteByEmailButton(currentPage);
        if (!clickedInviteByEmail) {
            // Thử fallback với text search
            const fallbackClicked = await clickElementByText(currentPage, 'Mời qua email');
            if (!fallbackClicked) {
                throw new Error('Không thể click tab "Mời qua email".');
            }
        }
        await sleep(1500); // Tạm dừng ngắn cho trường nhập liệu xuất hiện

        // Bước 10: Nhập email
        console.log('Nhập email:', email);

        const emailInputSuccess = await typeEmailInInput(currentPage, email);
        if (!emailInputSuccess) {
            throw new Error('Không thể nhập email vào trường input');
        }

        // Bước 11: Click nút "Gửi lời mời"
        console.log('Click nút "Gửi lời mời"...');

        const sendClicked = await clickSendInviteButton(currentPage);
        if (!sendClicked) {
            // Fallback: thử nhấn Enter
            console.log('Fallback: Nhấn Enter để gửi lời mời...');
            await currentPage.keyboard.press('Enter');
        }

        // Chờ cho popup đóng lại và xử lý kết quả
        await sleep(3000); // Đợi Canva xử lý và hiển thị kết quả

        console.log(`Đã gửi lời mời thành công đến ${email}`);

        res.send(`Đã mời thành công ${email} vào Canva.`);

        // Đóng tất cả popup và chuẩn bị cho request tiếp theo
        await currentPage.keyboard.press('Escape'); // Đóng popup hiện tại
        await sleep(500);
        await currentPage.keyboard.press('Escape'); // Đóng thêm lần nữa để chắc chắn
        await sleep(1000);

        // Quay về trang chính để sẵn sàng cho request tiếp theo
        console.log('Chuẩn bị sẵn sàng cho request tiếp theo...');

    } catch (error) {
        console.error(`Lỗi khi thêm thành viên ${email}:`, error);
        res.status(500).send(`Không thể mời ${email}. Lỗi: ${error.message}`);
    }
});

// Xử lý thoát ứng dụng an toàn
process.on('SIGINT', async () => {
    console.log('\nĐang thoát ứng dụng...');
    await closeBrowser();
    process.exit(0);
});



// API endpoint để thêm thành viên 1 tháng (SYNC - đợi hoàn thành)
app.get('/addmail1m-sync', async (req, res) => {
    try {
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu tham số email. Sử dụng: /addmail1m-sync?email=abc@gmail.com'
            });
        }

        console.log(`🔄 SYNC API: Bắt đầu xử lý ${email} (1 tháng)...`);

        // Pre-check: Không còn account khả dụng => trả lỗi 503
        try { await accountManager.reloadAllAccountsFromSheet(); } catch {}
        const hasAvailable = accountManager.accounts.some(acc => acc.status === 'On' && acc.currentCount < acc.maxLimit);
        if (!hasAvailable) {
            return res.status(503).json({
                success: false,
                message: 'Không còn tài khoản On khả dụng để mời. Vui lòng bổ sung tài khoản hoặc chờ tài khoản reset.'
            });
        }

        // Thêm vào hàng đợi và đợi hoàn thành
        const taskId = queueManager.addTask({
            email: email,
            duration: '1m'
        });

        // Đợi task hoàn thành
        const result = await waitForTaskCompletion(taskId);

        // Trả response với kết quả chi tiết
        res.json({
            success: result.success,
            message: result.message,
            taskId: taskId,
            details: {
                email: email,
                duration: '1 tháng',
                loggedToSheets: result.loggedToSheets || false,
                accountUsed: result.accountUsed || 'unknown',
                completedAt: new Date().toISOString(),
                processingTime: result.processingTime || 'unknown'
            }
        });

    } catch (error) {
        console.error('Lỗi API addmail1m-sync:', error.message);
        res.status(500).json({
            success: false,
            message: `Lỗi: ${error.message}`,
            details: {
                email: req.query.email,
                duration: '1 tháng',
                error: error.message,
                failedAt: new Date().toISOString()
            }
        });
    }
});



// API endpoint để thêm thành viên 1 năm (ASYNC - trả response ngay)
app.get('/addmail1y', async (req, res) => {
    try {
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu tham số email. Sử dụng: /addmail1y?email=abc@gmail.com'
            });
        }

        // Pre-check: Không còn account khả dụng => báo lỗi ngay
        try { await accountManager.reloadAllAccountsFromSheet(); } catch {}
        const hasAvailableY = accountManager.accounts.some(acc => acc.status === 'On' && acc.currentCount < acc.maxLimit);


        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        // Pre-check: còn account khả dụng không
        try { await accountManager.reloadAllAccountsFromSheet(); } catch {}
        const hasAvailable = accountManager.accounts.some(acc => acc.status === 'On' && acc.currentCount < acc.maxLimit);
        if (!hasAvailable) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: 'Không còn tài khoản On khả dụng' })}\n\n`);
            res.end();
            return;
        }


        if (!hasAvailableY) {
            return res.status(503).json({
                success: false,
                message: 'Không còn tài khoản On khả dụng để mời. Vui lòng bổ sung tài khoản hoặc chờ tài khoản reset.'
            });
        }

        // Thêm vào hàng đợi
        const taskId = queueManager.addTask({
            email: email,
            duration: '1y'
        });

        res.json({
            success: true,
            message: `Đã thêm ${email} vào hàng đợi 1 năm`,
            taskId: taskId,
            queueStatus: queueManager.getQueueStatus()
        });

    } catch (error) {
        console.error('Lỗi API addmail1y:', error.message);
        res.status(500).json({
            success: false,
            message: `Lỗi: ${error.message}`
        });
    }
});

// API endpoint để thêm thành viên 1 năm (SYNC - đợi hoàn thành)
app.get('/addmail1y-sync', async (req, res) => {
    try {
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu tham số email. Sử dụng: /addmail1y-sync?email=abc@gmail.com'
            });
        }

        console.log(`🔄 SYNC API: Bắt đầu xử lý ${email} (1 năm)...`);

        // Pre-check: Không còn account khả dụng => trả lỗi 503
        try { await accountManager.reloadAllAccountsFromSheet(); } catch {}
        const hasAvailableY2 = accountManager.accounts.some(acc => acc.status === 'On' && acc.currentCount < acc.maxLimit);
        if (!hasAvailableY2) {
            return res.status(503).json({
                success: false,
                message: 'Không còn tài khoản On khả dụng để mời. Vui lòng bổ sung tài khoản hoặc chờ tài khoản reset.'
            });
        }

        // Thêm vào hàng đợi và đợi hoàn thành
        const taskId = queueManager.addTask({
            email: email,
            duration: '1y'
        });

        // Đợi task hoàn thành
        const result = await waitForTaskCompletion(taskId);

        // Trả response với kết quả chi tiết
        res.json({
            success: result.success,
            message: result.message,
            taskId: taskId,
            details: {
                email: email,
                duration: '1 năm',
                loggedToSheets: result.loggedToSheets || false,
                accountUsed: result.accountUsed || 'unknown',
                completedAt: new Date().toISOString(),
                processingTime: result.processingTime || 'unknown'
            }
        });

    } catch (error) {
        console.error('Lỗi API addmail1y-sync:', error.message);
        res.status(500).json({
            success: false,
            message: `Lỗi: ${error.message}`,
            details: {
                email: req.query.email,
                duration: '1 năm',
                error: error.message,
                failedAt: new Date().toISOString()
            }
        });
    }
});

// API endpoint để xem trạng thái hàng đợi
app.get('/queue-status', (req, res) => {
    res.json({
        success: true,
        data: queueManager.getQueueStatus()
    });
});

// API endpoint để xem thống kê Google Sheets
app.get('/sheets-stats', async (req, res) => {
    try {
        const stats = await sheetsManager.getStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// API endpoint để xem thống kê accounts
app.get('/account-stats', async (req, res) => {
    try {
        const stats = await accountManager.getAccountStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// API endpoint để thêm account mới
app.post('/add-account', async (req, res) => {
    try {
        const { username, password, maxLimit } = req.body;

        if (!username || !password) {

// Bind API routes from env (sync endpoints)
if (API_ENABLE_1M) {
    app.get(API_ROUTE_1M, apiAuth, async (req, res) => {
        try {
            const email = req.query.email;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: `Thiếu tham số email. Sử dụng: ${API_ROUTE_1M}?email=abc@gmail.com`
                });
            }

            console.log(`🔄 SYNC API: Bắt đầu xử lý ${email} (1 tháng)...`);

            // Thêm vào hàng đợi và đợi hoàn thành
            const taskId = queueManager.addTask({ email: email, duration: '1m' });

            const result = await waitForTaskCompletion(taskId);

            res.json({
                success: result.success,
                message: result.message,
                taskId: taskId,
                details: {
                    email: email,
                    duration: '1 tháng',
                    loggedToSheets: result.loggedToSheets || false,
                    accountUsed: result.accountUsed || 'unknown',
                    completedAt: new Date().toISOString(),
                    processingTime: result.processingTime || 'unknown'
                }
            });
        } catch (error) {
            console.error('Lỗi API 1m-sync:', error.message);
            res.status(500).json({ success: false, message: `Lỗi: ${error.message}` });
        }
    });
}

if (API_ENABLE_1Y) {
    app.get(API_ROUTE_1Y, apiAuth, async (req, res) => {
        try {
            const email = req.query.email;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: `Thiếu tham số email. Sử dụng: ${API_ROUTE_1Y}?email=abc@gmail.com`
                });
            }

            console.log(`🔄 SYNC API: Bắt đầu xử lý ${email} (1 năm)...`);

            const taskId = queueManager.addTask({ email: email, duration: '1y' });
            const result = await waitForTaskCompletion(taskId);

            res.json({
                success: result.success,
                message: result.message,
                taskId: taskId,
                details: {
                    email: email,
                    duration: '1 năm',
                    loggedToSheets: result.loggedToSheets || false,
                    accountUsed: result.accountUsed || 'unknown',
                    completedAt: new Date().toISOString(),
                    processingTime: result.processingTime || 'unknown'
                }
            });
        } catch (error) {
            console.error('Lỗi API 1y-sync:', error.message);
            res.status(500).json({ success: false, message: `Lỗi: ${error.message}` });
        }
    });
}

            return res.status(400).json({
                success: false,
                message: 'Thiếu username hoặc password'
            });
        }

        const result = await accountManager.addAccount(username, password, maxLimit || 100);

        if (result) {
            res.json({
                success: true,
                message: `Đã thêm tài khoản ${username} thành công`
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Không thể thêm tài khoản'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// API endpoint để reset tất cả accounts
app.post('/reset-accounts', async (req, res) => {
    try {
        const result = await accountManager.resetAllAccounts();

        if (result) {
            res.json({
                success: true,
                message: 'Đã reset tất cả accounts về 0'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Không thể reset accounts'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// API endpoint để test cookies
app.post('/test-cookies', async (req, res) => {
    try {
        if (!currentPage || !currentBrowser) {
            return res.status(500).json({
                success: false,
                message: 'Trình duyệt chưa được khởi tạo'
            });
        }

        console.log('Test load cookies...');
        const cookiesLoaded = await loadCookiesOnly(currentPage);

        if (cookiesLoaded) {
            // Kiểm tra xem có đăng nhập không
            await currentPage.goto('https://www.canva.com/settings/people', { waitUntil: 'networkidle0', timeout: 30000 });
            await sleep(2000);

            const hasInviteButton = await clickElementByText(currentPage, 'Mời thành viên', '*', 5000);

            if (hasInviteButton) {
                // Đóng popup nếu có
                await currentPage.keyboard.press('Escape');
                await sleep(1000);

                res.json({
                    success: true,
                    message: 'Cookies hoạt động tốt - đã đăng nhập thành công'
                });
            } else {
                res.json({
                    success: false,
                    message: 'Cookies đã load nhưng chưa đăng nhập được'
                });
            }
        } else {
            res.json({
                success: false,
                message: 'Không thể load cookies'
            });
        }

    } catch (error) {
        console.error('Lỗi khi test cookies:', error.message);
        res.status(500).json({
            success: false,
            message: `Lỗi: ${error.message}`
        });
    }
});

process.on('SIGTERM', async () => {
    console.log('\nĐang thoát ứng dụng...');
    await closeBrowser();
    process.exit(0);
});

// TEST API để kiểm tra sync functionality (mock data)
app.get('/test-sync', async (req, res) => {
    try {
        const email = req.query.email || 'test@gmail.com';

        console.log(`🧪 TEST SYNC API: Bắt đầu xử lý ${email}...`);

        // Tạo mock task
        const taskId = queueManager.addTask({
            email: email,
            duration: '1m'
        });

        // Simulate task completion sau 5 giây
        setTimeout(() => {
            const mockResult = {
                success: true,
                message: `Đã mời thành công ${email} và ghi log thành công (MOCK)`,
                loggedToSheets: true,
                accountUsed: 'phamanhha.edu@hotmail.com',
                processingTime: '5s'
            };

            taskResults.set(taskId, mockResult);
            console.log(`✅ Mock task ${taskId} completed for ${email}`);
        }, 5000);

        // Đợi task hoàn thành
        const result = await waitForTaskCompletion(taskId, 10000); // 10s timeout

        // Trả response với kết quả chi tiết
        res.json({
            success: result.success,
            message: result.message,
            taskId: taskId,
            details: {
                email: email,
                duration: '1 tháng (test)',
                loggedToSheets: result.loggedToSheets || false,
                accountUsed: result.accountUsed || 'unknown',
                completedAt: new Date().toISOString(),
                processingTime: result.processingTime || 'unknown'
            }
        });

    } catch (error) {
        console.error('Lỗi TEST SYNC API:', error.message);
        res.status(500).json({
            success: false,
            message: `Lỗi: ${error.message}`,
            details: {
                email: req.query.email,
                duration: '1 tháng (test)',
                error: error.message,
                failedAt: new Date().toISOString()
            }
        });
    }
});

app.listen(port, () => {
    console.log(`Server đang lắng nghe tại http://localhost:${port}`);
    console.log('Bắt đầu khởi tạo trình duyệt và đăng nhập Canva...');
    setupBrowserAndLogin().catch(err => {
        console.error('Ứng dụng không thể khởi động do lỗi đăng nhập trình duyệt ban đầu:', err);
    });
});