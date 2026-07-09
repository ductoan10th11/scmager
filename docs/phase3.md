# Kế hoạch triển khai Giai đoạn 3: Hoàn thiện nghiệp vụ cốt lõi

## 1. Bối cảnh

Phase 2 đã đưa hệ thống vào được luồng nghiệp vụ chính:

```text
OFFICE_CHIEF
  -> tạo/tiếp nhận văn bản
  -> giao văn bản cho phòng

DEPARTMENT_LEADER
  -> nhận văn bản của phòng
  -> phân công một hoặc nhiều chuyên viên
  -> chọn file công việc giao riêng cho từng chuyên viên
  -> theo dõi tiến độ
  -> duyệt task hoàn thành
  -> hoàn thành văn bản khi mọi task hợp lệ đã xong

SPECIALIST
  -> xem nhiệm vụ được giao
  -> xem file quyết định và file công việc
  -> thực hiện task
  -> nộp trưởng phòng duyệt
```

Các nguyên tắc nghiệp vụ đã chốt và phải giữ nguyên:

- `OFFICE_CHIEF` chỉ giao văn bản cho phòng, không giao trực tiếp chuyên viên.
- `DEPARTMENT_LEADER` là người giao việc cho chuyên viên.
- `DEPARTMENT_LEADER` không upload file; chỉ chọn file `WORK` có sẵn để giao cho chuyên viên.
- File đính kèm tách rõ 2 loại:
  - `DECISION`: file quyết định/văn bản gốc.
  - `WORK`: file công việc để giao xử lý.
- File `WORK` phải được giao riêng cho từng chuyên viên, không giao chung.
- Specialist làm việc qua task, không khai báo thời gian xử lý lúc phân công.
- Timesheet tạm bỏ qua.
- VNPT Extension chưa triển khai ở Phase 3.
- AI/OCR và các tính năng AI chuyển sang Phase 4.

## 2. Mục tiêu Phase 3

Phase 3 tập trung làm hệ thống nghiệp vụ lõi đủ chắc để vận hành thật, không mở thêm hướng tích hợp lớn.

Mục tiêu chính:

1. Hoàn thiện trang chi tiết văn bản.
2. Chuẩn hóa xem/tải file trên toàn hệ thống.
3. Hoàn thiện thông báo trong hệ thống.
4. Bổ sung cảnh báo SLA, việc gần hạn và quá hạn.
5. Bổ sung audit trail cho văn bản/task.
6. Hoàn thiện dashboard theo vai trò bằng dữ liệu thật.
7. Bổ sung lọc nâng cao và báo cáo/export cơ bản.
8. Rà quyền, lỗi biên, UX và triển khai ổn định.

## 3. Ngoài phạm vi Phase 3

| Hạng mục | Ghi chú |
|---|---|
| Timesheet route/nav/UI | Đã chốt bỏ qua |
| VNPT Extension | Chưa cần đụng trong Phase 3 |
| AI/OCR/AI assistant | Chuyển sang Phase 4 |
| Chief giao thẳng chuyên viên | Trái nghiệp vụ mới |
| Dep lead upload file văn bản | Trái nghiệp vụ mới |
| Mobile app | Phase sau |
| Push notification Firebase/APNs | Phase sau; Phase 3 chỉ làm in-app notification |

## 4. Module 3.1 - Chi tiết văn bản

### 4.1 Mục tiêu

Người dùng cần một trang chi tiết văn bản để xem toàn bộ bối cảnh xử lý: văn bản, file, phòng được giao, chuyên viên đang xử lý, task liên quan, trạng thái hoàn thành và lịch sử.

### 4.2 Backend

Hoàn thiện `GET /api/incoming-documents/:id` để trả đủ dữ liệu:

- thông tin văn bản;
- phòng đang xử lý;
- danh sách chuyên viên được giao;
- file `DECISION`;
- file `WORK`;
- `relatedTasks`;
- `routingHistory`;
- trạng thái từng task con;
- thông tin file nào được giao cho chuyên viên nào.

Quyền truy cập:

