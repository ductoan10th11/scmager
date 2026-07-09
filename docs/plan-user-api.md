# Kế hoạch triển khai kết nối User API (Frontend)

## 1. Phân tích yêu cầu từ tài liệu `frontend-user-api.md`
- **Các API cần tích hợp**:
  - `GET /api/users` (Kèm query params: page, limit, search, status, role...)
  - `GET /api/users/:id`
  - `POST /api/users` (Tạo user mới)
  - `PATCH /api/users/:id` (Cập nhật user)
  - `DELETE /api/users/:id` (Xóa user - chuyển sang INACTIVE)
- **Cơ chế xác thực (Auth)**:
  - Dùng HTTP-only cookie (`scmager_session`), do đó các request cần gửi qua Vite proxy (dùng relative path `/api/...`).
  - *Lưu ý*: Hiện tại ở `LoginPage.vue` đang dùng `fetch('http://${hostname}:8004/api/...')` trực tiếp, ta sẽ cần chuẩn hóa lại thành gọi `/api/...` để cookie hoạt động trơn tru qua proxy theo đúng thiết kế.

## 2. Các bước triển khai (Đề xuất)

### Bước 1: Tạo module API chung và User API service
- Tạo file `src/lib/api/index.js` (hoặc cấu hình dùng chung) để bọc hàm `fetch` cơ bản, tự động xử lý các lỗi HTTP chung (401, 403, 500).
- Tạo file `src/lib/api/users.js` chứa các hàm:
  - `getUsers(params)`
  - `getUserById(id)`
  - `createUser(data)`
  - `updateUser(id, data)`
  - `deleteUser(id)`

### Bước 2: Chuẩn hóa lại cấu hình Fetch ở Login (Nếu cần)
- Đổi từ gọi thẳng cổng 8004 sang gọi `/api/auth/me` để tận dụng Vite proxy và cookie (giúp cho việc phân quyền/cookie an toàn hơn như mô tả trong tài liệu).

### Bước 3: Chuẩn bị UI Quản lý User (User Management)
- Tạo một trang mới `src/pages/UsersPage.vue` hoặc tích hợp vào một menu "Quản lý nhân sự/người dùng" ở Sidebar.
- Layout: 
  - Table/Grid hiển thị danh sách User (sử dụng component của Shadcn, UI bo tròn góc theo Rule).
  - Có các chức năng: Search, Filter theo Role/Status, Pagination.
  - Modal tạo mới / chỉnh sửa thông tin người dùng (dùng Shadcn Dialog + form validation).
  - Xác nhận khi xóa (Confirm Dialog).
- Animation: Sử dụng Framer Motion cho các transition khi mở modal, xoá/thêm dòng trong bảng (theo Rule Frontend).

### Bước 4: Tích hợp API vào UI
- Gọi `getUsers` khi trang được load (mount).
- Gắn các action (Create, Update, Delete) gọi trực tiếp API và sau đó refresh lại danh sách.
- Hiển thị loading state (Skeleton hoặc Spinner) trong quá trình call API.

---
**Câu hỏi cần lấy ý kiến anh/chị:**
1. Anh/chị có muốn tạo luôn trang `UsersPage.vue` và đưa vào routing (như `/users`) không, hay chỉ cần viết các hàm gọi API ở thư mục `lib/api` trước?
2. Anh/chị đồng ý với việc đổi đường dẫn API trong `LoginPage.vue` từ `http://hostname:8004/api/...` thành `/api/...` để proxy xử lý cookie tự động không?
