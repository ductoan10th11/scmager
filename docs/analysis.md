# Phân tích Yêu cầu: Hệ thống Quản lý Lịch công tác và Theo dõi Nhiệm vụ Cơ quan

Tài liệu này được lập ra nhằm phân tích và làm rõ các ý tưởng (raw idea) thành các tính năng và module cụ thể để phục vụ cho việc phát triển phần mềm (Web & App).

## 1. Phân tích Nền tảng và Giải pháp Tích hợp

- **Giải pháp đa nền tảng:** 
  - Hệ thống được triển khai đồng bộ trên cả Web và Mobile App, đảm bảo mọi đối tượng người dùng (từ ban lãnh đạo đến chuyên viên) đều có thể truy cập và xử lý công việc linh hoạt trên mọi thiết bị.
- **Tích hợp với hệ thống Văn bản điện tử (VNPT):**
  - **Vấn đề:** Các hệ thống văn bản của cơ quan nhà nước thường đóng và khó lấy API.
  - **Giải pháp đề xuất (Browser Extension / RPA):** Xây dựng một Extension trên trình duyệt (Chrome/Edge). Khi văn thư/Chánh văn phòng thao tác giao việc trên trang web của VNPT, Extension sẽ tự động "đọc" dữ liệu (số hiệu, trích yếu, người nhận, hạn xử lý) và đẩy ngầm qua API về hệ thống mới của chúng ta.
  - *Đánh giá:* Đây là giải pháp cực kỳ thực tế và thông minh để giảm tải việc nhập liệu 2 lần (double data entry) nếu không lấy được API trực tiếp từ VNPT.

## 2. Phân tích Module: Quy trình luân chuyển & Giao việc

Quy trình giao việc đi theo hình tháp:
`Văn bản đến -> Chánh văn phòng -> Lãnh đạo Phòng chuyên môn -> Chuyên viên`

**Tính năng cụ thể:**
- **Module Tiếp nhận & Phân công:**
  - Chánh văn phòng nhận văn bản, click chuyển cho Phòng ban.
  - Lãnh đạo phòng nhận thông báo, tiến hành "Giao việc" cho cá nhân.
- **Module Cảnh báo (Reminder):**
  - Trigger tự động: Nếu văn bản đã nằm ở phòng 1 khoảng thời gian (VD: 4h làm việc) mà chưa có chuyên viên nào được giao, hệ thống sẽ gửi Alert cho Lãnh đạo phòng.

## 3. Phân tích Module: Quản lý Công việc & Khai báo Thời gian

Đây là Core tính năng (cốt lõi) của hệ thống giúp đảm bảo định mức làm việc và kiểm soát tiến độ.

- **Nguồn tạo công việc:**
  1. *Thủ công:* Giao việc trực tiếp.
  2. *Tự động (Smart / AI):* Bóc tách từ file Word/PDF (dùng OCR/AI) và theo dõi thư mục (Folder watcher).
  3. *Hệ thống văn bản điện tử:* Đẩy qua Extension.
- **Phân loại 3 nhóm việc chính:**
  - `Task_Meeting` (Giấy mời): Cần đổ vào lịch Calendar.
  - `Task_Deadline` (Hạn công việc): Có thời gian Bắt đầu và Kết thúc rõ ràng.
  - `Task_Daily` (Khai báo hàng ngày): Các việc lặt vặt cộng dồn.
- **Cơ chế Time-tracking (Định mức 8h/ngày):**
  - Giao diện của chuyên viên sẽ giống như một "Timesheet". Chuyên viên gán thời gian dự kiến (VD: Việc A 3h, Việc B 5h).
  - Hệ thống sẽ cảnh báo nếu tổng thời gian khai báo < 8h hoặc > 8h/ngày để điều chỉnh.

## 4. Phân tích Chức năng theo Phân quyền (Roles & Permissions)

Dựa trên ý tưởng, hệ thống cần 4 Role chính với các Dashboard khác nhau:

| Role (Vai trò) | View (Quyền xem) | Action (Quyền thao tác) | KPI & Dashboard |
| :--- | :--- | :--- | :--- |
| **Chánh văn phòng** | Toàn bộ cơ quan | Giao việc cho các phòng, đôn đốc | Thống kê số lượng văn bản, tiến độ các phòng. Công cụ check lỗi chính tả AI. |
| **Lãnh đạo UBND xã** | Toàn bộ cơ quan | Nhận thông báo, đôn đốc, phê duyệt | Dashboard cảnh báo việc chậm hạn, việc sắp đến hạn. Xem biểu đồ nhân sự. |
| **Lãnh đạo phòng** | Trong phạm vi phòng | Giao việc cho chuyên viên, đánh giá | Dashboard theo dõi chuyên viên: ai rảnh, ai bận, trễ hạn. Xem biểu đồ KPI phòng. |
| **Chuyên viên** | Cá nhân | Nhận việc, khai báo lịch, hoàn thành việc | Lịch làm việc cá nhân (Timesheet), danh sách Task cần làm. |

## 5. Phân tích Luồng Dữ liệu (Data Flow) - Ví dụ thực tế

Dựa vào ví dụ 2 ngày của ý tưởng:
- **Input (Sáng Ngày 1):** Chuyên viên A vào app, tạo task "Làm báo cáo năm" (Estimates: 8h, hạn 2 ngày). Task "Đưa nhà báo đi" (3h).
- **Processing:** Hệ thống thấy ngày 1 có tổng (8h + 3h = 11h). Vượt quá 8h/ngày. Chuyên viên tự động tách "Làm báo cáo năm" thành 2 phần: 5h cho Ngày 1 và 3h cho Ngày 2.
- **Output (Ngày 1):** Lãnh đạo nhìn vào Dashboard thấy chuyên viên A đã "Full capacity" (Kín lịch 8h).
- **Output (Ngày 2):** Chuyên viên làm nốt 3h báo cáo, khai báo thêm 1h công văn và 4h thẩm định. Cuối ngày bấm "Hoàn thành". Hệ thống chuyển trạng thái sang `Done` -> Gửi thông báo cho Lãnh đạo thẩm định.

---
**Đề xuất các bước tiếp theo (Next steps):**
1. Xác định công nghệ cho Extension và Mobile App.
2. Thiết kế Database Schema (Mô hình CSDL) dựa trên 4 Roles và 3 Loại Tasks này.
3. Lên Wireframe/Mockup cho giao diện (Timesheet, Bảng Kanban/List giao việc).
