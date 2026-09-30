import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
const { PDFParse } = require('pdf-parse');

// Load .env
const envPath = path.resolve(__dirname, '../../../../.env');
dotenv.config({ path: envPath });

const BASE_URL = process.env.BASE_URL || 'http://100.94.148.68:8000/v1';
const API_KEY = process.env.API_KEY || 'expsolution_e112233';
const MODEL = process.env.MODEL || 'qwen3.8-27b';

// Danh mục 19 chỉ tiêu điều hành chuẩn IOC Xã Thiện Tân
const STANDARD_METRICS_LIST = `
DANH MỤC 19 CHỈ TIÊU ĐIỀU HÀNH CHUẨN IOC XÃ THIỆN TÂN (Chỉ được phép trích xuất các mã trong danh mục này):
1. Khối Số liệu chung (CHUNG):
- DAN_SO: Dân số (đơn vị: người hoặc nhân khẩu)
- HO_DAN: Hộ dân (đơn vị: hộ)
- DIEN_TICH: Diện tích tự nhiên (đơn vị: ha hoặc km²)
- THON_TDP: Số thôn, tổ dân phố (đơn vị: thôn)
- CAN_BO_CC: Cán bộ, công chức, viên chức (đơn vị: người)
- DANG_VIEN: Tổng số đảng viên (đơn vị: đồng chí hoặc đảng viên)

2. Khối Đảng ủy (DANG_UY):
- TO_CHUC_DANG: Số tổ chức đảng, chi bộ trực thuộc (đơn vị: chi bộ)
- DANG_VIEN_KET_NAP: Đảng viên kết nạp trong năm (đơn vị: đảng viên)
- CHI_BO_HOAN_THANH_TOT: Tỷ lệ chi bộ hoàn thành tốt nhiệm vụ (đơn vị: %)
- NV_CAP_UY_HOAN_THANH: Tỷ lệ nhiệm vụ cấp ủy hoàn thành (đơn vị: %)

3. Khối UBND (UBND):
- HO_SO_HANH_CHINH: Số hồ sơ hành chính tiếp nhận (đơn vị: hồ sơ)
- HO_SO_DUNG_HAN: Tỷ lệ hồ sơ giải quyết đúng hạn và trước hạn (đơn vị: %)
- THU_NGAN_SACH: Kết quả thu ngân sách nhà nước trên địa bàn (đơn vị: triệu đồng hoặc tỷ đồng)
- GIAI_NGAN_VON: Giải ngân vốn đầu tư công (đơn vị: triệu đồng hoặc tỷ đồng)
- HO_NGHEO_CAN_NGHEO: Số hộ nghèo và cận nghèo (đơn vị: hộ)
- TY_LE_BHYT: Tỷ lệ người dân tham gia BHYT (đơn vị: %)
- PHAN_ANH_KIEN_NGHI: Phản ánh, kiến nghị / đơn thư giải quyết (đơn vị: đơn hoặc việc)

4. Khối Mặt trận Tổ quốc & Đoàn thể (MTTQ):
- DOAN_VIEN_HOI_VIEN: Tổng số đoàn viên, hội viên (đơn vị: người)
- PHONG_TRAO_TRIEN_KHAI: Số cuộc vận động, phong trào thi đua (đơn vị: cuộc)
`;