| Role | Quyền |
|---|---|
| `ADMIN` | Xem tất cả |
| `OFFICE_CHIEF` | Xem văn bản trong tổ chức |
| `COMMUNE_LEADER` | Xem văn bản trong tổ chức |
| `DEPARTMENT_LEADER` | Chỉ xem văn bản của phòng mình |
| `SPECIALIST` | Chỉ xem văn bản có task/file liên quan đến mình |

### 4.3 Frontend

Tạo:

```text
apps/web/src/features/documents/DocumentDetailFeature.vue
apps/web/src/pages/DocumentDetailPage.vue
```

Route:

```text
/documents/:documentId
```

UI gồm:

- header: số văn bản, tiêu đề, trạng thái, hạn xử lý, ưu tiên;
- tổng quan văn bản;
- file quyết định;
- file công việc;
- phân công chuyên viên;
- tiến độ task;
- lịch sử xử lý;
- action theo quyền:
  - chief: giao/đổi phòng khi hợp lệ;
  - dep lead: giao/đổi phân công;
  - dep lead: hoàn thành văn bản khi task con đã `DONE`;
  - specialist: mở task của mình và xem/tải file liên quan.

### 4.4 Tiêu chí nghiệm thu

- Click văn bản từ danh sách mở được detail.
- Chief xem được lịch sử giao/đổi phòng.
- Dep lead thấy rõ chuyên viên nào đang xử lý file nào.
- Specialist chỉ thấy dữ liệu liên quan đến mình.
- Hoàn thành văn bản bị chặn nếu còn task chưa `DONE`.

## 5. Module 3.2 - Xem/tải file thống nhất

### 5.1 Mục tiêu

Mọi nơi có file phải có cùng hành vi: xem được nếu trình duyệt hỗ trợ, tải được nếu cần, và luôn kiểm quyền qua resource cha.

### 5.2 Backend

Chuẩn hóa endpoint:

```text
GET /api/incoming-documents/:id/attachments/:attachmentId/download
GET /api/tasks/:id/attachments/:attachmentId/download
GET /api/tasks/:id/source-attachments/:attachmentId/download
```

Yêu cầu:

- validate quyền theo văn bản/task;
- validate file thuộc đúng resource;
- hỗ trợ download mặc định;
- hỗ trợ preview bằng `?disposition=inline`;
- trả đúng `Content-Type`;
- không expose `objectKey` như public path.

### 5.3 Frontend

Tạo helper dùng chung:

```text
apps/web/src/shared/files/file-actions.js
```

Helper cần có:

- `viewFile(url)`;
- `downloadFile(url, fileName)`;
- `formatFileSize(bytes)`;
- `fileIconByContentType(contentType)`;

Áp dụng vào:

- danh sách/modal file văn bản;
- document detail;
- task detail.

### 5.4 Tiêu chí nghiệm thu

- PDF mở được ở tab mới.
- Word/Excel tải được.
- File không thuộc quyền trả lỗi, không tải được.
- Các màn hình hiển thị file nhất quán.

## 6. Module 3.3 - Thông báo trong hệ thống

### 6.1 Mục tiêu

Người dùng cần biết khi có việc mới, task chờ duyệt, task bị trả lại, văn bản có thể hoàn thành hoặc có việc quá hạn.

### 6.2 Loại thông báo

| Type | Người nhận | Khi tạo |
|---|---|---|
| `DOCUMENT_ASSIGNED_TO_DEPARTMENT` | Dep lead | Chief giao văn bản cho phòng |
| `DOCUMENT_REASSIGNED_DEPARTMENT` | Dep lead cũ và mới | Chief đổi phòng |
| `TASK_ASSIGNED` | Specialist | Dep lead giao task |
| `TASK_REASSIGNED` | Specialist cũ và mới | Dep lead đổi phân công |
| `TASK_SUBMITTED_REVIEW` | Dep lead | Specialist nộp duyệt |
| `TASK_REVISION_REQUESTED` | Specialist | Dep lead trả lại task |
| `TASK_APPROVED` | Specialist | Dep lead duyệt hoàn thành |
| `DOCUMENT_READY_TO_COMPLETE` | Dep lead | Mọi task con đã `DONE` |
| `TASK_DUE_SOON` | Specialist, dep lead | Task gần đến hạn |
| `TASK_OVERDUE` | Specialist, dep lead | Task quá hạn |
| `DOCUMENT_SLA_UNASSIGNED` | Office chief | Văn bản đã giao phòng nhưng chưa giao chuyên viên sau SLA |

