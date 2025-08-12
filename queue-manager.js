const EventEmitter = require('events');

class QueueManager extends EventEmitter {
    constructor() {
        super();
        this.queue = [];
        this.isProcessing = false;
        this.currentTask = null;
        this.stats = {
            total: 0,
            completed: 0,
            failed: 0,
            pending: 0
        };
    }

    // Thêm task vào hàng đợi
    addTask(taskData) {
        const taskMaxRetries = Number(process.env.QUEUE_MAX_RETRIES ?? 0); // 0 = không retry ở tầng queue
        const task = {
            id: Date.now() + Math.random(),
            email: taskData.email,
            duration: taskData.duration, // '1m' hoặc '1y'
            timestamp: Date.now(),
            status: 'pending',
            retries: 0,
            maxRetries: isNaN(taskMaxRetries) ? 0 : taskMaxRetries
        };

        this.queue.push(task);
        this.stats.total++;
        this.stats.pending++;

        console.log(`📝 Đã thêm task vào hàng đợi: ${task.email} (${task.duration})`);
        console.log(`📊 Hàng đợi hiện tại: ${this.queue.length} tasks`);

        // Bắt đầu xử lý nếu chưa đang xử lý
        if (!this.isProcessing) {
            this.processQueue();
        }

        return task.id;
    }

    // Xử lý hàng đợi tuần tự
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;
        console.log('🚀 Bắt đầu xử lý hàng đợi...');

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            this.currentTask = task;
            this.stats.pending--;

            console.log(`\n⏳ Đang xử lý: ${task.email} (${task.duration})`);
            console.log(`📊 Còn lại: ${this.queue.length} tasks`);

            try {
                // Emit event để app.js xử lý
                const result = await this.executeTask(task);
                
                if (result.success) {
                    task.status = 'completed';
                    this.stats.completed++;
                    console.log(`✅ Hoàn thành: ${task.email}`);
                    this.emit('taskCompleted', task, result);
                } else {
                    throw new Error(result.message || 'Task failed');
                }

            } catch (error) {
                console.log(`❌ Lỗi xử lý ${task.email}: ${error.message}`);

                // Nếu lỗi là do hết tài khoản khả dụng thì không retry
                const noAccountMsg = 'Không có tài khoản On nào khả dụng';
                const isNoAccount = (error.message && error.message.includes(noAccountMsg));

                if (isNoAccount) {
                    task.status = 'failed';
                    this.stats.failed++;
                    console.log(`💀 Dừng retry vì hết tài khoản khả dụng: ${task.email}`);
                    this.emit('taskFailed', task, error);
                } else {
                    task.retries++;
                    if (task.maxRetries > 0 && task.retries < task.maxRetries) {
                        console.log(`🔄 Thử lại lần ${task.retries}/${task.maxRetries} cho ${task.email}`);
                        this.queue.unshift(task); // Đưa về đầu hàng đợi
                        this.stats.pending++;
                    } else {
                        task.status = 'failed';
                        this.stats.failed++;
                        console.log(`💀 Đã thất bại hoàn toàn: ${task.email} (queue không retry thêm)`);
                        this.emit('taskFailed', task, error);
                    }
                }
            }

            // Nghỉ giữa các task để tránh spam
            await this.sleep(2000);
        }

        this.isProcessing = false;
        this.currentTask = null;
        console.log('\n🎉 Đã xử lý xong tất cả tasks trong hàng đợi!');
        this.emit('queueCompleted', this.stats);
    }

    // Thực thi task (sẽ được override bởi app.js)
    async executeTask(task) {
        return new Promise((resolve) => {
            this.emit('executeTask', task, resolve);
        });
    }

    // Lấy trạng thái hàng đợi
    getQueueStatus() {
        return {
            isProcessing: this.isProcessing,
            currentTask: this.currentTask,
            queueLength: this.queue.length,
            stats: { ...this.stats },
            upcomingTasks: this.queue.slice(0, 5).map(task => ({
                email: task.email,
                duration: task.duration,
                retries: task.retries
            }))
        };
    }

    // Xóa task khỏi hàng đợi
    removeTask(taskId) {
        const index = this.queue.findIndex(task => task.id === taskId);
        if (index !== -1) {
            const removedTask = this.queue.splice(index, 1)[0];
            this.stats.pending--;
            console.log(`🗑️ Đã xóa task: ${removedTask.email}`);
            return true;
        }
        return false;
    }

    // Xóa tất cả tasks
    clearQueue() {
        const clearedCount = this.queue.length;
        this.queue = [];
        this.stats.pending = 0;
        console.log(`🧹 Đã xóa ${clearedCount} tasks khỏi hàng đợi`);
        return clearedCount;
    }

    // Tạm dừng xử lý
    pause() {
        if (this.isProcessing) {
            this.isProcessing = false;
            console.log('⏸️ Đã tạm dừng xử lý hàng đợi');
            return true;
        }
        return false;
    }

    // Tiếp tục xử lý
    resume() {
        if (!this.isProcessing && this.queue.length > 0) {
            console.log('▶️ Tiếp tục xử lý hàng đợi');
            this.processQueue();
            return true;
        }
        return false;
    }

    // Reset stats
    resetStats() {
        this.stats = {
            total: 0,
            completed: 0,
            failed: 0,
            pending: this.queue.length
        };
        console.log('📊 Đã reset thống kê');
    }

    // Helper function
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Lấy lịch sử tasks (completed + failed)
    getTaskHistory() {
        // Trong thực tế có thể lưu vào database
        return {
            completed: this.stats.completed,
            failed: this.stats.failed,
            total: this.stats.total
        };
    }
}

module.exports = QueueManager;
