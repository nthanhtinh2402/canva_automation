require('dotenv').config();
const express = require('express');
const AccountManager = require('./account-manager');

const app = express();
const accountManager = new AccountManager();

// Khởi tạo Account Manager
async function initializeSystem() {
    try {
        console.log('🚀 Khởi tạo hệ thống test toàn bộ IDs...');
        await accountManager.initialize();
        console.log('✅ Account Manager đã sẵn sàng');
        return true;
    } catch (error) {
        console.error('❌ Lỗi khởi tạo:', error.message);
        return false;
    }
}

// API test từng ID
app.get('/test-id', async (req, res) => {
    try {
        const { email, duration } = req.query;
        
        if (!email || !duration) {
            return res.json({ 
                success: false, 
                message: 'Thiếu email hoặc duration' 
            });
        }

        console.log(`\n🧪 === TEST: ${email} (${duration}) ===`);
        
        // 1. Đảm bảo có tài khoản khả dụng
        const account = await accountManager.ensureActiveAccount();
        console.log(`📊 Tài khoản được chọn: ID ${account.id} | ${account.username} (${account.currentCount}/${account.maxLimit}) - Status: ${account.status}`);
        
        // 2. Log email vào Google Sheet
        console.log('📝 Đang log email...');
        const logResult = await accountManager.logEmailToSequentialColumns(email, duration);
        console.log(`📝 Kết quả log: ${logResult ? 'Thành công' : 'Thất bại'}`);
        
        // 3. Tăng count
        console.log('📊 Đang tăng count...');
        const countResult = await accountManager.incrementSuccessCount();
        console.log(`📊 Kết quả tăng count:`, countResult);
        
        // 4. Hiển thị kết quả cuối
        const finalAccount = accountManager.currentAccount;
        console.log(`📊 Kết quả cuối: ID ${finalAccount.id} | ${finalAccount.username} (${finalAccount.currentCount}/${finalAccount.maxLimit}) - Status: ${finalAccount.status}`);
        
        res.json({
            success: true,
            message: `Đã xử lý thành công ${email}`,
            account: {
                id: finalAccount.id,
                username: finalAccount.username,
                currentCount: finalAccount.currentCount,
                maxLimit: finalAccount.maxLimit,
                status: finalAccount.status
            },
            logResult,
            countResult
        });
        
    } catch (error) {
        console.error('❌ Lỗi API:', error.message);
        res.json({
            success: false,
            message: error.message
        });
    }
});

// API test tự động toàn bộ ID
app.get('/test-all-auto', async (req, res) => {
    try {
        console.log('\n🎯 === BẮT ĐẦU TEST TOÀN BỘ ID TỰ ĐỘNG ===');
        
        const results = [];
        let testCount = 1;
        
        // Test liên tục cho đến khi hết tài khoản
        while (testCount <= 50) { // Giới hạn 50 test để tránh vô hạn
            try {
                console.log(`\n🧪 === TEST ${testCount} ===`);
                
                // Đảm bảo có tài khoản khả dụng
                const account = await accountManager.ensureActiveAccount();
                console.log(`📊 Tài khoản được chọn: ID ${account.id} | ${account.username} (${account.currentCount}/${account.maxLimit}) - Status: ${account.status}`);
                
                // Log email
                const testEmail = `auto-test-${testCount}@gmail.com`;
                const logResult = await accountManager.logEmailToSequentialColumns(testEmail, '1m');
                console.log(`📝 Log email: ${logResult ? 'Thành công' : 'Thất bại'}`);
                
                // Tăng count
                const countResult = await accountManager.incrementSuccessCount();
                console.log(`📊 Tăng count: ${countResult ? 'Thành công' : 'Thất bại'}`);
                
                // Lưu kết quả
                const finalAccount = accountManager.currentAccount;
                results.push({
                    test: testCount,
                    email: testEmail,
                    accountId: finalAccount.id,
                    username: finalAccount.username,
                    count: `${finalAccount.currentCount}/${finalAccount.maxLimit}`,
                    status: finalAccount.status,
                    logResult,
                    countResult: countResult ? 'Success' : 'Failed'
                });
                
                console.log(`✅ Test ${testCount} hoàn thành: ID ${finalAccount.id} - ${finalAccount.currentCount}/${finalAccount.maxLimit} - ${finalAccount.status}`);
                
                testCount++;
                
                // Chờ 1 giây giữa các test
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`❌ Test ${testCount} thất bại: ${error.message}`);
                
                // Nếu không còn tài khoản khả dụng, dừng test
                if (error.message.includes('Không có tài khoản On nào khả dụng')) {
                    console.log('🏁 Đã test hết tất cả tài khoản khả dụng!');
                    break;
                }
                
                results.push({
                    test: testCount,
                    error: error.message
                });
                
                testCount++;
            }
        }
        
        console.log('\n🎯 === KẾT QUẢ TEST TOÀN BỘ ===');
        console.table(results);
        
        res.json({
            success: true,
            message: `Đã test ${results.length} lần`,
            results
        });
        
    } catch (error) {
        console.error('❌ Lỗi test tự động:', error.message);
        res.json({
            success: false,
            message: error.message
        });
    }
});

// Khởi động server
async function startServer() {
    const initialized = await initializeSystem();
    if (!initialized) {
        console.error('❌ Không thể khởi tạo hệ thống');
        process.exit(1);
    }
    
    const PORT = 3003;
    app.listen(PORT, () => {
        console.log(`🌐 Test All IDs server đang chạy tại http://localhost:${PORT}`);
        console.log(`🧪 Test từng ID: http://localhost:${PORT}/test-id?email=test@gmail.com&duration=1m`);
        console.log(`🎯 Test tự động toàn bộ: http://localhost:${PORT}/test-all-auto`);
    });
}

startServer();
