# Kế hoạch triển khai Giai đoạn 2: Nghiệp vụ cốt lõi (Business Logic)

## 1. Tình trạng hệ thống hiện tại (Phase 1 hoàn thành)

| Hạng mục | Trạng thái |
|---|---|
| Models (`IncomingDocument`, `Task`, `Timesheet`, `AuditLog`, `FileAttachment`, `Notification`...) | ✅ Hoàn thành |
| Enums (`DOCUMENT_STATUSES`, `TASK_STATUSES`, `TIMESHEET_STATUSES`...) | ✅ Hoàn thành |
| Routes/Controllers/Services: `auth`, `users`, `organizations`, `departments` | ✅ Hoàn thành |
| RBAC Middleware (`requireAuth`) — xác thực JWT qua cookie | ✅ Hoàn thành |
| Frontend pages: Login, Organizations, Departments, Users | ✅ Hoàn thành |
| **Services Phase 2**: `incoming-document`, `task`, `timesheet` | ❌ Chưa có |
| **Routes Phase 2**: `/api/incoming-documents`, `/api/tasks`, `/api/timesheets` | ❌ Chưa có |
| **Frontend Features**: `IncomingDocumentFeature`, `TimesheetFeature` | ❌ Thư mục trống |

---

## 2. Mục tiêu Giai đoạn 2

Luồng nghiệp vụ chính:

```
Văn bản đến (OFFICE_CHIEF)
  → Giao phòng ban (OFFICE_CHIEF)
    → Giao chuyên viên (DEPARTMENT_LEADER)
      → Thực hiện & khai báo giờ (SPECIALIST)
        → Duyệt timesheet (DEPARTMENT_LEADER)
```

---

## 3. Quy ước chung (áp dụng toàn Phase 2)

### 3.1 Response envelope

