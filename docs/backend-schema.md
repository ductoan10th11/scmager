# Backend Schema Design

Tài liệu này chuyển các ý trong `docs/idea.md`, `docs/analysis.md` và `docs/BA.md` thành mô hình dữ liệu MongoDB/Mongoose cho backend.

## Mục tiêu thiết kế

- Hỗ trợ luồng `Văn bản đến -> Chánh văn phòng -> Lãnh đạo phòng -> Chuyên viên`.
- Tách rõ 3 nhóm việc: `INVITATION` (Giấy mời), `DEADLINE` (Hạn công việc), `DAILY` (Khai báo hàng ngày).
- Kiểm soát định mức 8 giờ/ngày bằng `Timesheet.capacityMinutes = 480`.
- Lưu file nội bộ bằng MinIO, MongoDB chỉ giữ metadata và liên kết nghiệp vụ.
- Có nền cho AI/OCR, thông báo realtime, SLA quá 4 giờ chưa giao việc và audit log.

## Collections chính

### `roles`

Quản lý RBAC cấp hệ thống.

Trường chính:
- `code`: `ADMIN`, `OFFICE_CHIEF`, `COMMUNE_LEADER`, `DEPARTMENT_LEADER`, `SPECIALIST`.
- `level`: dùng để so sánh cấp giao việc.
- `permissions`: danh sách quyền chi tiết cho middleware sau này.

### `organizations`

Đơn vị hành chính/cơ quan.

Trường chính:
- `name`, `code`, `type`.
- `parent`: hỗ trợ cây huyện/xã/đơn vị con.

Index quan trọng:
- `{ parent, code }` unique.

### `departments`

Phòng/ban trong một cơ quan.

Trường chính:
- `organization`, `parent`.
- `leader`: lãnh đạo phòng.
- `isOffice`: đánh dấu Văn phòng HĐND - UBND/Chánh văn phòng.

Index quan trọng:
- `{ organization, code }` unique.

### `users`

Tài khoản cán bộ.

Trường chính:
- `role`, `organization`, `department`, `manager`.
- `status`, `lastLoginAt`, `notificationSettings`.
- `passwordHash` và `twoFactorEnabled` đặt `select: false`.

Index quan trọng:
- `email` unique.
- `{ organization, department, status }`.

### `incomingdocuments`

Văn bản đến từ nhập tay, VNPT extension, folder watcher hoặc AI/OCR.

Trường chính:
- `documentNumber`, `externalSystem`, `externalId`.
- `source`: `MANUAL`, `VNPT_EXTENSION`, `AI_OCR`, `FOLDER_WATCHER`.
- `status`: từ `DRAFT` đến `COMPLETED`/`ARCHIVED`.
- `currentDepartment`, `currentAssignee`.
- `slaDueAt`: mốc để BullMQ/Valkey quét cảnh báo nếu phòng chưa giao cho cá nhân.
- `routingHistory`: lịch sử Chánh văn phòng chuyển phòng, phòng giao chuyên viên, trả lại, hoàn tất.
- `relatedTasks`: các nhiệm vụ sinh ra từ văn bản.
- `aiExtraction`: trạng thái và kết quả OCR/tóm tắt.

Index quan trọng:
- `{ organization, documentNumber }` unique.
- `{ currentDepartment, status, slaDueAt }` cho SLA.
- `{ organization, status, dueAt }` cho dashboard.

### `tasks`

Nhiệm vụ thực thi. Một văn bản có thể sinh một hoặc nhiều task.

Trường chính:
- `type`: `INVITATION`, `DEADLINE`, `DAILY`.
- `status`: `TODO`, `IN_PROGRESS`, `PENDING_REVIEW`, `REVISION_REQUESTED`, `DONE`, ...
- `sourceDocument`: liên kết văn bản gốc nếu có.
- `assignedBy`, `assignedDepartment`, `assignedTo`, `assignmentHistory`.
- `startAt`, `endAt`, `dueAt`, `estimatedMinutes`, `actualMinutes`.
- `review`: lãnh đạo duyệt, trả lại hoặc chấm điểm.
- `ai`: đánh dấu task do AI gợi ý và lý do.

Mapping nghiệp vụ:
- `INVITATION`: dùng `startAt`, `endAt`, `location` để đổ vào Calendar.
- `DEADLINE`: bắt buộc có `dueAt`; có thể chia thời gian bằng nhiều `Timesheet.entries`.
- `DAILY`: không nhất thiết có văn bản gốc, dùng cho khai báo công việc phát sinh.

Index quan trọng:
- `{ assignedTo, startAt, endAt }` cho lịch cá nhân.
- `{ organization, status, dueAt }` cho việc quá hạn/gần hạn.
- `{ department, assignedTo, status }` cho dashboard lãnh đạo phòng.

