# Yêu cầu sửa cấu trúc Frontend

## Mục tiêu

Frontend hiện tại không cần đổi framework. Vẫn giữ Vue/Vite/Tailwind và các UI component đang có, nhưng phải sửa lại cấu trúc thư mục, trách nhiệm của page, luồng dữ liệu và auth để bám đúng tài liệu nghiệp vụ/kiến trúc hiện có.

Tài liệu này là checklist yêu cầu refactor, không phải đặc tả đổi giao diện.

## Căn cứ từ docs hiện có

- `docs/BA.md` xác định 4 vai trò chính: Chánh văn phòng, Lãnh đạo UBND xã, Lãnh đạo phòng, Chuyên viên.
- `docs/BA.md` xác định các phân hệ nghiệp vụ chính: giao việc/luân chuyển, phân loại nhiệm vụ, lịch công tác, timesheet, thông báo, AI hỗ trợ thẩm định.
- `docs/architecture.md` xác định client layer chỉ gọi backend qua API/services layer, không tự giữ state nghiệp vụ giả lập như nguồn dữ liệu chính.
- `docs/frontend-user-api.md` xác định frontend gọi API qua relative path `/api/...`; auth dùng cookie HTTP-only `scmager_session`, không dùng token tự lưu trong frontend.

## Vấn đề hiện tại

### 1. Page đang bị lạc khỏi nghiệp vụ

Các page hiện tại như `DashboardPage.vue`, `SchedulePage.vue`, `AssignmentPage.vue` đang được thiết kế theo hướng màn hình demo độc lập. Chúng chưa thể hiện rõ màn hình thuộc vai trò nào và đang trộn nhiều ý tưởng UI vào cùng một nơi.

Ví dụ:

- `DashboardPage.vue` đang vừa làm dashboard, vừa chứa timeline cá nhân, vừa có AI chat mock.
- `AssignmentPage.vue` đang mô phỏng resource planner kiểu công ty phần mềm với các role như Developer, Designer, QA, DevOps, Product Owner. Các role này không khớp BA của hệ thống cơ quan nhà nước.
- `SchedulePage.vue` chỉ bọc `ScheduleFeature.vue`, nhưng feature bên trong lại dùng mock global và tự xử lý nhiều state nghiệp vụ.
- Chưa có ranh giới rõ giữa màn hình cho Chánh văn phòng, Lãnh đạo phòng, Lãnh đạo UBND xã và Chuyên viên.

Yêu cầu sửa: mỗi page phải đại diện cho một route/use case rõ ràng, không là nơi gom nhiều prototype.

### 2. Page đang chứa quá nhiều logic

Các file page hiện tại chứa trực tiếp:

- mock data;
- tính toán nghiệp vụ;
- state form;
- xử lý drag/swipe;
- xử lý auth/user;
- xử lý API/fetch;
- layout chi tiết;
- component UI lặp lại.

Yêu cầu sửa: page chỉ nên đóng vai trò route container. Logic phải được tách xuống `features`, `services`, `composables` và component con.

### 3. Dữ liệu mock đang bị dùng như nguồn dữ liệu thật

Frontend đang import trực tiếp từ `src/mocks`, ví dụ `globalMockEvents`, hoặc khai báo mock ngay trong page. Điều này làm page bị lệch khỏi kiến trúc Client-Server trong docs.

Mock chỉ được dùng cho dev/demo có kiểm soát, không được là dependency trực tiếp của production page.

Yêu cầu sửa:

- tạo API/service layer để gọi `/api/...`;
- mock nếu còn cần thì đặt sau interface giống API thật;
- page/feature không import trực tiếp `src/mocks`;
- mock role/user/task phải dùng đúng domain trong BA.

### 4. Auth đang sai contract API

`docs/frontend-user-api.md` ghi rõ auth dùng cookie HTTP-only `scmager_session`. Frontend không cần đọc JWT.

Hiện tại frontend đang:

- gọi login bằng URL tuyệt đối theo endpoint cũ;
- tự lưu `token` vào `localStorage`;
- tạo `dummy-token` nếu backend không trả token;
- route guard kiểm tra `localStorage.getItem('token')`;
- logout chỉ xóa localStorage, không gọi API logout;
- user info được lưu thủ công vào `localStorage`.

Yêu cầu sửa:

- login gọi `POST /api/auth/me` bằng relative path;
- gửi body theo contract: `login`, `password`, `remember`;
- không tạo token giả;
- không lưu session token ở localStorage;
- route guard/auth bootstrap phải gọi `GET /api/auth/me`;
- logout phải gọi `DELETE /api/auth/me`, sau đó clear client state;
- user hiện tại lấy từ response `/api/auth/me`, không tự dựng từ localStorage.

### 5. Router chưa phản ánh domain và quyền

Router hiện tại chỉ có:

- `/`
- `/login`
- `/dashboard`
- `/schedule`
- `/assignment`

Cấu trúc này chưa đủ để map các phân hệ trong BA và chưa thể hiện quyền truy cập theo role.

Yêu cầu sửa router:

- tách route public và protected rõ ràng;
- route protected dùng layout chính;
- mỗi route có `meta.requiresAuth`;
- các route nghiệp vụ có `meta.roles` nếu chỉ một số vai trò được truy cập;
- guard dựa trên `/api/auth/me` và role từ backend.

Route mục tiêu tối thiểu:

```text
/login
/dashboard
/schedule
/tasks
/assignments
/timesheets
/documents
/notifications
/users
/settings
```

Có thể chưa implement đủ UI cho tất cả route, nhưng cấu trúc route phải sẵn sàng cho các module này.

### 6. Layout đang lẫn auth/user state và navigation hard-code

`MainLayout.vue` đang tự đọc `currentUser` từ localStorage, tự logout bằng localStorage và hard-code nav đơn giản.

Yêu cầu sửa:

- layout chỉ nhận user/auth state từ auth store/composable;
- navigation lấy từ cấu hình route/menu theo role;
- logout đi qua auth service;
- không để layout tự hiểu chi tiết storage/session.

### 7. Feature folder chưa theo module nghiệp vụ

Hiện có `src/features/schedule`, nhưng các nghiệp vụ khác lại nằm trong `pages` hoặc mock. Cấu trúc này khiến page phình to và khó mở rộng.

Yêu cầu sửa cấu trúc frontend theo module nghiệp vụ:

```text
src/
  app/
    router/
    providers/
  layouts/
  shared/
    api/
    components/
    lib/
  features/
    auth/
    dashboard/
    schedule/
    tasks/
    assignments/
    timesheets/
    documents/
    notifications/
    users/
  pages/
```

Quy ước:

- `pages`: route container, ít logic.
- `features/<module>`: component, composable, service, type/model của module.
- `shared/api`: wrapper fetch dùng chung.
- `shared/components`: component dùng chung không gắn nghiệp vụ.
- `mocks`: chỉ dùng qua adapter/dev flag, không import trực tiếp trong page.

## Cấu trúc page mục tiêu

### Dashboard

Mục đích: tổng quan theo vai trò.

Không nên chứa chi tiết xử lý lịch/giao việc/AI chat quá sâu. Các phần đó phải là widget từ feature tương ứng.

Gợi ý component:

```text
features/dashboard/
  components/
    DashboardKpiGrid.vue
    OverdueTaskWidget.vue
    TodayScheduleWidget.vue
    RoleSummaryWidget.vue
  services/
    dashboard.service.js
```

### Schedule

Mục đích: lịch công tác, giấy mời, lịch cá nhân/phòng.

Không dùng `globalMockEvents` trực tiếp trong page/feature production.

Gợi ý component:

```text
features/schedule/
  components/
    ScheduleCalendar.vue
    ScheduleTimeline.vue
    ScheduleFilters.vue
    ScheduleEventForm.vue
  services/
    schedule.service.js
```

### Assignments

Mục đích: luân chuyển/giao việc theo đúng BA: Chánh văn phòng giao cho phòng, Lãnh đạo phòng giao cho chuyên viên.

Không dùng domain resource planner với Developer/Designer/QA. Người nhận phải là department/specialist theo mô hình cơ quan.

Gợi ý component:

```text
features/assignments/
  components/
    AssignmentInbox.vue
    DepartmentAssignmentForm.vue
    SpecialistAssignmentForm.vue
    AssigneeWorkloadPanel.vue
  services/
    assignment.service.js
```

### Tasks

Mục đích: quản lý vòng đời task `To-Do -> In Progress -> Done`, deadline, trạng thái trễ hạn.