### 6.3 Backend

Tạo module:

```text
apps/api/src/repositories/notification.repository.ts
apps/api/src/services/notification.service.ts
apps/api/src/controllers/notification.controller.ts
apps/api/src/routes/notification.route.ts
```

API:

```text
GET /api/notifications
GET /api/notifications/unread-count
PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all
```

Service helper:

```typescript
createNotification({
  recipient,
  type,
  title,
  message,
  entityModel,
  entityId,
  metadata,
})
```

Chống trùng:

- Với notification tự động như gần hạn/quá hạn/SLA, lưu `dedupeKey` trong metadata.
- Trước khi tạo notification tự động, kiểm tra đã có notification cùng `dedupeKey` trong ngày chưa.

### 6.4 Frontend

Hoàn thiện:

```text
apps/web/src/features/notifications/NotificationsFeature.vue
apps/web/src/pages/NotificationsPage.vue
```

UI:

- badge số chưa đọc ở nav hoặc header;
- danh sách thông báo;
- filter tất cả/chưa đọc;
- mark read;
- mark all read;
- click notification mở đúng văn bản/task.

### 6.5 Tiêu chí nghiệm thu

- Giao văn bản tạo notification cho dep lead.
- Giao task tạo notification cho specialist.
- Nộp duyệt tạo notification cho dep lead.
- Trả lại task tạo notification cho specialist.
- Notification gần hạn/quá hạn không bị spam trùng.

## 7. Module 3.4 - SLA và nhắc hạn

### 7.1 Mục tiêu

Hệ thống cần chủ động cảnh báo việc quá hạn, gần hạn, và văn bản bị treo ở bước chưa phân công.

### 7.2 Quy tắc

| Rule | Cảnh báo |
|---|---|
| Task còn <= 24h đến hạn và chưa `DONE` | `TASK_DUE_SOON` |
| Task quá hạn và chưa `DONE` | `TASK_OVERDUE` |
| Văn bản đã giao phòng nhưng chưa giao chuyên viên sau SLA | `DOCUMENT_SLA_UNASSIGNED` |
| Mọi task con đã `DONE` nhưng văn bản chưa complete | `DOCUMENT_READY_TO_COMPLETE` |

SLA mặc định:

```text
DOCUMENT_ASSIGN_USER_SLA_HOURS=4
```

### 7.3 Backend

Tạo scheduler nhẹ trong process hiện tại:

```text
apps/api/src/services/sla-monitor.service.ts
```

Chạy mỗi 5 phút:

- quét task gần hạn;
- quét task quá hạn;
- quét văn bản chưa phân công chuyên viên;
- quét văn bản sẵn sàng hoàn thành.

Chưa dùng BullMQ trong Phase 3 nếu chưa cần scale.

### 7.4 Frontend

Hiển thị cảnh báo ở:

- dashboard;
- task list;
- document list/detail;
- notifications.

### 7.5 Tiêu chí nghiệm thu

- Task quá hạn xuất hiện trong notification và dashboard.
- Văn bản đã giao phòng nhưng chưa phân công sau SLA được cảnh báo.
- Không tạo nhiều cảnh báo trùng cho cùng một sự kiện.

## 8. Module 3.5 - Audit trail

### 8.1 Mục tiêu

Audit log đã được ghi ở nhiều service. Phase 3 cần API/UI để xem lịch sử xử lý của văn bản và task.

### 8.2 Backend

Tạo:

