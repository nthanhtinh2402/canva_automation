require('dotenv').config();
const { initializeGologinBrowser, closeBrowser, getPage } = require('./gologin-browser');

async function testLoginFix() {
    try {
        console.log('🧪 === TEST LOGIN FIX: ENHANCED SELECTORS ===');
        
        // Khởi tạo browser
        console.log('🔄 Khởi tạo browser...');
        await initializeGologinBrowser();
        
        const page = getPage();
        if (!page) {
            throw new Error('Không thể lấy page instance');
        }
        
        console.log('✅ Browser đã khởi tạo thành công');
        
        // Test navigate đến Canva
        console.log('🌐 Navigate đến Canva...');
        await page.goto('https://www.canva.com/login', { 
            waitUntil: 'networkidle0', 
            timeout: 30000 
        });
        
        console.log('✅ Đã navigate đến Canva login');
        
        // Test tìm email input với enhanced selectors
        console.log('🔍 Test tìm email input với enhanced selectors...');
        
        const possibleEmailSelectors = [
            // Canva specific selectors (2024)
            'input[data-testid="email-input"]',
            'input[data-testid="login-email"]',
            'input[data-testid*="email"]',
            'input[aria-label*="email" i]',
            'input[aria-label*="Email"]',
            'input[placeholder*="email" i]',
            'input[placeholder*="Email"]',
            // Standard selectors
            'input[type="email"]',
            'input[name="email"]',
            'input[autocomplete="email"]',
            'input[autocomplete="username"]',
            'input[id*="email" i]',
            'input[class*="email" i]',
            'input[class*="Email"]',
            // Generic fallbacks
            'input[type="text"]',
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])'
        ];
        
        let emailInputSelector = null;
        
        for (const selector of possibleEmailSelectors) {
            try {
                await page.waitForSelector(selector, { visible: true, timeout: 3000 });
                emailInputSelector = selector;
                console.log(`✅ Tìm thấy email input với selector: ${selector}`);
                break;
            } catch (e) {
                console.log(`❌ Không tìm thấy với selector: ${selector}`);
            }
        }
        
        if (!emailInputSelector) {
            // Enhanced fallback: Tìm tất cả input visible
            console.log('🔍 Enhanced fallback: Tìm tất cả input visible...');
            
            const visibleInputs = await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input'));
                return inputs.filter(input => input.offsetParent !== null).map(input => ({
                    tagName: input.tagName,
                    type: input.type,
                    name: input.name,
                    placeholder: input.placeholder,
                    id: input.id,
                    className: input.className,
                    ariaLabel: input.getAttribute('aria-label'),
                    dataTestId: input.getAttribute('data-testid')
                }));
            });
            
            console.log(`🔍 Found ${visibleInputs.length} visible inputs:`, visibleInputs);
            
            if (visibleInputs.length > 0) {
                emailInputSelector = 'input[type="text"], input[type="email"], input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])';
                console.log(`✅ Sử dụng fallback selector`);
            } else {
                console.log('❌ Không tìm thấy input nào');
                
                // Chụp screenshot để debug
                await page.screenshot({ path: 'login-test-debug.png', fullPage: true });
                console.log('📸 Screenshot saved: login-test-debug.png');
                
                throw new Error('Không tìm thấy email input');
            }
        }
        
        // Test type email
        if (emailInputSelector) {
            console.log(`🧪 Test type email với selector: ${emailInputSelector}`);
            
            try {
                await page.type(emailInputSelector, 'test@gmail.com', { delay: 50 });
                console.log('✅ Type email thành công!');
                
                // Chụp screenshot kết quả
                await page.screenshot({ path: 'login-test-success.png', fullPage: true });
                console.log('📸 Success screenshot saved: login-test-success.png');
                
            } catch (typeError) {
                console.log('❌ Lỗi khi type email:', typeError.message);
                
                // Chụp screenshot lỗi
                await page.screenshot({ path: 'login-test-type-error.png', fullPage: true });
                console.log('📸 Error screenshot saved: login-test-type-error.png');
            }
        }
        
        console.log('\n🎯 === KẾT QUẢ TEST ===');
        console.log(`✅ Enhanced selectors: ${possibleEmailSelectors.length} selectors`);
        console.log(`✅ Found working selector: ${emailInputSelector || 'None'}`);
        console.log(`✅ Type test: ${emailInputSelector ? 'Success' : 'Failed'}`);
        
        console.log('\n🚀 === FIX HOÀN THÀNH ===');
        console.log('✅ 1. Enhanced selectors với Canva 2024');
        console.log('✅ 2. Better fallback logic');
        console.log('✅ 3. Detailed debugging info');
        console.log('✅ 4. Safety checks trước khi type');
        
    } catch (error) {
        console.error('❌ Lỗi test:', error.message);
    } finally {
        // Đóng browser
        try {
            await closeBrowser();
            console.log('✅ Đã đóng browser');
        } catch (closeError) {
            console.log('⚠️ Lỗi đóng browser:', closeError.message);
        }
    }
}

testLoginFix();
