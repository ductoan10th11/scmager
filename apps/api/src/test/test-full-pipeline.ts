import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
const { PDFParse } = require('pdf-parse');
import mammoth from 'mammoth';

// Load .env
const envPath = path.resolve(__dirname, '../../../../.env');
dotenv.config({ path: envPath });

const BASE_URL = process.env.BASE_URL || 'http://100.94.148.68:8000/v1';
const API_KEY = process.env.API_KEY || 'expsolution_e112233';
const MODEL = process.env.MODEL || 'qwen3.8-27b';

// Metadata chuẩn của 19 chỉ tiêu
export const STANDARD_METRICS_META: Record<
  string,
  { name: string; category: 'CHUNG' | 'DANG_UY' | 'UBND' | 'MTTQ'; unit: string; icon: string; isCore: boolean }
> = {
  DAN_SO: { name: 'Dân số', category: 'CHUNG', unit: 'người', icon: 'Users', isCore: true },
  HO_DAN: { name: 'Hộ dân', category: 'CHUNG', unit: 'hộ', icon: 'Home', isCore: true },
  DIEN_TICH: { name: 'Diện tích tự nhiên', category: 'CHUNG', unit: 'km²', icon: 'Map', isCore: true },
  THON_TDP: { name: 'Thôn, tổ dân phố', category: 'CHUNG', unit: 'thôn', icon: 'Building', isCore: true },
  CAN_BO_CC: { name: 'Cán bộ, công chức, VC', category: 'CHUNG', unit: 'người', icon: 'UserCheck', isCore: false },
  DANG_VIEN: { name: 'Tổng số đảng viên', category: 'CHUNG', unit: 'đồng chí', icon: 'Shield', isCore: true },
  TO_CHUC_DANG: { name: 'Tổ chức đảng, chi bộ trực thuộc', category: 'DANG_UY', unit: 'chi bộ', icon: 'Building2', isCore: false },
  DANG_VIEN_KET_NAP: { name: 'Đảng viên kết nạp trong năm', category: 'DANG_UY', unit: 'đảng viên', icon: 'UserPlus', isCore: false },
  CHI_BO_HOAN_THANH_TOT: { name: 'Tỷ lệ chi bộ HT tốt nhiệm vụ', category: 'DANG_UY', unit: '%', icon: 'Award', isCore: false },
  NV_CAP_UY_HOAN_THANH: { name: 'Tỷ lệ nhiệm vụ cấp ủy hoàn thành', category: 'DANG_UY', unit: '%', icon: 'CheckCircle2', isCore: false },
  HO_SO_HANH_CHINH: { name: 'Hồ sơ hành chính tiếp nhận', category: 'UBND', unit: 'hồ sơ', icon: 'FileCheck', isCore: true },
  HO_SO_DUNG_HAN: { name: 'Tỷ lệ giải quyết đúng hạn', category: 'UBND', unit: '%', icon: 'ClockCheck', isCore: true },
  THU_NGAN_SACH: { name: 'Kết quả thu ngân sách địa bàn', category: 'UBND', unit: 'triệu đồng', icon: 'Coins', isCore: true },
  GIAI_NGAN_VON: { name: 'Giải ngân vốn đầu tư công', category: 'UBND', unit: 'triệu đồng', icon: 'TrendingUp', isCore: false },
  HO_NGHEO_CAN_NGHEO: { name: 'Số hộ nghèo và cận nghèo', category: 'UBND', unit: 'hộ', icon: 'HeartHandshake', isCore: true },
  TY_LE_BHYT: { name: 'Tỷ lệ người dân tham gia BHYT', category: 'UBND', unit: '%', icon: 'Activity', isCore: false },
  PHAN_ANH_KIEN_NGHI: { name: 'Phản ánh, kiến nghị xử lý', category: 'UBND', unit: 'việc', icon: 'MessageSquare', isCore: true },
  DOAN_VIEN_HOI_VIEN: { name: 'Tổng số đoàn viên, hội viên', category: 'MTTQ', unit: 'người', icon: 'Users', isCore: false },
  PHONG_TRAO_TRIEN_KHAI: { name: 'Số cuộc vận động, phong trào', category: 'MTTQ', unit: 'cuộc', icon: 'Flag', isCore: false },
};