Gợi ý component:

```text
features/tasks/
  components/
    TaskList.vue
    TaskDetailDrawer.vue
    TaskStatusBadge.vue
    TaskCreateForm.vue
  services/
    task.service.js
```

### Timesheets

Mục đích: khai báo giờ, kiểm soát tổng giờ/ngày không vượt 8 tiếng, phê duyệt/đánh giá.

Gợi ý component:

```text
features/timesheets/
  components/
    DailyTimesheet.vue
    TimeAllocationForm.vue
    WorkloadWarning.vue
    TimesheetApprovalPanel.vue
  services/
    timesheet.service.js
```

### Documents

Mục đích: văn bản đầu vào, file đính kèm, AI/OCR, thẩm định.

Gợi ý component:

```text
features/documents/
  components/
    IncomingDocumentList.vue
    DocumentDetail.vue
    OcrExtractionPanel.vue
    ReviewAssistantPanel.vue
  services/
    document.service.js
```

### Users

Mục đích: quản trị user theo `docs/frontend-user-api.md`.

Gợi ý component:

```text
features/users/
  components/
    UserTable.vue
    UserForm.vue
    UserStatusBadge.vue
  services/
    user.service.js
```

## API layer bắt buộc

Tạo một wrapper gọi API dùng chung, ví dụ:

```text
src/shared/api/http.js
```

Yêu cầu:

- base URL là relative `/api`;
- parse response theo format `{ data, meta }` hoặc `{ error }`;
- xử lý 401 tập trung;
- hỗ trợ cookie session mặc định cùng origin;
- không hard-code `localhost:8004` trong component/page.

Các feature service chỉ gọi qua wrapper này:

```text
src/features/auth/services/auth.service.js
src/features/users/services/user.service.js
src/features/schedule/services/schedule.service.js
...
```

## Auth layer bắt buộc

Tạo module auth riêng:

```text
src/features/auth/
  composables/
    useAuth.js
  services/
    auth.service.js
  components/
    LoginForm.vue
```

Trách nhiệm:

- `login(payload)`: gọi `POST /api/auth/me`;
- `logout()`: gọi `DELETE /api/auth/me`;
- `loadMe()`: gọi `GET /api/auth/me`;
- giữ `currentUser`, `isAuthenticated`, `isLoading`;
- route guard không đọc localStorage token.

## Nguyên tắc refactor

1. Không đổi framework trong đợt sửa này.
2. Không rewrite toàn bộ UI nếu chưa cần; ưu tiên di chuyển logic về đúng module.
3. Không để page import trực tiếp mock data.
4. Không để component tự hard-code API host.
5. Không lưu token/session trong localStorage.
6. Không dùng role/demo data ngoài domain BA.
7. Mỗi page phải có mục đích nghiệp vụ rõ ràng.
8. Logic tính toán nghiệp vụ đặt trong composable/service của feature, không đặt rải trong template page.
9. Component dùng chung không được phụ thuộc module nghiệp vụ.
10. Các route protected phải đi qua auth guard dùng `/api/auth/me`.

## Thứ tự sửa đề xuất

1. Tạo `shared/api/http.js`.
2. Tạo `features/auth` và sửa login/logout/route guard theo cookie session.
3. Sửa router: public/protected/meta/role.
4. Tách `MainLayout.vue` khỏi localStorage và hard-code user.
5. Tách dashboard thành widgets theo feature.
6. Tách schedule khỏi mock global.
7. Sửa assignment về đúng domain giao việc cơ quan.
8. Thêm route/module skeleton cho tasks, timesheets, documents, users.
9. Đưa mock vào adapter/dev-only nếu vẫn cần demo.
10. Kiểm tra lại build và các luồng auth/login/logout.

## Definition of Done

- `LoginPage` không gọi host tuyệt đối, không lưu token, không tạo dummy token.
- Router guard dựa trên auth state từ `/api/auth/me`.
- `MainLayout` không đọc user từ localStorage.
- Page không import trực tiếp từ `src/mocks`.
- Các page lớn được tách thành component feature.
- Assignment dùng đúng role/phòng/chuyên viên theo BA.
- Có route/module rõ cho dashboard, schedule, tasks, assignments, timesheets, documents, users.
- `npm run build` hoặc script build tương ứng chạy thành công trong `apps/web`.