```text
apps/api/src/repositories/audit-log.repository.ts
apps/api/src/services/audit-log.service.ts
apps/api/src/controllers/audit-log.controller.ts
apps/api/src/routes/audit-log.route.ts
```

API:

```text
GET /api/audit-logs
GET /api/audit-logs/entity/:entityModel/:entityId
```

Query:

| Param | Mô tả |
|---|---|
| `entityModel` | `IncomingDocument`, `Task`, ... |
| `entityId` | ID resource |
| `actorId` | Người thao tác |
| `departmentId` | Phòng ban |
| `action` | Loại hành động |
| `dateFrom`, `dateTo` | Khoảng ngày |
| `page`, `limit`, `sort` | Pagination |

Quyền:

- `ADMIN`: xem tất cả.
- `OFFICE_CHIEF`: xem trong tổ chức.
- `COMMUNE_LEADER`: xem trong tổ chức.
- `DEPARTMENT_LEADER`: xem log thuộc phòng mình hoặc resource phòng mình.
- `SPECIALIST`: chỉ xem log của task/văn bản liên quan đến mình.

Audit bổ sung cho action còn thiếu:

- upload attachment;
- delete attachment;
- update task schedule;
- create meeting;
- complete document;
- reopen/return assignment nếu sau này có.

### 8.3 Frontend

Tích hợp:

- document detail: tab `Lịch sử`;
- task detail: section `Lịch sử`;
- report/audit page cho lãnh đạo nếu cần.

Display:

- thời gian;
- người thao tác;
- hành động;
- ghi chú;
- metadata đã format dễ hiểu.

### 8.4 Tiêu chí nghiệm thu

- Giao phòng, giao chuyên viên, đổi phân công, nộp duyệt, duyệt task đều hiện trong lịch sử.
- Người ngoài quyền không xem được log.

## 9. Module 3.6 - Dashboard theo vai trò

### 9.1 Mục tiêu

Dashboard phải là màn hình điều hành thật, không chỉ là giao diện demo.

### 9.2 Backend

Tạo API tổng hợp:

```text
GET /api/dashboard/summary
GET /api/dashboard/workload
GET /api/dashboard/deadlines
```

Nội dung theo role:

#### OFFICE_CHIEF

- Văn bản mới.
- Văn bản chưa giao phòng.
- Văn bản đã giao phòng nhưng chưa giao chuyên viên.
- Văn bản quá hạn.
- Phòng có nhiều việc quá hạn.

#### COMMUNE_LEADER

- Tổng quan toàn cơ quan.
- Tiến độ theo phòng.
- Top văn bản/task quá hạn.
- Task chờ duyệt lâu.

#### DEPARTMENT_LEADER

- Văn bản phòng đang xử lý.
- Task chờ duyệt.
- Task quá hạn.
- Workload từng chuyên viên.
- Văn bản sẵn sàng hoàn thành.

#### SPECIALIST

- Task hôm nay.
- Task gần hạn.
- Task quá hạn.
- Task cần sửa.
- Lịch làm việc gần nhất.

### 9.3 Frontend

Hoàn thiện:

```text
apps/web/src/features/dashboard/DashboardFeature.vue
apps/web/src/features/dashboard/services/dashboard.service.js
```

Yêu cầu:

- card chỉ số theo role;
- danh sách ưu tiên xử lý;
- timeline hôm nay với task thật;
- click card/list mở đúng document/task;
- không hiển thị UI giả lập không có backend thật.

### 9.4 Tiêu chí nghiệm thu

- Mỗi role thấy dashboard phù hợp.
- Không còn số liệu mock trong chỉ số chính.
- Dashboard không lộ dữ liệu ngoài quyền.

## 10. Module 3.7 - Lọc nâng cao, báo cáo và export

### 10.1 Mục tiêu

Người quản lý cần lọc nhanh văn bản/task và xuất báo cáo tiến độ cơ bản.

### 10.2 Backend

Bổ sung filter cho document/task:

- `dateFrom`, `dateTo`;
- `dueFrom`, `dueTo`;
- `departmentId`;
- `assigneeId`;
- `status`;
- `priority`;
- `hasAttachments`;
- `attachmentCategory`;
- `completedFrom`, `completedTo`.