```json
// Thành công - danh sách
{
  "data": [...],
  "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
}

// Thành công - đơn lẻ
{ "data": { ...resource } }

// Lỗi
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

### 3.2 Pagination query params (chuẩn cho mọi API danh sách)

| Param | Mặc định | Mô tả |
|---|---|---|
| `page` | `1` | Trang hiện tại |
| `limit` | `20` | Số bản ghi/trang (max 100) |
| `sort` | `-createdAt` | Field sort, prefix `-` = DESC |

### 3.3 RBAC Roles

| Code | Tên | Cấp |
|---|---|---|
| `ADMIN` | Quản trị hệ thống | 0 |
| `OFFICE_CHIEF` | Chánh văn phòng | 1 |
| `COMMUNE_LEADER` | Lãnh đạo cơ quan | 2 |
| `DEPARTMENT_LEADER` | Lãnh đạo phòng ban | 3 |
| `SPECIALIST` | Chuyên viên | 4 |

### 3.4 Upload file (multer)

- **Storage**: disk local, thư mục `uploads/` (cấu hình qua env `UPLOAD_DIR`)
- **Allowed types**: `application/pdf`, `image/*`, `application/msword`, `application/vnd.openxmlformats-officedocument.*`
- **Max size**: `20MB` mỗi file
- **Max files/request**: `10`
- **Field name**: `files` (array)
- Sau khi lưu disk, tạo document `FileAttachment` với `{ bucket: 'local', objectKey: <relative path> }`

### 3.5 Audit Log pattern

Mọi hành động cốt lõi (tạo, assign, đổi trạng thái) ghi 1 bản ghi `AuditLog`:

```typescript
// Gọi trong service, KHÔNG gọi trong controller
await AuditLogModel.create({
  actor: currentUser.id,
  action: 'DOCUMENT_ASSIGNED',   // SCREAMING_SNAKE, mô tả hành động
  entityModel: 'IncomingDocument',
  entityId: document._id,
  organization: document.organization,
  department: document.currentDepartment,
  metadata: { oldStatus, newStatus, targetDepartmentId },
});
```

---

## 4. Giai đoạn 2.1 — Incoming Documents (Tiếp nhận văn bản)

### 4.1 RBAC Matrix

| Endpoint | OFFICE_CHIEF | COMMUNE_LEADER | DEPARTMENT_LEADER | SPECIALIST |
|---|---|---|---|---|
| `POST /` (tạo văn bản) | ✅ | ❌ | ❌ | ❌ |
| `GET /` (danh sách) | ✅ | ✅ | ✅ (chỉ phòng mình) | ✅ (chỉ được giao) |
| `GET /:id` (chi tiết) | ✅ | ✅ | ✅ (phòng mình) | ✅ (được giao) |
| `PATCH /:id` (cập nhật meta) | ✅ | ❌ | ❌ | ❌ |
| `POST /:id/assign-department` | ✅ | ❌ | ❌ | ❌ |
| `POST /:id/assign-user` | ✅ | ❌ | ✅ (phòng mình) | ❌ |
| `POST /:id/complete` | ✅ | ❌ | ✅ (phòng mình) | ✅ (được giao) |
| `POST /:id/attachments` (upload) | ✅ | ❌ | ✅ (phòng mình) | ✅ (được giao) |

### 4.2 API Contracts

```
Base: /api/incoming-documents
Auth: requireAuth (mọi route)
```

#### `POST /api/incoming-documents`
**Roles**: `OFFICE_CHIEF`

Request body:
```json
{
  "documentNumber": "VB-2026-001",
  "title": "Kế hoạch triển khai hạ tầng",
  "summary": "...",
  "sender": "Bộ Thông tin và Truyền thông",
  "category": "Hành chính",
  "priority": "HIGH",
  "source": "MANUAL",
  "dueAt": "2026-07-20T17:00:00Z",
  "issuedAt": "2026-07-01T00:00:00Z"
}
```

Response `201`:
```json
{ "data": { "_id": "...", "status": "DRAFT", ...document } }
```

---

#### `GET /api/incoming-documents`
**Roles**: Tất cả (filter theo role tự động trong service)

Query params:
| Param | Type | Mô tả |
|---|---|---|
| `status` | string | Filter theo status |
| `priority` | string | Filter theo priority |
| `departmentId` | ObjectId | Filter theo phòng ban |
| `search` | string | Fulltext search title |
| `page`, `limit`, `sort` | - | Pagination chuẩn |

Response `200`: Response envelope danh sách.

---

#### `GET /api/incoming-documents/:id`
**Roles**: Tất cả (service check quyền xem)

Response `200`:
```json
{
  "data": {
    "_id": "...",
    "title": "...",
    "status": "ASSIGNED_TO_DEPARTMENT",
    "currentDepartment": { "_id": "...", "name": "..." },
    "currentAssignee": { "_id": "...", "fullName": "..." },
    "attachments": [...],
    "routingHistory": [...]
  }
}
```

---

#### `PATCH /api/incoming-documents/:id`
**Roles**: `OFFICE_CHIEF`

Chỉ update các field meta (title, summary, priority, dueAt...), **không** dùng để đổi status.

---

#### `POST /api/incoming-documents/:id/assign-department`
**Roles**: `OFFICE_CHIEF`

Request body:
```json
{ "departmentId": "...", "note": "Phòng CNTT xử lý" }
```

Logic service:
1. Validate `status` phải là `DRAFT` hoặc `RECEIVED`
2. Cập nhật `status → ASSIGNED_TO_DEPARTMENT`, `currentDepartment`
3. Push `routingHistory` với `action: ASSIGN_DEPARTMENT`
4. Ghi `AuditLog` action `DOCUMENT_ASSIGNED_TO_DEPARTMENT`

Response `200`: document đã cập nhật.

---

#### `POST /api/incoming-documents/:id/assign-user`
**Roles**: `OFFICE_CHIEF`, `DEPARTMENT_LEADER`

Request body:
```json
{ "userId": "...", "note": "Anh A phụ trách" }
```

Logic service:
1. `DEPARTMENT_LEADER` chỉ được assign user trong phòng mình
2. Validate `status` phải là `ASSIGNED_TO_DEPARTMENT`
3. Cập nhật `status → ASSIGNED_TO_USER`, `currentAssignee`
4. Push `routingHistory` với `action: ASSIGN_USER`
5. Ghi `AuditLog` action `DOCUMENT_ASSIGNED_TO_USER`

Response `200`: document đã cập nhật.

---

#### `POST /api/incoming-documents/:id/complete`
**Roles**: `OFFICE_CHIEF`, `DEPARTMENT_LEADER`, `SPECIALIST`

Logic service:
1. `SPECIALIST` chỉ được complete nếu `currentAssignee === currentUser.id`
2. Validate `status` phải là `IN_PROGRESS` hoặc `ASSIGNED_TO_USER`
3. Cập nhật `status → COMPLETED`, `completedAt`
4. Ghi `AuditLog` action `DOCUMENT_COMPLETED`

---

#### `POST /api/incoming-documents/:id/attachments`
**Roles**: `OFFICE_CHIEF`, `DEPARTMENT_LEADER`, `SPECIALIST`
**Content-Type**: `multipart/form-data`

Field: `files` (array, max 10 files, max 20MB/file)

Logic service:
1. Lưu file vào disk qua multer
2. Tạo `FileAttachment` documents với `linkedModel: 'IncomingDocument'`
3. Push IDs vào `document.attachments`

Response `200`: `{ "data": { "attachments": [...FileAttachment] } }`

---

### 4.3 Files cần tạo (Backend 2.1)

```
apps/api/src/
  repositories/incoming-document.repository.ts
  services/incoming-document.service.ts
  controllers/incoming-document.controller.ts
  routes/incoming-document.route.ts
  utils/upload.ts   ← multer config dùng chung
```

Đăng ký trong `api.route.ts`:
```typescript
router.use('/incoming-documents', incomingDocumentRoutes)
```

### 4.4 Files cần tạo (Frontend 2.1)

```
apps/web/src/
  features/documents/
    IncomingDocumentFeature.vue   ← danh sách + filter + modal assign
  pages/DocumentsPage.vue          ← tích hợp Feature vào page
```

---

## 5. Giai đoạn 2.2 — Tasks & Assignments (Giao việc)

### 5.1 RBAC Matrix

| Endpoint | OFFICE_CHIEF | COMMUNE_LEADER | DEPARTMENT_LEADER | SPECIALIST |
|---|---|---|---|---|
| `POST /` (tạo task) | ✅ | ✅ | ✅ | ❌ |
| `GET /` (danh sách) | ✅ | ✅ | ✅ (phòng mình) | ✅ (của mình) |
| `GET /:id` | ✅ | ✅ | ✅ (phòng mình) | ✅ (của mình) |
| `PATCH /:id` (update meta) | ✅ | ✅ | ✅ (tạo bởi mình) | ❌ |
| `POST /:id/assign` | ✅ | ✅ | ✅ (phòng mình) | ❌ |
| `POST /:id/start` | ❌ | ❌ | ❌ | ✅ (của mình) |
| `POST /:id/submit-review` | ❌ | ❌ | ❌ | ✅ (của mình) |
| `POST /:id/review` (duyệt/trả) | ✅ | ✅ | ✅ (phòng mình) | ❌ |
| `POST /:id/cancel` | ✅ | ✅ | ✅ (tạo bởi mình) | ❌ |

### 5.2 API Contracts

```
Base: /api/tasks
Auth: requireAuth (mọi route)
```

#### `POST /api/tasks`
**Roles**: `OFFICE_CHIEF`, `COMMUNE_LEADER`, `DEPARTMENT_LEADER`

Request body:
```json
{
  "title": "Soạn thảo báo cáo quý 3",
  "description": "...",
  "type": "DEADLINE",
  "priority": "HIGH",
  "departmentId": "...",
  "assignedToUserId": "...",
  "sourceDocumentId": "...",
  "dueAt": "2026-07-25T17:00:00Z",
  "estimatedMinutes": 480
}
```

Logic service:
- `assignedBy` = `currentUser.id` (tự động)
- Nếu có `assignedToUserId` → `status = TODO`, ghi `assignmentHistory`
- Nếu không → `status = DRAFT`
- `DEPARTMENT_LEADER` chỉ được assign user trong phòng mình
- Ghi `AuditLog` action `TASK_CREATED`

---

#### `POST /api/tasks/:id/assign`
**Roles**: `OFFICE_CHIEF`, `COMMUNE_LEADER`, `DEPARTMENT_LEADER`

Request body:
```json
{ "userId": "...", "departmentId": "...", "note": "..." }
```

Logic service:
1. Validate không thể assign task đã `DONE` hoặc `CANCELLED`
2. Cập nhật `assignedTo`, `assignedDepartment`, `assignedAt`
3. Push `assignmentHistory`
4. `status → TODO` nếu đang là `DRAFT`
5. Ghi `AuditLog` action `TASK_ASSIGNED`

---

#### `POST /api/tasks/:id/start`
**Roles**: `SPECIALIST` (chỉ task `assignedTo === currentUser.id`)

Logic: `status: TODO → IN_PROGRESS`, set `startAt = now`

---

#### `POST /api/tasks/:id/submit-review`
**Roles**: `SPECIALIST`

Request body: `{ "note": "Đã hoàn thành theo yêu cầu" }`

Logic:
1. Validate `status === IN_PROGRESS`
2. `status → PENDING_REVIEW`
3. Set `review.submittedAt = now`, `review.result = PENDING`
4. Ghi `AuditLog` action `TASK_REVIEW_SUBMITTED`

---

#### `POST /api/tasks/:id/review`
**Roles**: `OFFICE_CHIEF`, `COMMUNE_LEADER`, `DEPARTMENT_LEADER`

Request body:
```json
{ "result": "APPROVED", "note": "Tốt", "score": 90 }
```
hoặc:
```json
{ "result": "RETURNED", "note": "Cần bổ sung mục 3.2" }
```

Logic:
- `APPROVED` → `status = DONE`, `completedAt = now`
- `RETURNED` → `status = REVISION_REQUESTED`
- Cập nhật `review.reviewedBy`, `review.reviewedAt`, `review.result`, `review.note`, `review.score`
- Ghi `AuditLog` action `TASK_REVIEWED`

---

#### `GET /api/tasks`

Query params bổ sung (ngoài pagination chuẩn):

| Param | Mô tả |
|---|---|
| `status` | Filter status |
| `type` | `INVITATION`, `DEADLINE`, `DAILY` |
| `priority` | Filter priority |
| `departmentId` | Filter phòng ban |
| `assignedToMe` | `true` → chỉ lấy task của currentUser |
| `overdue` | `true` → `dueAt < now AND status NOT IN [DONE, CANCELLED]` |
| `search` | Fulltext search title |

**UI validation bắt buộc**: Frontend hiển thị badge đỏ / cảnh báo nếu `dueAt < now`.

---

### 5.3 Files cần tạo (Backend 2.2)

```
apps/api/src/
  repositories/task.repository.ts
  services/task.service.ts
  controllers/task.controller.ts
  routes/task.route.ts
```

Đăng ký: `router.use('/tasks', taskRoutes)`

### 5.4 Files cần tạo (Frontend 2.2)

```
apps/web/src/
  features/tasks/TasksFeature.vue          ← danh sách + filter + badge overdue
  features/assignments/                    ← AssignmentFeature.vue đã có, kết nối API thật
  pages/TasksPage.vue                      ← tích hợp Feature
```

> ⚠️ `AssignmentFeature.vue` hiện có (~42KB mock data). Cần refactor kết nối API thật thay vì viết lại.

---

## 6. Giai đoạn 2.3 — Timesheets (Khai báo giờ)

### 6.1 Business Rules (chốt chặn tại Backend)

| Rule | HTTP Error khi vi phạm |
|---|---|
| Mỗi `TimeEntry.estimatedMinutes >= 15` | `400 VALIDATION_ERROR` |
| Tổng `estimatedMinutes` trong ngày `<= capacityMinutes` (mặc định 480) | `400 VALIDATION_ERROR` |
| Không thể submit timesheet đã `APPROVED` | `409 CONFLICT` |
| Chỉ `SPECIALIST` tạo/sửa timesheet của chính mình | `403 FORBIDDEN` |

### 6.2 RBAC Matrix

| Endpoint | DEPARTMENT_LEADER | SPECIALIST |
|---|---|---|
| `GET /my` (timesheet của mình theo ngày) | ❌ | ✅ |
| `GET /department` (timesheet cả phòng) | ✅ | ❌ |
| `POST /` (tạo/upsert theo ngày) | ❌ | ✅ |
| `POST /:id/entries` (thêm entry) | ❌ | ✅ (của mình) |
| `DELETE /:id/entries/:entryId` | ❌ | ✅ (DRAFT only) |
| `POST /:id/submit` | ❌ | ✅ (của mình) |
| `POST /:id/review` (APPROVE/RETURN) | ✅ (phòng mình) | ❌ |

### 6.3 API Contracts

```
Base: /api/timesheets
Auth: requireAuth (mọi route)
```

#### `POST /api/timesheets`
**Roles**: `SPECIALIST`

Upsert theo `(user, date)` — nếu đã có thì trả về bản hiện tại.

Request body:
```json
{ "date": "2026-07-08" }
```

Response `200 | 201`: document timesheet.

---

#### `POST /api/timesheets/:id/entries`
**Roles**: `SPECIALIST`

Request body:
```json
{
  "taskId": "...",
  "title": "Soạn thảo báo cáo",
  "note": "Hoàn thành phần 1 và 2",
  "estimatedMinutes": 120
}
```

Logic service:
1. Validate `estimatedMinutes >= 15` → `400` nếu vi phạm
2. Tính tổng mới: `currentTotal + estimatedMinutes <= capacityMinutes` → `400` nếu vượt
3. Push vào `entries`, cập nhật `totalEstimatedMinutes`
4. Ghi `AuditLog` action `TIMESHEET_ENTRY_ADDED`

Response `200`: timesheet đã cập nhật.

---

#### `DELETE /api/timesheets/:id/entries/:entryId`
**Roles**: `SPECIALIST`

Logic:
1. Validate `timesheet.status === DRAFT`
2. Pull entry khỏi mảng, giảm `totalEstimatedMinutes`

---

#### `POST /api/timesheets/:id/submit`
**Roles**: `SPECIALIST`

Logic:
1. Validate `status === DRAFT` và `entries.length > 0`
2. `status → SUBMITTED`, `submittedAt = now`
3. Ghi `AuditLog` action `TIMESHEET_SUBMITTED`

---

#### `POST /api/timesheets/:id/review`
**Roles**: `DEPARTMENT_LEADER`

Request body: `{ "result": "APPROVED" }` hoặc `{ "result": "RETURNED", "note": "..." }`

Logic:
1. Validate `status === SUBMITTED`
2. `APPROVED` → `status = APPROVED`; `RETURNED` → `status = RETURNED`
3. Set `reviewedBy`, `reviewedAt`, `reviewNote`
4. Ghi `AuditLog` action `TIMESHEET_REVIEWED`

---

#### `GET /api/timesheets/my`
**Roles**: `SPECIALIST`

Query: `?date=2026-07-08` (bắt buộc)

Response: timesheet của ngày đó (hoặc `null` nếu chưa tạo).

---

#### `GET /api/timesheets/department`
**Roles**: `DEPARTMENT_LEADER`

Query: `?date=2026-07-08&status=SUBMITTED` (lọc để duyệt hàng loạt)

---

### 6.4 Files cần tạo (Backend 2.3)

```
apps/api/src/
  repositories/timesheet.repository.ts
  services/timesheet.service.ts
  controllers/timesheet.controller.ts
  routes/timesheet.route.ts
```

Đăng ký: `router.use('/timesheets', timesheetRoutes)`

### 6.5 Files cần tạo (Frontend 2.3)

```
apps/web/src/
  features/timesheets/
    TimesheetFeature.vue   ← form nhập giờ + progress bar + submit
  pages/TimesheetsPage.vue
```

**UX bắt buộc**:
- Progress bar hiển thị `totalEstimatedMinutes / capacityMinutes` (VD: 6h/8h)
- Cảnh báo inline đỏ nếu `< 15p` hoặc tổng `> 8h` — **validation UX, backend vẫn là chốt chặn**

---

## 7. Tuân thủ Rule

- **API**: Chuẩn RESTful, `Controller → Service → Repository → Model`
- **Security**: `requireAuth` + role check trong service, không để controller xử lý business logic
- **Frontend**: Dùng Shadcn components, `@vueuse/motion`, Lucide icons; phân tầng `Component → Feature → Layout → Page`
- **Lazy Senior Dev**: Không thêm Redis/MQ, không thêm dependency mới; multer đã đủ cho upload đồng bộ
- **Buttons**: Bo tròn góc; trạng thái boolean dùng Switch component
- **Logic tính toán**: 100% tại backend; frontend chỉ nhận, hiển thị và validate UX

---

## 8. Thứ tự triển khai đề xuất

```
2.1 Backend  → 2.1 Frontend  → Test
2.2 Backend  → 2.2 Frontend  → Test
2.3 Backend  → 2.3 Frontend  → Test
```

Bắt đầu: **Sprint 2.1 Backend** — `incoming-document.repository.ts`, `service`, `controller`, `route`.