### `timesheets`

Khai báo ngày của chuyên viên.

Trường chính:
- `user`, `organization`, `department`, `date`.
- `capacityMinutes`: mặc định `480`.
- `totalEstimatedMinutes`: có validator không vượt `capacityMinutes`.
- `entries`: từng block công việc trong ngày, có thể liên kết `task` hoặc là khai báo phát sinh.
- `status`: `DRAFT`, `SUBMITTED`, `APPROVED`, `RETURNED`.
- `reviewedBy`, `reviewedAt`, `reviewNote`.

Index quan trọng:
- `{ user, date }` unique để mỗi người chỉ có một timesheet/ngày.
- `{ department, date, status }` cho lãnh đạo phòng duyệt.

Ghi chú: Service layer nên tính lại `totalEstimatedMinutes` từ `entries` trước khi save để tránh client gửi sai tổng.

### `fileattachments`

Metadata file lưu ở MinIO.

Trường chính:
- `bucket`, `objectKey`, `fileName`, `contentType`, `sizeBytes`.
- `linkedModel`, `linkedId`: liên kết tới `IncomingDocument`, `Task`, hoặc `Timesheet`.
- `source`: nguồn upload/trích xuất.

Index quan trọng:
- `{ bucket, objectKey }` unique.
- `{ linkedModel, linkedId }`.

### `notifications`

Thông báo in-app/email/push.

Trường chính:
- `recipient`, `actor`, `type`.
- `relatedModel`, `relatedId`.
- `readAt`, `deliveredAt`.

Các type quan trọng:
- `TASK_ASSIGNED`, `DOCUMENT_UNASSIGNED`, `TASK_DUE_SOON`, `TASK_OVERDUE`, `REVIEW_REQUESTED`.

### `aijobs`

Theo dõi job AI/OCR để không khóa request chính.

Trường chính:
- `type`: `OCR_EXTRACT`, `TASK_SUGGESTION`, `SPELLCHECK`, `SUMMARY`.
- `status`: `QUEUED`, `PROCESSING`, `SUCCEEDED`, `FAILED`.
- `targetModel`, `targetId`, `input`, `output`, `errorMessage`.

### `auditlogs`

Lưu vết thao tác nhạy cảm.

Trường chính:
- `actor`, `action`, `entityModel`, `entityId`.
- `organization`, `department`.
- `metadata`, `ipAddress`, `userAgent`.

## Luồng dữ liệu mẫu

### VNPT extension tạo văn bản

1. Extension gửi số văn bản, trích yếu, hạn xử lý.
2. API tạo `IncomingDocument` với `source = VNPT_EXTENSION`, `status = RECEIVED`.
3. Chánh văn phòng gán phòng: cập nhật `currentDepartment`, `status = ASSIGNED_TO_DEPARTMENT`, `slaDueAt = now + 4 working hours`.
4. BullMQ quét `{ currentDepartment, status, slaDueAt }`; nếu quá hạn mà chưa có `currentAssignee`, tạo `Notification` type `DOCUMENT_UNASSIGNED`.

### Lãnh đạo phòng giao chuyên viên

1. Tạo hoặc cập nhật `Task` với `assignedDepartment`, `assignedTo`, `assignedBy`.
2. Cập nhật `IncomingDocument.status = ASSIGNED_TO_USER` và thêm `relatedTasks`.
3. Tạo `Notification` type `TASK_ASSIGNED` cho chuyên viên.

### Chuyên viên khai báo ngày

1. Client gửi `Timesheet.entries`.
2. Service tính tổng `estimatedMinutes`.
3. Nếu tổng lớn hơn `capacityMinutes`, trả lỗi nghiệp vụ.
4. Nếu hợp lệ, lưu `Timesheet` và cập nhật `Task.status` theo tiến độ.

### Hoàn thành và thẩm định

1. Chuyên viên chuyển `Task.status = PENDING_REVIEW`.
2. Lãnh đạo duyệt:
   - Đạt: `Task.status = DONE`, set `completedAt`, `review.result = APPROVED`.
   - Không đạt: `Task.status = REVISION_REQUESTED`, `review.result = RETURNED`.
3. Ghi `AuditLog` và tạo notification tương ứng.

## Các file model đã thêm

- `apps/api/src/models/role.model.ts`
- `apps/api/src/models/organization.model.ts`
- `apps/api/src/models/department.model.ts`
- `apps/api/src/models/user.model.ts`
- `apps/api/src/models/incoming-document.model.ts`
- `apps/api/src/models/task.model.ts`
- `apps/api/src/models/timesheet.model.ts`
- `apps/api/src/models/file-attachment.model.ts`
- `apps/api/src/models/notification.model.ts`
- `apps/api/src/models/ai-job.model.ts`
- `apps/api/src/models/audit-log.model.ts`