Endpoint report:

```text
GET /api/reports/documents
GET /api/reports/tasks
GET /api/reports/departments/:departmentId/progress
```

Export CSV:

```text
GET /api/reports/documents.csv
GET /api/reports/tasks.csv
```

Chỉ dùng CSV ở Phase 3, chưa thêm dependency Excel.

### 10.3 Frontend

- Bộ lọc nâng cao cho documents/tasks.
- Nút export CSV theo filter hiện tại.
- Trang report cho lãnh đạo:

```text
/reports
```

### 10.4 Tiêu chí nghiệm thu

- Lọc task theo người, phòng, trạng thái, khoảng hạn.
- Lọc văn bản theo phòng, trạng thái, hạn xử lý.
- Export CSV mở được bằng Excel/WPS.
- Report tuân thủ quyền.

## 11. Module 3.8 - Hardening UX và nghiệp vụ

### 11.1 Backend

- Rà lại tất cả service để business logic không nằm trong controller.
- Chuẩn hóa helper validate ObjectId/date.
- Chặn mọi update status trực tiếp bằng PATCH meta.
- Kiểm tra lại quyền của:
  - document detail;
  - task detail;
  - file download;
  - audit log;
  - notification;
  - report.
- Đảm bảo tất cả API list có pagination.
- Đảm bảo lỗi trả về envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

### 11.2 Frontend

- Không để action quan trọng chỉ hiện khi hover.
- Mọi table có loading/empty/error state.
- Modal responsive desktop/mobile.
- Button disabled khi đang submit.
- API error hiển thị rõ.
- Không còn mock data trong luồng chính.
- Văn bản dài/file name dài không làm vỡ layout.

### 11.3 Tiêu chí nghiệm thu

- Test responsive desktop/mobile cho các modal chính.
- Không có action nghiệp vụ bị ẩn.
- Không có lỗi text tràn phá layout.
- API lỗi được hiển thị cho người dùng.

## 12. Module 3.9 - Triển khai và vận hành

### 12.1 Nginx/domain

Rà:

- `ework.naot.me` trỏ đúng web.
- `/api` proxy đúng backend.
- body size đủ upload 20MB/file.
- preview/download file không bị 404.
- refresh route SPA không 404.

### 12.2 Healthcheck

Tối thiểu:

```text
GET /api/ping
```

Kiểm thêm:

- API kết nối Mongo.
- upload directory tồn tại.
- web build phục vụ đúng domain.

### 12.3 Backup

Chuẩn bị:

- backup MongoDB;
- backup upload directory/MinIO data nếu dùng;
- tài liệu restore cơ bản.

### 12.4 Tiêu chí nghiệm thu

- Domain production truy cập ổn định.
- Upload/download file qua domain thật ổn định.
- Refresh trực tiếp `/tasks/:id` và `/documents/:id` không 404.
- Có hướng dẫn backup/restore tối thiểu.

## 13. Thứ tự triển khai

### Sprint 3.1 - Document detail và file

1. Tạo document detail page.
2. Thêm route `/documents/:documentId`.
3. Thêm endpoint xem/tải attachment của văn bản.
4. Chuẩn hóa helper file frontend.
5. Áp dụng helper file vào document/task.

Kết quả: xem được hồ sơ văn bản đầy đủ, file hoạt động đúng quyền.

### Sprint 3.2 - Notification cơ bản

1. Tạo notification API.
2. Tạo notification khi giao phòng.
3. Tạo notification khi giao task.
4. Tạo notification khi nộp duyệt/trả lại/duyệt task.
5. Hoàn thiện page notification và unread count.

Kết quả: người dùng biết ngay việc mới và việc cần xử lý.

### Sprint 3.3 - SLA và cảnh báo hạn

1. Tạo SLA monitor service.
2. Cảnh báo task gần hạn/quá hạn.
3. Cảnh báo văn bản chưa phân công sau SLA.
4. Cảnh báo văn bản sẵn sàng hoàn thành.
5. Chống notification trùng.

