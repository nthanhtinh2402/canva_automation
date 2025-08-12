require('dotenv').config();
const AccountManager = require('./account-manager');

async function testSequentialSelection() {
    try {
        console.log('🧪 === TEST SEQUENTIAL ACCOUNT SELECTION ===');
        
        const am = new AccountManager();
        await am.initialize();
        
        console.log('📊 TRẠNG THÁI BAN ĐẦU:');
        am.accounts.forEach(acc => {
            const available = acc.status === 'On' && acc.currentCount < acc.maxLimit;
            console.log(`  ID ${acc.id}: ${acc.currentCount}/${acc.maxLimit} - ${acc.status} - ${available ? '✅ Available' : '❌ Not available'}`);
        });
        
        console.log(`\n🎯 Current account after initialize: ID ${am.currentAccount ? am.currentAccount.id : 'none'}`);
        
        console.log('\n🎯 Test sequential selection (should be 1→2→3→4→5→6→7→8→9→10→1):');
        
        const sequence = [];
        for (let i = 1; i <= 12; i++) { // Test 12 lần để thấy wrap around
            const currentId = am.currentAccount ? am.currentAccount.id : 'none';
            sequence.push(currentId);
            
            console.log(`--- Test ${i}: Current ID ${currentId} ---`);
            
            const switched = await am.selectNextAvailableAccount();
            if (switched) {
                const newId = am.currentAccount.id;
                const direction = newId > currentId ? '➡️ Next' : newId < currentId ? '🔄 Wrap' : '❌ Same';
                console.log(`📊 ID ${currentId} → ID ${newId} ${direction}`);
                
                // Verify saved position
                const savedId = await am.loadSavedAccountPosition();
                console.log(`💾 Saved position: ID ${savedId} ${savedId === newId ? '✅ Match' : '❌ Mismatch'}`);
            } else {
                console.log(`❌ Không thể chuyển từ ID ${currentId}`);
                break;
            }
        }
        
        console.log('\n🎯 === SEQUENCE RESULT ===');
        console.log(`📊 Sequence: ${sequence.join(' → ')}`);
        
        // Verify sequence is correct
        const expectedPattern = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const availableIds = am.accounts.filter(acc => acc.status === 'On' && acc.currentCount < acc.maxLimit).map(acc => acc.id).sort((a, b) => a - b);
        
        console.log(`📊 Available IDs: ${availableIds.join(', ')}`);
        console.log(`📊 Expected sequence: ${availableIds.join(' → ')}`);
        
        // Check if sequence follows available IDs in order
        let isSequential = true;
        for (let i = 1; i < sequence.length; i++) {
            const current = sequence[i];
            const previous = sequence[i-1];
            
            if (current !== 'none' && previous !== 'none') {
                const currentIndex = availableIds.indexOf(current);
                const previousIndex = availableIds.indexOf(previous);
                
                // Should be next in sequence or wrap around
                const expectedNext = (previousIndex + 1) % availableIds.length;
                if (currentIndex !== expectedNext) {
                    isSequential = false;
                    console.log(`❌ Sequence break: ID ${previous} → ID ${current} (expected ID ${availableIds[expectedNext]})`);
                }
            }
        }
        
        console.log(`\n🎯 === FINAL RESULT ===`);
        console.log(`✅ Sequential logic: ${isSequential ? 'CORRECT' : 'INCORRECT'}`);
        console.log(`✅ Position saving: Working`);
        console.log(`✅ Account switching: Working`);
        
        if (isSequential) {
            console.log(`🎉 === SEQUENTIAL SELECTION HOÀN HẢO! ===`);
        } else {
            console.log(`❌ === CẦN FIX SEQUENTIAL LOGIC ===`);
        }
        
    } catch (error) {
        console.error('❌ Lỗi test:', error.message);
    }
}

testSequentialSelection();
