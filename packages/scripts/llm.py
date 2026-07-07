import fitz  # PyMuPDF
import base64
import requests
import time
import argparse
import cv2
import numpy as np

def encode_page_to_base64(page):
    # Dùng zoom x1.5 (~100 DPI) vừa đủ cho VLM đọc mà không làm tràn bộ nhớ VRAM khi xử lý nhiều trang
    mat = fitz.Matrix(1.5, 1.5)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    
    # Chuyển thành bytes JPG chuẩn
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    elif pix.n == 3:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    else:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        
    _, buffer = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    return base64.b64encode(buffer).decode('utf-8')

def vlm_ocr_pdf(pdf_path):
    print(f"[*] Đang mở file PDF: {pdf_path}")
    doc = fitz.open(pdf_path)
    
    # Khởi tạo nội dung message với phần Text Prompt
    message_content = [
        {
            "type": "text",
            "text": """Hãy đọc toàn bộ tài liệu PDF đính kèm (gồm nhiều trang) và trích xuất đúng 3 thông tin:
1. Thửa đất số
2. Tờ bản đồ số
3. Tên Xã/Phường/Thị trấn (nằm trong phần Địa chỉ của thửa đất). Bắt buộc phải trả về nguyên văn bao gồm cả chữ "Xã", "Phường", hoặc "Thị trấn".

TRẢ VỀ ĐỊNH DẠNG JSON DUY NHẤT NHƯ SAU:
{
  "thua": "...",
  "to": "...",
  "xa": "Xã/Phường/Thị trấn ..."
}"""
        }
    ]
    
    # Chèn từng trang PDF dưới dạng ảnh vào mảng tin nhắn
    for page_num in range(len(doc)):
        print(f"--- Đang nén trang {page_num+1}/{len(doc)} ---")
        page = doc.load_page(page_num)
        b64_img = encode_page_to_base64(page)
        
        message_content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{b64_img}"
            }
        })
        
    payload = {
        "model": "qwen3.6-27b",
        "messages": [
            {
                "role": "system",
                "content": "Bạn là máy trích xuất dữ liệu. CHỈ TRẢ VỀ JSON HỢP LỆ. KHÔNG CÓ BẤT KỲ VĂN BẢN HAY LỜI BÌNH NÀO KHÁC."
            },
            {
                "role": "user",
                "content": message_content
            }
        ],
        "max_tokens": 150,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
        "chat_template_kwargs": {"enable_thinking": False}
    }
    
    print(f"[*] Đang gửi toàn bộ {len(doc)} trang tới Qwen-27B Vision để trích xuất JSON...")
    t0 = time.time()
    
    proxies = {
        "http": "socks5h://127.0.0.1:1055",
        "https": "socks5h://127.0.0.1:1055"
    }
    response = requests.post("http://100.94.148.68:8000/v1/chat/completions", json=payload, proxies=proxies)
    t1 = time.time()
    
    if response.status_code == 200:
        text = response.json()['choices'][0]['message']['content']
        print(f"\n[+] OCR HOÀN TẤT (Thời gian: {t1-t0:.2f}s)\n")
        print("="*60)
        
        import json
        from thefuzz import process
        
        try:
            import commune_code
            COMMUNE_DATA = commune_code.COMMUNE_DATA
        except ImportError:
            COMMUNE_DATA = {}

        try:
            clean_text = text.strip()
            if clean_text.startswith("```json"):
                clean_text = clean_text[7:]
            if clean_text.endswith("```"):
                clean_text = clean_text[:-3]
            
            data = json.loads(clean_text)
            thua = data.get("thua", "")
            to = data.get("to", "")
            xa_raw = data.get("xa", "").lower().strip()
            
            maxa = ""
            if xa_raw and COMMUNE_DATA:
                from thefuzz import fuzz
                
                search_term = xa_raw
                prefixes = ["xã ", "phường ", "thị trấn ", "thành phố ", "thị xã ", "huyện ", "tỉnh "]
                # Fallback: nếu LLM lỡ quên chữ xã thì tự động gắn vào để match tốt hơn
                if not any(search_term.startswith(p) for p in prefixes):
                    search_term = "xã " + search_term
                
                # So sánh nguyên mẫu toàn bộ chuỗi (bao gồm tiền tố) với từ điển
                best_match, score = process.extractOne(search_term, COMMUNE_DATA.keys(), scorer=fuzz.ratio)
                
                # Đối chiếu thêm với chuỗi thô của LLM
                best_match_raw, score_raw = process.extractOne(xa_raw, COMMUNE_DATA.keys(), scorer=fuzz.ratio)
                if score_raw > score:
                    best_match = best_match_raw
                    score = score_raw
                
                print(f"[*] Fuzzy Match: '{xa_raw}' -> '{best_match}' (Score: {score})")
                if score >= 60:
                    maxa = COMMUNE_DATA[best_match]
            
            final_result = {
                "thua": thua,
                "to": to,
                "xa": xa_raw,
                "maxa": maxa,
                "file_name": "CHUACOGIAY_0"+maxa+"_"+to+"_"+thua
            }
            print(json.dumps(final_result, ensure_ascii=False, indent=2))
        except Exception as e:
            print("[!] Không thể parse JSON hoặc tính toán Fuzzy:", e)
            print("Output gốc:")
            print(text)

        print("="*60)
    else:
        print(f"[!] Lỗi kết nối tới LLM: {response.status_code}")
        print(response.text)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test VLM OCR with Multi-page PDF")
    parser.add_argument("--pdf", type=str, required=True, help="Đường dẫn đến file PDF")
    args = parser.parse_args()
    vlm_ocr_pdf(args.pdf)
