# Changelog

Ghi lại các thay đổi đáng chú ý của eWork. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/). Mục mới nhất đặt trên cùng.

## [2026-11-25] Loại bỏ nhiệm vụ và page Nhiệm vụ đã bỏ

Spec: `_bmad-output/implementation-artifacts/spec-office-document-discard.md`

### Thêm mới
- Nút **Loại bỏ** trong modal chi tiết nhiệm vụ (page Văn bản, tab Nhiệm vụ).
  - Lãnh đạo (Trưởng phòng của người làm, Chánh văn phòng, Lãnh đạo xã, Admin) loại bỏ ngay, bắt buộc nhập lý do. Nhiệm vụ không tính KPI và người làm nhận thông báo.
  - Chuyên viên phụ trách bấm **Loại bỏ** thì gửi đề nghị cho lãnh đạo duyệt (luồng "việc không cần làm" cũ).
- Page **KPI → Nhiệm vụ đã bỏ** (`/discarded-tasks`) liệt kê các nhiệm vụ đã loại bỏ, cùng giao diện, bộ lọc và chi tiết với page Văn bản. Lãnh đạo khôi phục từ panel trong chi tiết.
- API `POST /api/office-document-contexts/:id/not-required/discard` (body `{ reason }`). Trả 403 khi không đủ quyền, 400 khi thiếu hoặc quá dài lý do hay không phải văn bản đến, 409 khi đang chờ duyệt, đã bỏ hoặc đã có kết quả.
- Lịch sử loại bỏ có thêm hành động `DISCARDED`.
- Không loại bỏ được nhiệm vụ đang có khiếu nại điểm chờ duyệt (409).
- Khi khôi phục một nhiệm vụ do lãnh đạo loại bỏ trực tiếp, người làm nhận thông báo (luồng cũ chỉ báo cho người đề nghị).

### Thay đổi
- `GET /api/office-document-contexts` mặc định không trả về nhiệm vụ đã loại bỏ (`notRequired.status = CONFIRMED`). Muốn xem thì truyền `notRequiredState=CONFIRMED`. Danh sách nhiệm vụ trong side panel extension vì vậy cũng không còn hiện các việc đã bỏ (báo cáo quá hạn vốn đã loại chúng từ trước).
- Page Văn bản bỏ chip lọc "Không cần làm" (đã chuyển sang page Nhiệm vụ đã bỏ) và giữ chip "Chờ xem xét".
- Đổi nhãn: "Chuyển lại lãnh đạo (việc không cần làm)" thành "Loại bỏ"; "Đã xác nhận không cần làm" thành "Đã loại bỏ".
- Ẩn nút "Khai báo việc" và "Thêm sản phẩm" với nhiệm vụ đã loại bỏ (API vốn đã chặn). Page Nhiệm vụ đã bỏ ẩn chip lọc theo hạn xử lý (việc đã bỏ không còn tính hạn).
- Thông báo: đổi nhãn "Việc không cần làm" thành "Nhiệm vụ đã loại bỏ" (icon cấm, màu xám).