async function main() {
  console.log('=== TEST LLM EXTRACTION FOR COMMUNE REPORT ===');
  console.log(`Endpoint: ${BASE_URL}/chat/completions`);
  console.log(`Model: ${MODEL}`);

  const samplePdfPath = path.resolve(__dirname, '../../../../docs/T9. BC-KTXH 9 thang-2026-UBND Thien Tan (ban tai 26.9) (1).pdf');
  if (!fs.existsSync(samplePdfPath)) {
    console.error(`Không tìm thấy file: ${samplePdfPath}`);
    return;
  }

  console.log(`Đang đọc file PDF: ${path.basename(samplePdfPath)}...`);
  const dataBuffer = fs.readFileSync(samplePdfPath);
  const parser = new PDFParse({ data: dataBuffer });
  const pdfData = await parser.getText();
  await parser.destroy();

  console.log(`Tổng số trang PDF: ${pdfData.total}`);
  console.log(`Độ dài văn bản thô trích xuất: ${pdfData.text.length} ký tự`);

  // Lọc lấy Phần I (Tình hình và kết quả thực hiện) - nơi chứa toàn bộ số liệu thực tế
  let content = pdfData.text;
  const startIdx = content.indexOf('TÌNH HÌNH KINH TẾ XÃ HỘI 9 THÁNG NĂM 2026');
  const endIdx = content.indexOf('Phần II');
  if (startIdx !== -1 && endIdx !== -1) {
    content = content.substring(startIdx, endIdx);
    console.log(`Đã trích xuất Phần I (kết quả thực hiện): ${content.length} ký tự`);
  }

  // Giới hạn trong khoảng 25,000 ký tự đầu của Phần I (đủ toàn bộ Kinh tế, Nông lâm nghiệp, Ngân sách, ĐTC, Xã hội, TTHC, Đơn thư)
  const slicedContent = content.slice(0, 28000);

  const systemPrompt = `Bạn là Trợ lý AI Chuyên gia Phân tích Văn bản Báo cáo Hành chính Nhà nước cấp xã (Xã Thiện Tân, Lạng Sơn).
Nhiệm vụ của bạn là đọc kỹ văn bản báo cáo kinh tế - xã hội được cung cấp và trích xuất CHÍNH XÁC các chỉ tiêu số liệu thuộc "Danh mục 19 chỉ tiêu điều hành chuẩn IOC Xã Thiện Tân".

QUY TẮC BẮT BUỘC:
1. CHỈ trích xuất các chỉ tiêu có trong "Danh mục 19 chỉ tiêu điều hành chuẩn" dưới đây. TUYỆT ĐỐI KHÔNG tự tạo mã chỉ tiêu khác ngoài 19 mã này.
2. Với mỗi chỉ tiêu tìm thấy trong văn bản báo cáo:
   - "code": BẮT BUỘC phải là 1 trong 19 mã chuẩn (Ví dụ: THU_NGAN_SACH, GIAI_NGAN_VON, HO_SO_HANH_CHINH, HO_SO_DUNG_HAN, HO_NGHEO_CAN_NGHEO, TY_LE_BHYT, PHAN_ANH_KIEN_NGHI, THON_TDP, HO_DAN, DAN_SO...).
   - "name": Tên chuẩn của chỉ tiêu.
   - "category": Phân loại tương ứng: "CHUNG", "DANG_UY", "UBND", "MTTQ".
   - "unit": Đơn vị tính ghi nhận trong văn bản (ví dụ: triệu đồng, %, hộ, đơn, thôn...).
   - "actualValue": Giá trị số thực tế đạt được (dạng number). Nếu văn bản ghi "7.151 triệu đồng" thì ghi số 7151. Nếu ghi tỷ lệ 97.8% thì ghi 97.8.
   - "targetValue": Giá trị kế hoạch / dự toán giao (nếu văn bản có nêu, dạng number hoặc null nếu không có).
   - "completionRate": Tỷ lệ hoàn thành theo kế hoạch (dạng number %, ví dụ 184 hoặc 95.7, hoặc null).
   - "sourceEvidence": Đoạn văn trích dẫn NGUYÊN VĂN từ văn bản làm bằng chứng (bắt buộc phải có để đối soát).
   - "note": Ghi chú ngắn gọn (ví dụ: "Lũy kế 9 tháng năm 2026").
3. Bóc tách thông tin hồ sơ của báo cáo:
   - "code": Số ký hiệu báo cáo (ví dụ: "489/BC-UBND").
   - "title": Tiêu đề đầy đủ của báo cáo.
   - "agency": Cơ quan ban hành (ví dụ: "UBND Xã Thiện Tân").
   - "period": Kỳ báo cáo (ví dụ: "9 tháng năm 2026").
   - "year": Năm báo cáo (dạng số nguyên, ví dụ: 2026).
   - "summary": Tóm tắt kết quả nổi bật của báo cáo trong 2-3 câu.

${STANDARD_METRICS_LIST}

ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT một đối tượng JSON hợp lệ (không kèm theo bất kỳ văn bản giải thích nào):
{
  "reportInfo": {
    "code": "489/BC-UBND",
    "title": "Báo cáo Tình hình thực hiện Kế hoạch phát triển kinh tế - xã hội 9 tháng...",
    "agency": "UBND Xã Thiện Tân",
    "period": "9 tháng năm 2026",
    "year": 2026,
    "summary": "..."
  },
  "metrics": [
    {
      "code": "THU_NGAN_SACH",
      "name": "Kết quả thu ngân sách nhà nước",
      "category": "UBND",
      "unit": "triệu đồng",
      "actualValue": 7151,
      "targetValue": 3893,
      "completionRate": 184,
      "sourceEvidence": "...",
      "note": "..."
    }
  ]
}`;

  console.log('\nĐang gửi request đến LLM (enable_thinking: false)...');
  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Dưới đây là văn bản báo cáo kinh tế - xã hội:\n\n${slicedContent}` },
        ],
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.1,
        max_tokens: 3000,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        timeout: 90000,
      }
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Đã nhận phản hồi từ LLM sau ${elapsed}s!`);

    const rawOutput = response.data.choices?.[0]?.message?.content || '';
    console.log('\n--- KẾT QUẢ THÔ TỪ LLM (trích 400 ký tự đầu) ---');
    console.log(rawOutput.slice(0, 400));

    // Làm sạch Markdown format nếu có
    let cleanJson = rawOutput.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsedData = JSON.parse(cleanJson);
    console.log('\n=== THÔNG TIN HỒ SƠ BÁO CÁO (reportInfo) ===');
    console.log(JSON.stringify(parsedData.reportInfo, null, 2));

    console.log(`\n=== DANH SÁCH ${parsedData.metrics?.length || 0} CHỈ TIÊU TRÍCH XUẤT ĐƯỢC TỪ BÁO CÁO ===`);
    if (parsedData.metrics && Array.isArray(parsedData.metrics)) {
      parsedData.metrics.forEach((m: any, idx: number) => {
        console.log(`\n[${idx + 1}] Mã: ${m.code} | ${m.name} (${m.category})`);
        console.log(`    Thực tế: ${m.actualValue} ${m.unit} | Kế hoạch: ${m.targetValue ?? 'N/A'} | Hoàn thành: ${m.completionRate ?? 'N/A'}%`);
        console.log(`    Trích dẫn bằng chứng: "${m.sourceEvidence}"`);
        if (m.note) console.log(`    Ghi chú: ${m.note}`);
      });
    }

    // Ghi kết quả ra file scratch để kiểm tra
    const outPath = path.resolve(__dirname, '../../../../scratch/test-llm-extracted.json');
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outPath, JSON.stringify(parsedData, null, 2), 'utf-8');
    console.log(`\n=> Đã lưu file kết quả: ${outPath}`);

  } catch (error: any) {
    console.error('Lỗi khi gọi LLM:', error.response?.data || error.message);
  }
}

main().catch(console.error);
