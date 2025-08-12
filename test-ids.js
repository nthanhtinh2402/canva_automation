require('dotenv').config();
const express = require('express');
const AccountManager = require('./account-manager');

const app = express();
const accountManager = new AccountManager();

// Khởi tạo Account Manager
async function initializeSystem() {
    try {
        console.log('🚀 Khởi tạo hệ thống test IDs...');
        await accountManager.initialize();
        console.log('✅ Account Manager đã sẵn sàng');
        return true;
    } catch (error) {
        console.error('❌ Lỗi khởi tạo:', error.message);
        return false;
    }
}

// API test IDs
app.get('/test-ids', async (req, res) => {
    try {
        const { email, duration } = req.query;
        
        if (!email || !duration) {
            return res.json({ 
                success: false, 
                message: 'Thiếu email hoặc duration' 
            });
        }

        console.log(`\n🧪 Test ID: ${email} (${duration})`);
        
        // 1. Đảm bảo có tài khoản khả dụng
        const account = await accountManager.ensureActiveAccount();
        console.log(`📊 Tài khoản hiện tại: ID ${account.id} | ${account.username} (${account.currentCount}/${account.maxLimit}) - Status: ${account.status}`);
        
        // 2. Log email vào Google Sheet
        console.log('📝 Đang log email...');
        const logResult = await accountManager.logEmailToSequentialColumns(email, duration);
        console.log(`📝 Kết quả log: ${logResult ? 'Thành công' : 'Thất bại'}`);
        
        // 3. Tăng count
        console.log('📊 Đang tăng count...');
        const countResult = await accountManager.incrementSuccessCount();
        console.log(`📊 Kết quả tăng count:`, countResult);
        
        // 4. Hiển thị kết quả
        const finalAccount = accountManager.currentAccount;
        console.log(`📊 Tài khoản sau khi xử lý: ID ${finalAccount.id} | ${finalAccount.username} (${finalAccount.currentCount}/${finalAccount.maxLimit}) - Status: ${finalAccount.status}`);
        
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

// Khởi động server
async function startServer() {
    const initialized = await initializeSystem();
    if (!initialized) {
        console.error('❌ Không thể khởi tạo hệ thống');
        process.exit(1);
    }
    
    const PORT = 3002;
    app.listen(PORT, () => {
        console.log(`🌐 Test IDs server đang chạy tại http://localhost:${PORT}`);
        console.log(`🧪 Test API: http://localhost:${PORT}/test-ids?email=test-id2@gmail.com&duration=1m`);
    });
}

startServer();
