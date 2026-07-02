# Thiết kế Kiến trúc Hệ thống: Quản lý Lịch công tác và Nhiệm vụ

Tài liệu này mô tả kiến trúc tổng thể của hệ thống, bao gồm các thành phần (Components), luồng dữ liệu (Data Flow) và công nghệ đề xuất (Tech Stack) nhằm đáp ứng yêu cầu đa nền tảng và tích hợp với hệ thống hiện tại.

## 1. Tổng quan Kiến trúc (High-Level Architecture)

Hệ thống được thiết kế theo mô hình **Client-Server**, tổ chức mã nguồn dưới dạng **Monorepo (Turborepo)** để chia sẻ chung resource/type giữa các nền tảng. Backend áp dụng kiến trúc **Modular Monolith**, chia thành các module nghiệp vụ độc lập nhưng chạy chung trên một tiến trình Node.js nhằm đảm bảo khả năng mở rộng tốt mà vẫn dễ triển khai, bảo trì. Hệ thống gồm 3 lớp (Layers) chính:

1. **Client Layer (Lớp Giao diện):** Tương tác trực tiếp với người dùng.
2. **API & Services Layer (Lớp Xử lý nghiệp vụ):** Trung tâm điều phối, xử lý logic và giao tiếp với AI.
3. **Data Layer (Lớp Lưu trữ):** Lưu trữ dữ liệu an toàn và hiệu suất cao.

---

## 2. Các Thành phần Hệ thống (System Components)

### 2.1. Client Layer

- **Web Application:** Dành cho Chánh văn phòng, Lãnh đạo và Chuyên viên thao tác chuyên sâu (Giao việc, xem Dashboard, Timesheet).
- **Mobile Application:** Dành cho Lãnh đạo và Chuyên viên khi di chuyển (Nhận thông báo push, xem lịch họp, cập nhật trạng thái nhanh).
- **Browser Extension:** Cài trên trình duyệt của Văn thư/Chánh văn phòng để "lắng nghe" và trích xuất dữ liệu từ hệ thống văn bản VNPT.

### 2.2. API & Services Layer (Backend Node.js/Express)

Hệ thống backend được chia thành các Module nghiệp vụ độc lập (Modular Monolith):

- **Core/Auth Module:** Điểm tiếp nhận mọi request. Đảm nhiệm xác thực (JWT, Google OAuth, 2FA), middleware bảo mật (Helmet, CORS, Rate Limit Token Bucket) và phân quyền (RBAC).
- **Task Management Module:** Quản lý vòng đời của công việc (Tạo, Giao, Phê duyệt, Đánh giá).
- **Time Tracking Module:** Xử lý logic 8 tiếng/ngày, tính toán thời gian và phân bổ lịch trình.
- **AI / OCR Integration Module:**
  - Giao tiếp với các API AI để bóc tách nội dung văn bản.
  - Tự động kiểm tra lỗi chính tả trong văn bản thẩm định.
- **Notification Module:** Hệ thống đẩy thông báo (Push Notifications, Email, In-app).
- **Logging Module:** Ghi log hệ thống tốc độ cao (Pino).
- **Background Jobs (BullMQ + Valkey):** Quét định kỳ các công việc sắp tới hạn hoặc quá hạn để trigger Notification, xử lý ngầm không block luồng chính.

### 2.3. Data Layer

- **Primary Database (MongoDB):** Cơ sở dữ liệu NoSQL lưu trữ linh hoạt các collection (Users, Roles, Tasks, Schedules).
- **Cache & Message Queue (Redis):** Dùng để xử lý Rate Limiting, cache dữ liệu truy xuất nhanh (Dashboard) và quản lý hàng đợi cho Background Jobs (BullMQ).
- **File Storage (MinIO):** Server lưu trữ Object Storage tương thích chuẩn S3, an toàn và tối ưu cho việc lưu các tệp đính kèm, văn bản PDF/Word nội bộ (On-premise).

---

## 3. Luồng dữ liệu tiêu biểu (Data Flows)

### 3.1. Luồng Tích hợp Hệ thống ngoài (VNPT) qua Extension

1. **User** thao tác chuyển văn bản trên web VNPT.
2. **Extension** bắt được event, trích xuất dữ liệu (Số ký hiệu, Trích yếu, Hạn xử lý, Người nhận).
3. **Extension** gửi HTTP POST chứa dữ liệu mã hóa về **Core/Auth Module**.
4. **Core/Auth Module** lưu bản nháp công việc vào **Database** và điều phối qua **Notification Module** để báo Lãnh đạo phòng duyệt giao việc.

### 3.2. Luồng Khai báo và Cảnh báo Thời gian (Time-tracking)

1. **Chuyên viên** cập nhật thời gian dự kiến cho Task A (5h) và Task B (4h) trên **Web/App**.
2. Request được xử lý tại **Time Tracking Module**.
3. Module tính toán: `5h + 4h = 9h > định mức 8h`.
4. Module trả về cảnh báo `Overloaded` (Quá tải) cho Client.
5. Nếu cập nhật hợp lệ, dữ liệu lưu vào **Database** và cập nhật realtime lên **Dashboard** của Lãnh đạo.

---

## 4. Công nghệ đề xuất (Tech Stack Recommendation)

### Kiến trúc: Modular Monolith kết hợp Monorepo (Turborepo)

### Tech Stack:

- **Frontend (Web):** React (Vite, TSX), HeroUI, Tailwind CSS.
- **Frontend (Mobile):** Kotlin (Android) và Swift (iOS).
- **Browser Extension:** JavaScript (Manifest V3).
- **Backend:** Node.js (Express, TypeScript).
- **Database:** MongoDB (Mongoose).
- **Cache & Queue:** Valkey (BullMQ).
- **DevOps:** Docker, PM2, Nginx.
- **Security:** Helmet, CORS, Zod (Data Validation), JWT, Google OAuth, 2FA, Rate Limit (Token Bucket).
- **Authorization:** RBAC (Role-Based Access Control).
- **Real-time & Notifications:** Socket.IO (Web/Extension) và Firebase/APNs (Mobile).
- **Logging:** Pino.
- **Storage:** MinIO.
- **AI / OCR:** Qwen 3.6 27B (vLLM).
