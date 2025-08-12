require('dotenv').config();
const AccountManager = require('./account-manager');

async function testExhaustAllIds() {
    try {
        console.log('🧪 === TEST KHI HẾT TẤT CẢ ID ===');
        const am = new AccountManager();
        await am.initialize();
        
        console.log('📊 Trạng thái hiện tại:');
        am.accounts.slice(0,5).forEach(acc => {
            console.log(`  ID ${acc.id} - Count: ${acc.currentCount}/${acc.maxLimit} - Status: ${acc.status}`);
        });
        
        console.log('\n🎯 Bắt đầu test liên tục cho đến khi hết ID...');
        
        let testCount = 1;
        let maxTests = 50; // Giới hạn để tránh vô hạn
        
        while(testCount <= maxTests) {
            try {
                console.log(`\n--- TEST ${testCount} ---`);
                
                // Kiểm tra có tài khoản khả dụng không
                const account = await am.ensureActiveAccount();
                console.log(`📊 Chọn: ID ${account.id} (${account.currentCount}/${account.maxLimit}) - ${account.status}`);
                
                // Log email và tăng count
                await am.logEmailToSequentialColumns(`test-exhaust-${testCount}@gmail.com`, '1m');
                await am.incrementSuccessCount();
                
                const final = am.currentAccount;
                console.log(`📊 Kết quả: ID ${final.id} (${final.currentCount}/${final.maxLimit}) - ${final.status}`);
                
                if(final.currentCount >= final.maxLimit) {
                    console.log(`🚫 ID ${final.id} đã đạt limit`);
                }
                
                testCount++;
                
                // Chờ 500ms giữa các test
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.log(`\n❌ TEST ${testCount} THẤT BẠI: ${error.message}`);
                
                if(error.message.includes('Không có tài khoản On nào khả dụng')) {
                    console.log('\n🏁 === ĐÃ HẾT TẤT CẢ TÀI KHOẢN KHẢ DỤNG ===');
                    console.log(`📊 Tổng số test đã thực hiện: ${testCount - 1}`);
                    
                    // Hiển thị trạng thái cuối của tất cả ID
                    console.log('\n📊 TRẠNG THÁI CUỐI TẤT CẢ ID:');
                    am.accounts.forEach(acc => {
                        const status = acc.currentCount >= acc.maxLimit ? '🚫 Đạt limit' : '✅ Còn slot';
                        console.log(`  ID ${acc.id}: ${acc.currentCount}/${acc.maxLimit} - ${acc.status} ${status}`);
                    });
                    
                    // Tính tổng email đã xử lý
                    const totalProcessed = am.accounts.reduce((sum, acc) => sum + acc.currentCount, 0);
                    const totalCapacity = am.accounts.reduce((sum, acc) => sum + acc.maxLimit, 0);
                    console.log('\n📈 THỐNG KÊ TỔNG:');
                    console.log(`  - Tổng email đã xử lý: ${totalProcessed}`);
                    console.log(`  - Tổng capacity: ${totalCapacity}`);
                    console.log(`  - Tỷ lệ sử dụng: ${Math.round(totalProcessed/totalCapacity*100)}%`);
                    
                    // Kiểm tra logic xử lý khi hết tài khoản
                    console.log('\n🧪 Test logic xử lý khi hết tài khoản:');
                    try {
                        await am.ensureActiveAccount();
                        console.log('❌ KHÔNG ĐÚNG: Vẫn tìm được tài khoản khả dụng');
                    } catch (finalError) {
                        console.log('✅ ĐÚNG: Throw error khi hết tài khoản:', finalError.message);
                    }
                    
                    break;
                } else {
                    console.log(`❌ Lỗi khác: ${error.message}`);
                    break;
                }
            }
        }
        
        if(testCount > maxTests) {
            console.log(`\n⚠️ Đã đạt giới hạn ${maxTests} test, dừng để tránh vô hạn`);
        }
        
    } catch (error) {
        console.error('❌ Lỗi test:', error.message);
    }
}

// Chạy test
testExhaustAllIds();
