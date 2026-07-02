# Lộ trình Triển khai Dự án (Phased Implementation Plan)

Tài liệu này mô tả chi tiết quy trình triển khai hệ thống **Quản lý Lịch công tác và Theo dõi Nhiệm vụ** qua từng giai đoạn cụ thể. Mục tiêu là để roll-out (phát hành) các tính năng dần dần, giúp người dùng dễ làm quen và hệ thống hoạt động ổn định.

---

## Giai đoạn 1: Chuẩn bị Hạ tầng & Môi trường (Infrastructure)

Đây là bước nền móng, đảm bảo các máy chủ và dịch vụ lõi sẵn sàng trước khi team Dev bắt đầu code.

1. **Setup Máy chủ Ứng dụng (`vmc03`):** Cài đặt OS Ubuntu 24.04, cấp phát 16 Cores, 70GB RAM, 700GB NVMe. Mở thông mạng nội bộ.
2. **Cài đặt Dịch vụ Lõi (Core Services):** Triển khai MongoDB, MinIO (lưu file), và Valkey (cache/queue) trên `vmc03` qua Docker.
3. **Kết nối Máy chủ AI:** Đảm bảo `vmc03` có thể gọi API thành công sang Server chứa mô hình AI (Qwen 3.6 27B) ở một IP khác trong mạng LAN.
4. **Setup CI/CD (Tùy chọn):** Thiết lập luồng tự động build code Monorepo (Turborepo) để sẵn sàng deploy.

---

## Giai đoạn 2: Phát triển & Triển khai Tính năng Cốt lõi (Core System)

Giai đoạn này tập trung vào số hóa quy trình cơ bản để thay thế cách làm truyền thống.

1. **Quản trị người dùng & Phân quyền:** Xây dựng hệ thống Đăng nhập, phân quyền RBAC cho 4 cấp (Chánh văn phòng, Lãnh đạo xã, Lãnh đạo phòng, Chuyên viên).
2. **Quản lý Công việc thủ công:** Cho phép người dùng giao việc và nhận việc bằng cách nhập tay. Phân loại 3 nhóm việc (Giấy mời, Deadline, Khai báo ngày).
3. **Quản lý Thời gian (Timesheet):** Hoàn thiện logic khai báo công việc và **Rule chặn 8 tiếng/ngày**.
4. **UAT & Chạy thử nghiệm:** Triển khai bản Beta lên `vmc03` để 1-2 phòng ban dùng thử và góp ý (Sửa lỗi/Fix bugs đợt 1).

---

## Giai đoạn 3: Tích hợp Tự động hóa VNPT (Browser Extension)

Sau khi hệ thống lõi đã chạy ổn, tiến hành giảm tải thao tác nhập liệu thủ công cho Văn thư/Chánh văn phòng.

1. **Phát triển Extension:** Code Extension (Manifest V3) chạy ngầm trên trình duyệt.
2. **Bắt sự kiện VNPT:** Khi Văn thư thao tác trên trang văn bản VNPT, Extension tự động đọc dữ liệu (Số ký hiệu, Hạn xử lý, Trích yếu).
3. **Tự động hóa giao việc:** Extension bắn data về API của `vmc03` để tự tạo Task Nháp.
4. **Deploy Extension:** Đóng gói và hướng dẫn cài đặt Extension lên máy tính của cán bộ thao tác.

---

## Giai đoạn 4: Tích hợp AI và Trải nghiệm Thời gian thực (Advanced Features)

Nâng cấp hệ thống trở nên thông minh và tức thời.

1. **Ứng dụng AI/OCR:** Tích hợp với Server AI (Qwen) để đọc nội dung file PDF đính kèm, tự động sinh ra mô tả công việc (Task).
2. **AI Thẩm định:** Lãnh đạo dùng AI để check lỗi chính tả, tóm tắt nhanh văn bản do chuyên viên đệ trình.
3. **Real-time (Socket.IO):** Kích hoạt WebSockets để thông báo (Ting ting) ngay lập tức trên màn hình khi có việc mới được giao mà không cần tải lại trang.
4. **Cảnh báo SLA:** Kích hoạt Background Jobs (BullMQ) để quét tự động, nếu 4 tiếng chưa ai nhận việc -> Bắn cảnh báo đỏ.

---

## Giai đoạn 5: Ra mắt Ứng dụng Di động (Mobile App Rollout)

Mở rộng đa nền tảng để phục vụ Lãnh đạo khi đi công tác ngoài.

1. **Phát triển App:** Code bản Mobile App (Kotlin cho Android, Swift cho iOS).
2. **Tính năng tập trung:** Dashboard biểu đồ cho Lãnh đạo, Lịch họp, và tính năng Duyệt việc nhanh.
3. **Push Notification:** Tích hợp Firebase (FCM) / APNs để bắn thông báo thẳng về màn hình khóa điện thoại.
4. **Phát hành nội bộ:** Đẩy file `.apk` và TestFlight cho nội bộ cơ quan cài đặt.

---

## Giai đoạn 6: Vận hành, Bảo trì & Nâng cấp (O&M - Operations & Maintenance)

Đây là giai đoạn kéo dài vòng đời phần mềm sau khi hoàn tất Giai đoạn 5.

1. **Sao lưu dữ liệu (Backup):** Chạy lệnh Cron tự động dump DB và thư mục MinIO mỗi đêm. Lưu ra ổ cứng rời.
2. **Giám sát (Monitoring):** Kiểm tra log hệ thống (Pino) để phát hiện sớm nếu AI Server bị sập kết nối hoặc MongoDB quá tải.
3. **Bảo trì định kỳ:** Khởi động lại hệ thống hàng tháng, dọn dẹp các tệp Cache rác.
4. **Sửa lỗi (Bug Fixes) & Cập nhật:** Tiếp nhận yêu cầu nghiệp vụ mới từ cơ quan (Ví dụ: Thêm loại báo cáo mới), tiến hành code, test và deploy nóng lên `vmc03` không làm gián đoạn hệ thống.