Kết quả: hệ thống chủ động nhắc việc quan trọng.

### Sprint 3.4 - Audit trail

1. Tạo audit log API.
2. Tích hợp lịch sử vào document detail.
3. Tích hợp lịch sử vào task detail.
4. Bổ sung audit cho action còn thiếu.

Kết quả: truy vết được toàn bộ quá trình xử lý.

### Sprint 3.5 - Dashboard và report

1. Tạo dashboard summary API theo role.
2. Refactor dashboard dùng dữ liệu thật.
3. Bổ sung filter nâng cao.
4. Tạo report/export CSV.

Kết quả: lãnh đạo có màn hình điều hành và báo cáo cơ bản.

### Sprint 3.6 - Hardening và UAT

1. Test ma trận role.
2. Test workflow chief -> dep lead -> specialist -> dep lead.
3. Test upload/download 20MB.
4. Test responsive các modal chính.
5. Rà nginx/domain/SPA refresh.
6. Fix lỗi UAT.

Kết quả: Phase 3 sẵn sàng dùng thử rộng hơn.

## 14. Checklist nghiệm thu Phase 3

### Văn bản

- [ ] Có trang detail văn bản.
- [ ] Xem được file `DECISION`.
- [ ] Xem được file `WORK`.
- [ ] Biết file công việc nào giao cho chuyên viên nào.
- [ ] Dep lead chỉ hoàn thành văn bản khi task con đã `DONE`.
- [ ] Specialist không xem được văn bản/file không liên quan.

### Task

- [ ] Task detail hiển thị đủ file, lịch làm và lịch sử.
- [ ] Dep lead xem workload chuyên viên.
- [ ] Kéo/thay đổi lịch task vẫn lưu bền vững.
- [ ] Task quá hạn/gần hạn có cảnh báo.

### Notification/SLA

- [ ] Có unread count.
- [ ] Có danh sách notification.
- [ ] Click notification mở đúng resource.
- [ ] Không tạo notification trùng.
- [ ] Văn bản treo phân công được cảnh báo.

### Audit

- [ ] Mọi action chính có log.
- [ ] Document detail có lịch sử.
- [ ] Task detail có lịch sử.
- [ ] Log tuân thủ quyền.

### Dashboard/report

- [ ] Dashboard theo role.
- [ ] Không còn mock data trong chỉ số chính.
- [ ] Export CSV theo filter.
- [ ] Report không lộ dữ liệu ngoài quyền.

### Vận hành

- [ ] `/api/ping` OK.
- [ ] Domain `ework.naot.me` OK.
- [ ] Upload file 20MB OK.
- [ ] Preview/download file OK.
- [ ] Refresh route SPA không 404.
- [ ] Có phương án backup Mongo/upload data.

## 15. Rủi ro cần kiểm soát

| Rủi ro | Cách kiểm soát |
|---|---|
| Sai quyền xem file | Mọi download validate qua resource cha |
| Sai quyền xem document detail | Test matrix theo role và department |
| Notification spam | Dùng `dedupeKey` |
| Dashboard chậm | Aggregate theo role, thêm index nếu cần |
| Report lộ dữ liệu | Tái sử dụng scope filter theo role |
| Nginx 404 khi refresh route | Cấu hình SPA fallback |
| Upload fail do body size | Rà `client_max_body_size` |

## 16. Definition of Done

Phase 3 hoàn thành khi:

1. Người dùng xử lý được trọn vòng đời văn bản từ detail page.
2. File quyết định/file công việc xem và tải được theo đúng quyền.
3. Người dùng nhận notification cho việc cần xử lý.
4. SLA/gần hạn/quá hạn được cảnh báo.
5. Lãnh đạo xem được audit trail và dashboard dữ liệu thật.
6. Báo cáo/export CSV cơ bản hoạt động.
7. Domain production hoạt động ổn định.
8. Frontend build và backend typecheck pass.
9. UAT theo role không phát hiện lỗi chặn nghiệp vụ.
