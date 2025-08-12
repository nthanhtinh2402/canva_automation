require('dotenv').config();
const AccountManager = require('./account-manager');

async function testCompleteFlow() {
    try {
        console.log('🎯 === TEST TOÀN BỘ: ĐẾM + ĐỔI + LOG ===');
        
        const am = new AccountManager();
        await am.initialize();
        
        console.log('📊 TRẠNG THÁI BAN ĐẦU:');
        am.accounts.slice(0,5).forEach(acc => {
            console.log(`  ID ${acc.id}: ${acc.currentCount}/${acc.maxLimit} - ${acc.status}`);
        });
        
        console.log('\n🎯 Bắt đầu test liên tục...');
        console.log('Mục tiêu: Test cho đến khi hết tất cả ID\n');
        
        let testCount = 1;
        let maxTests = 40; // Đủ để test hết tất cả ID
        
        while(testCount <= maxTests) {
            try {
                console.log(`--- TEST ${testCount} ---`);
                
                // 1. Chọn tài khoản
                const account = await am.ensureActiveAccount();
                console.log(`📊 Chọn: ID ${account.id} (${account.currentCount}/${account.maxLimit}) - ${account.status}`);
                
                // 2. Log email vào dòng mới
                const testEmail = `complete-test-${testCount}@gmail.com`;
                const logResult = await am.logEmailToSequentialColumns(testEmail, '1m');
                console.log(`📝 Log email: ${logResult ? '✅ Thành công' : '❌ Thất bại'} - ${testEmail}`);
                
                // 3. Tăng count
                const countResult = await am.incrementSuccessCount();
                console.log(`📊 Tăng count: ${countResult ? '✅ Thành công' : '❌ Thất bại'}`);
                
                // 4. Hiển thị kết quả
                const final = am.currentAccount;
                console.log(`📊 Kết quả: ID ${final.id} (${final.currentCount}/${final.maxLimit}) - ${final.status}`);
                
                // 5. Kiểm tra logic chuyển tài khoản
                if (final.currentCount >= final.maxLimit) {
                    console.log(`🚫 ID ${final.id} đã đạt limit → Sẽ chuyển sang ID khác ở test tiếp theo`);
                }
                
                console.log(''); // Dòng trống
                testCount++;
                
                // Chờ 800ms giữa các test để dễ theo dõi
                await new Promise(resolve => setTimeout(resolve, 800));
                
            } catch (error) {
                console.log(`❌ TEST ${testCount} THẤT BẠI: ${error.message}`);
                
                if(error.message.includes('Không có tài khoản On nào khả dụng')) {
                    console.log('\n🏁 === ĐÃ HẾT TẤT CẢ TÀI KHOẢN ===');
                    console.log(`📊 Tổng số test thành công: ${testCount - 1}`);
                    
                    // Hiển thị trạng thái cuối tất cả ID
                    console.log('\n📊 TRẠNG THÁI CUỐI TẤT CẢ ID:');
                    am.accounts.forEach(acc => {
                        const status = acc.currentCount >= acc.maxLimit ? '🚫 Đạt limit' : '✅ Còn slot';
                        console.log(`  ID ${acc.id}: ${acc.currentCount}/${acc.maxLimit} - ${acc.status} ${status}`);
                    });
                    
                    // Tính tổng
                    const totalProcessed = am.accounts.reduce((sum, acc) => sum + acc.currentCount, 0);
                    const totalCapacity = am.accounts.reduce((sum, acc) => sum + acc.maxLimit, 0);
                    console.log('\n📈 THỐNG KÊ TỔNG:');
                    console.log(`  - Tổng email đã xử lý: ${totalProcessed}`);
                    console.log(`  - Tổng capacity: ${totalCapacity}`);
                    console.log(`  - Tỷ lệ sử dụng: ${Math.round(totalProcessed/totalCapacity*100)}%`);
                    
                    // Kiểm tra Google Sheet có đúng số dòng email log không
                    const sheet = am.doc.sheetsById[am.accountsSheetGid];
                    const allRows = await sheet.getRows();
                    const emailLogRows = allRows.filter(row => row.get('Account') && row.get('Account').includes('[LOG]'));
                    console.log(`\n📝 KIỂM TRA EMAIL LOG:`)
                    console.log(`  - Số dòng email log trong sheet: ${emailLogRows.length}`);
                    console.log(`  - Số email đã test: ${testCount - 1}`);
                    console.log(`  - Khớp nhau: ${emailLogRows.length === testCount - 1 ? '✅ Đúng' : '❌ Sai'}`);
                    
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
        
        console.log('\n🎯 === TEST HOÀN TẤT ===');
        
    } catch (error) {
        console.error('❌ Lỗi test:', error.message);
    }
}

testCompleteFlow();
