import { ref } from 'vue';
import rawUnified from './raw_unified.json';

// Lấy dữ liệu 100% từ JSON cứng tĩnh của Mongo
// Mọi tab đều dùng chung bộ rawUnified này để đảm bảo data khớp 100%
export const globalMockDocuments = ref(rawUnified);