export async function extractTextFromFile(filePath: string, buffer?: Buffer): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const fileBuf = buffer || fs.readFileSync(filePath);

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: fileBuf });
    const res = await parser.getText();
    await parser.destroy();
    return res.text;
  } else if (ext === '.docx' || ext === '.doc') {
    const res = await mammoth.extractRawText({ buffer: fileBuf });
    return res.value;
  }
  return fileBuf.toString('utf-8');
}

export async function extractMetricsWithLLM(rawText: string, metadata: any = {}) {
  // Lấy Phần I nếu có để tập trung số liệu
  let cleanText = rawText;
  const startIdx = cleanText.indexOf('TÌNH HÌNH KINH TẾ XÃ HỘI 9 THÁNG NĂM 2026');
  const endIdx = cleanText.indexOf('Phần II');
  if (startIdx !== -1 && endIdx !== -1) {
    cleanText = cleanText.substring(startIdx, endIdx);
  }

  // Chia làm 2 phần nếu text quá dài (> 25,000 ký tự) để đảm bảo không bỏ sót số liệu và phản hồi nhanh
  const chunks: string[] = [];
  if (cleanText.length > 25000) {
    chunks.push(cleanText.slice(0, 25000));
    chunks.push(cleanText.slice(25000));
  } else {
    chunks.push(cleanText);
  }

  const systemPrompt = `Bạn là Trợ lý AI Chuyên gia Phân tích Văn bản Báo cáo Hành chính Cấp Xã (Xã Thiện Tân).
Nhiệm vụ: Đọc văn bản báo cáo và trích xuất thông tin báo cáo kèm các chỉ tiêu thuộc "19 chỉ tiêu điều hành IOC Xã Thiện Tân".

QUY TẮC BẮT BUỘC:
1. CHỈ trích xuất các chỉ tiêu có mã (code) thuộc danh sách sau:
   - DAN_SO (Dân số: người/nhân khẩu)
   - HO_DAN (Hộ dân: hộ)
   - DIEN_TICH (Diện tích tự nhiên: km2/ha)
   - THON_TDP (Số thôn/TDP: thôn)
   - CAN_BO_CC (Cán bộ, công chức, VC: người)
   - DANG_VIEN (Đảng viên: đồng chí/đảng viên)
   - TO_CHUC_DANG (Tổ chức đảng, chi bộ: chi bộ)
   - DANG_VIEN_KET_NAP (Đảng viên kết nạp: đảng viên)
   - CHI_BO_HOAN_THANH_TOT (Tỷ lệ chi bộ HT tốt: %)
   - NV_CAP_UY_HOAN_THANH (Tỷ lệ nhiệm vụ cấp ủy: %)
   - HO_SO_HANH_CHINH (Hồ sơ TTHC tiếp nhận: hồ sơ)
   - HO_SO_DUNG_HAN (Tỷ lệ giải quyết đúng hạn: %)
   - THU_NGAN_SACH (Thu ngân sách trên địa bàn: triệu đồng)
   - GIAI_NGAN_VON (Giải ngân vốn đầu tư công: triệu đồng)
   - HO_NGHEO_CAN_NGHEO (Số hộ nghèo và cận nghèo: hộ)
   - TY_LE_BHYT (Tỷ lệ bao phủ BHYT: %)
   - PHAN_ANH_KIEN_NGHI (Phản ánh, kiến nghị, đơn thư: việc hoặc đơn)
   - DOAN_VIEN_HOI_VIEN (Đoàn viên, hội viên: người)
   - PHONG_TRAO_TRIEN_KHAI (Số cuộc vận động, phong trào: cuộc)
2. BẮT BUỘC phải có "sourceEvidence" trích dẫn nguyên văn câu văn chứa số liệu từ văn bản.
3. Trả về DUY NHẤT một mảng JSON các chỉ tiêu tìm thấy:
[
  {
    "code": "THU_NGAN_SACH",
    "actualValue": 7151,
    "targetValue": 3893,
    "completionRate": 184,
    "unit": "triệu đồng",
    "sourceEvidence": "...",
    "note": "..."
  }
]`;

  const extractedMap = new Map<string, any>();

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Đang phân tích Chunk ${i + 1}/${chunks.length} (${chunks[i].length} ký tự)...`);
    const res = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Văn bản báo cáo (Phần ${i + 1}):\n\n${chunks[i]}` },
        ],
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.1,
        max_tokens: 2500,
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
        timeout: 90000,
      }
    );

    const raw = res.data.choices?.[0]?.message?.content || '';
    let clean = raw.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      const parsed = JSON.parse(clean);
      const list = Array.isArray(parsed) ? parsed : parsed.metrics || [];
      for (const item of list) {
        if (item.code && STANDARD_METRICS_META[item.code]) {
          extractedMap.set(item.code, item);
        }
      }
    } catch (e: any) {
      console.warn(`Lỗi parse JSON từ Chunk ${i + 1}:`, e.message);
    }
  }

  // Chuẩn hóa và làm giàu dữ liệu chỉ tiêu từ metadata 19 chỉ tiêu chuẩn
  const finalMetrics = Array.from(extractedMap.values()).map((item, idx) => {
    const meta = STANDARD_METRICS_META[item.code];
    const actual = Number(item.actualValue) || 0;
    const target = item.targetValue !== undefined && item.targetValue !== null ? Number(item.targetValue) : null;
    let rate = item.completionRate !== undefined && item.completionRate !== null ? Number(item.completionRate) : null;
    if (rate === null && target && target > 0) {
      rate = Math.round((actual / target) * 1000) / 10;
    }

    return {
      code: item.code,
      name: meta.name,
      category: meta.category,
      unit: item.unit || meta.unit,
      actualValue: actual,
      targetValue: target,
      completionRate: rate,
      period: metadata.period || '9 tháng năm 2026',
      year: Number(metadata.year) || 2026,
      icon: meta.icon,
      order: idx + 1,
      isCore: meta.isCore,
      isConfirmed: true,
      sourceEvidence: item.sourceEvidence || '',
      note: item.note || '',
    };
  });

  return {
    reportInfo: {
      code: metadata.code || '489/BC-UBND',
      title: metadata.title || 'Báo cáo Tình hình kinh tế - xã hội 9 tháng năm 2026',
      agency: metadata.agency || 'UBND Xã Thiện Tân',
      period: metadata.period || '9 tháng năm 2026',
      year: Number(metadata.year) || 2026,
      summary: `Hệ thống AI đã trích xuất thành công ${finalMetrics.length} chỉ tiêu điều hành chuẩn từ báo cáo.`,
    },
    metrics: finalMetrics,
  };
}

