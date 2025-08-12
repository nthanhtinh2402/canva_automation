require('dotenv').config();
const AccountManager = require('./account-manager');

async function testStepByStep() {
    try {
        console.log('🎯 === TEST MANUAL TỪNG BƯỚC ===');
        console.log('Mục tiêu: Test logic chọn tài khoản và đếm count chính xác\n');
        
        // Khởi tạo
        const accountManager = new AccountManager();
        await accountManager.initialize();
        
        console.log('📊 TRẠNG THÁI BAN ĐẦU:');
        accountManager.accounts.forEach(acc => {
            console.log(`  ID: ${acc.id} | ${acc.username} - ${acc.currentCount}/${acc.maxLimit} - ${acc.status}`);
        });
        
        // Test từng bước
        const testSteps = [
            { step: 1, email: 'test-step-1@gmail.com', expectedId: '1' },
            { step: 2, email: 'test-step-2@gmail.com', expectedId: '1' },
            { step: 3, email: 'test-step-3@gmail.com', expectedId: '1' }, // ID 1 đạt limit (3/3)
            { step: 4, email: 'test-step-4@gmail.com', expectedId: '2' }, // Chuyển sang ID 2
            { step: 5, email: 'test-step-5@gmail.com', expectedId: '2' }, // ID 2 đạt limit (2/2)
            { step: 6, email: 'test-step-6@gmail.com', expectedId: '3' }, // Chuyển sang ID 3
            { step: 7, email: 'test-step-7@gmail.com', expectedId: '3' },
            { step: 8, email: 'test-step-8@gmail.com', expectedId: '3' },
            { step: 9, email: 'test-step-9@gmail.com', expectedId: '3' }, // ID 3 đạt limit (4/4)
            { step: 10, email: 'test-step-10@gmail.com', expectedId: '4' }, // Chuyển sang ID 4
        ];
        
        console.log('\n🧪 BẮT ĐẦU TEST TỪNG BƯỚC:\n');
        
        for (const test of testSteps) {
            console.log(`--- STEP ${test.step}: ${test.email} ---`);
            
            try {
                // 1. Đảm bảo có tài khoản khả dụng
                const account = await accountManager.ensureActiveAccount();
                console.log(`📊 Tài khoản được chọn: ID ${account.id} | ${account.username} (${account.currentCount}/${account.maxLimit}) - ${account.status}`);
                
                // Kiểm tra ID có đúng như mong đợi
                if (account.id === test.expectedId) {
                    console.log(`✅ ĐÚNG: Chọn ID ${account.id} như mong đợi`);
                } else {
                    console.log(`❌ SAI: Mong đợi ID ${test.expectedId}, nhưng chọn ID ${account.id}`);
                }
                
                // 2. Log email
                const logResult = await accountManager.logEmailToSequentialColumns(test.email, '1m');
                console.log(`📝 Log email: ${logResult ? 'Thành công' : 'Thất bại'}`);
                
                // 3. Tăng count
                const countResult = await accountManager.incrementSuccessCount();
                console.log(`📊 Tăng count: ${countResult ? 'Thành công' : 'Thất bại'}`);
                
                // 4. Hiển thị kết quả
                const finalAccount = accountManager.currentAccount;
                console.log(`📊 Kết quả: ID ${finalAccount.id} | ${finalAccount.username} (${finalAccount.currentCount}/${finalAccount.maxLimit}) - ${finalAccount.status}`);
                
                // 5. Kiểm tra logic chuyển tài khoản
                if (finalAccount.currentCount >= finalAccount.maxLimit) {
                    console.log(`🚫 ID ${finalAccount.id} đã đạt limit → Sẽ chuyển sang ID khác ở step tiếp theo`);
                }
                
                console.log('');
                
                // Chờ 1 giây giữa các step
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`❌ STEP ${test.step} thất bại: ${error.message}\n`);
                break;
            }
        }
        
        console.log('🎯 === KẾT THÚC TEST ===');
        
        // Hiển thị trạng thái cuối
        console.log('\n📊 TRẠNG THÁI CUỐI:');
        accountManager.accounts.forEach(acc => {
            console.log(`  ID: ${acc.id} | ${acc.username} - ${acc.currentCount}/${acc.maxLimit} - ${acc.status}`);
        });
        
    } catch (error) {
        console.error('❌ Lỗi test:', error.message);
    }
}

// Chạy test
testStepByStep();
