# Extension API

Base URL production hiện tại:

```text
https://ework.naot.me/api
```

Extension cần khai báo host permission cho domain API và luôn gọi `fetch` với:

```js
credentials: "include";
```

Auth dùng cookie HttpOnly tên `scmager_session`, extension không đọc trực tiếp cookie này. Browser sẽ tự gửi cookie nếu request cùng domain/host permission hợp lệ.

## Auth

### Đăng nhập

```http
POST /api/auth/me
Content-Type: application/json
```

Body:

```json
{
  "login": "pvtuyen",
  "password": "0",
  "remember": true
}
```

`login` có thể là username hoặc email.

- Có thể sử dụng Object keys window: "user_id" để có thể lấy được user_id từ trang eoffice và điền tự động vào input username

Ví dụ:

```js
export async function login(login, password) {
  const res = await fetch("https://ework.naot.me/api/auth/me", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password, remember: true }),
  });

  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return res.json();
}
```

Response `200`:

```json
{
  "data": {
    "user": {
      "_id": "user_id",
      "username": "pvtuyen",
      "fullName": "Phạm Văn Tuyển",
      "position": "Trưởng phòng",
      "email": "pvtuyen@langson.gov.vn",
      "role": {
        "_id": "role_id",
        "code": "DEPARTMENT_LEADER",
        "name": "Lãnh đạo phòng",
        "level": 3
      },
      "organization": {},
      "department": {},
      "status": "ACTIVE"
    },
    "expiresAt": "2026-07-28T00:00:00.000Z"
  }
}
```

### Kiểm tra phiên hiện tại

```http
GET /api/auth/me
```

Ví dụ:

```js
export async function getMe() {
  const res = await fetch("https://ework.naot.me/api/auth/me", {
    credentials: "include",
  });

  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Get me failed: ${res.status}`);
  return res.json();
}
```

Response `200`:

```json
{
  "data": {
    "authenticated": true,
    "user": {}
  }
}
```

### Đăng xuất

```http
DELETE /api/auth/me
```

Ví dụ:

```js
export async function logout() {
  const res = await fetch("https://ework.naot.me/api/auth/me", {
    method: "DELETE",
    credentials: "include",
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Logout failed: ${res.status}`);
  }
}
```

Response thành công: `204 No Content`.

## Tổng Quan Cho Extension

### Lấy overview task + ingest

```http
GET /api/extension/overview?limit=5
```

Query:

| Tên     | Mặc định | Ghi chú                                                                                    |
| ------- | -------- | ------------------------------------------------------------------------------------------ |
| `limit` | `5`      | Số item gần nhất trả về trong `tasks.items` và `ingestDocuments.items`. Min `0`, max `20`. |

Phân quyền:

- Bắt buộc đã đăng nhập.
- `tasks.summary` và `tasks.items` được lọc theo quyền hiện tại:
  - `ADMIN`: toàn hệ thống.
  - `OFFICE_CHIEF`, `COMMUNE_LEADER`: trong tổ chức.
  - `DEPARTMENT_LEADER`: trong phòng ban phụ trách.
  - `SPECIALIST`: task được giao cho chính user.
- `ingestDocuments` là tổng quan dữ liệu ingest Lạng Sơn hiện có trong hệ thống.

Ví dụ:

```js
export async function getExtensionOverview(limit = 5) {
  const url = new URL("https://ework.naot.me/api/extension/overview");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, {
    credentials: "include",
  });

  if (res.status === 401) return { authenticated: false };
  if (!res.ok) throw new Error(`Overview failed: ${res.status}`);

  const payload = await res.json();
  return { authenticated: true, ...payload.data };
}
```

Response `200`:

```json
{
  "data": {
    "serverTime": "2026-07-14T00:00:00.000Z",
    "user": {
      "id": "user_id",
      "username": "pvtuyen",
      "fullName": "Phạm Văn Tuyển",
      "position": "Trưởng phòng",
      "email": "pvtuyen@langson.gov.vn",
      "role": {
        "id": "role_id",
        "code": "DEPARTMENT_LEADER",
        "name": "Lãnh đạo phòng",
        "level": 3
      },
      "organization": "organization_id",
      "department": "department_id",
      "status": "ACTIVE"
    },
    "tasks": {
      "summary": {
        "total": 12,
        "todo": 3,
        "inProgress": 4,
        "pendingReview": 1,
        "revisionRequested": 0,
        "done": 4,
        "overdue": 2,
        "dueSoon": 1,
        "today": 2
      },
      "items": [
        {
          "id": "task_id",
          "title": "Tham mưu xử lý văn bản",
          "type": "DEADLINE",
          "status": "TODO",
          "priority": "HIGH",
          "dueAt": "2026-07-14T10:00:00.000Z",
          "assignedAt": "2026-07-14T01:00:00.000Z",
          "assignedTo": {
            "id": "user_id",
            "username": "tinhlt",
            "fullName": "Lưu Thị Tình",
            "position": "Chuyên viên",
            "email": "tinhlt@langson.gov.vn"
          },
          "assignedDepartment": {
            "id": "department_id",
            "name": "Phòng Kinh tế Xã Thiện Tân",
            "code": "XTT_PKT"
          }
        }
      ]
    },
    "ingestDocuments": {
      "summary": {
        "total": 1778,
        "completed": 120,
        "pending": 1650,
        "deadLetter": 0,
        "failed": 0,
        "updatedLast24h": 50,
        "overdue": 3
      },
      "items": [
        {
          "id": "mongo_id",
          "documentId": "2414250",
          "soDen": "11434",
          "soKyHieu": "1820/UBND-KTTH",
          "trichYeu": "V/v triển khai thực hiện...",
          "donViBanHanh": "UBND Tỉnh Lạng Sơn",
          "ngayDen": "12/07/2026",
          "deadline": null,
          "doKhan": "Hoả tốc",
          "doMat": "Thường",
          "completed": false,
          "deadLetter": false,
          "lastError": "",
          "detailFetchedAt": "2026-07-14T00:00:00.000Z",
          "updatedAt": "2026-07-14T00:00:00.000Z"
        }
      ]
    }
  }
}
```

Gợi ý hiển thị badge:

```js
const overview = await getExtensionOverview(5);
if (!overview.authenticated) {
  // show login state
} else {
  const taskBadge =
    overview.tasks.summary.overdue || overview.tasks.summary.today;
  const ingestBadge = overview.ingestDocuments.summary.pending;
}
```

## Lỗi Chuẩn

Response lỗi thường có dạng:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication cookie is missing."
  }
}
```

Các status extension nên xử lý:

| Status | Ý nghĩa                                  |
| ------ | ---------------------------------------- |
| `401`  | Chưa đăng nhập hoặc cookie hết hạn.      |
| `403`  | User không đủ quyền với dữ liệu yêu cầu. |
| `404`  | Route sai hoặc resource không tồn tại.   |
| `500`  | Lỗi server, nên retry có backoff.        |