async function runTest() {
  console.log('=== TEST FULL PIPELINE: PDF PARSER + CHUNKED LLM EXTRACTION ===');
  const samplePdfPath = path.resolve(__dirname, '../../../../docs/T9. BC-KTXH 9 thang-2026-UBND Thien Tan (ban tai 26.9) (1).pdf');
  const t0 = Date.now();

  console.log('Bước 1: Trích xuất text từ PDF...');
  const text = await extractTextFromFile(samplePdfPath);
  console.log(`Đã đọc ${text.length} ký tự trong ${(Date.now() - t0) / 1000}s`);

  console.log('\nBước 2: Gửi qua LLM để bóc tách 19 chỉ tiêu IOC...');
  const result = await extractMetricsWithLLM(text, {
    code: '489/BC-UBND',
    title: 'Báo cáo Tình hình kinh tế - xã hội 9 tháng năm 2026 Xã Thiện Tân',
    agency: 'UBND Xã Thiện Tân',
    period: '9 tháng năm 2026',
    year: 2026,
  });

  console.log('\n=== KẾT QUẢ CUỐI CÙNG ===');
  console.log(`Số chỉ tiêu bóc tách được: ${result.metrics.length}`);
  result.metrics.forEach((m, i) => {
    console.log(`\n[${i + 1}] [${m.category}] ${m.code} - ${m.name}`);
    console.log(`    Thực tế: ${m.actualValue} ${m.unit} | Kế hoạch: ${m.targetValue ?? 'N/A'} | Tỷ lệ: ${m.completionRate ?? 'N/A'}%`);
    console.log(`    Bằng chứng: "${m.sourceEvidence}"`);
  });

  console.log(`\nTổng thời gian hoàn tất: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

runTest().catch(console.error);
