# Frontend API Endpoints

Frontend gọi API bằng relative path `/api/...`.

Vite dev server đã proxy:

```text
/api -> http://localhost:8004
```

Auth dùng 1 cookie HTTP-only tên `scmager_session`. Frontend chỉ cần gọi API cùng origin qua Vite proxy. Nếu gọi trực tiếp backend khác origin thì thêm `credentials: 'include'`.

## Health Check

```http
GET /api/ping
```

Response:

```json
{ "message": "pong" }
```

## Default Admin

```text
username: admin
password: 0
roleCode: ADMIN
```

Không tạo thêm user với `roleCode: "ADMIN"`.

## Auth

### Login

```http
POST /api/auth/me
Content-Type: application/json
```

Request:

```json
{
  "login": "admin",
  "password": "0",
  "remember": false
}
```

`login` có thể là `username` hoặc `email`. Có thể gửi `username`/`email` thay cho `login`.

Session:

```text
remember=false hoặc không gửi: 24h
remember=true: 14 ngày
```

JWT trong cookie chỉ ký:

```text
id, email, exp
```

Response:

```json
{
  "data": {
    "user": {
      "_id": "66f...",
      "username": "admin",
      "fullName": "System Admin",
      "email": "admin@scmager.local",
      "role": {
        "_id": "66f...",
        "code": "ADMIN",
        "name": "Quản trị hệ thống",
        "level": 0
      },
      "status": "ACTIVE"
    },
    "expiresAt": "2026-07-08T00:00:00.000Z"
  }
}
```

### Logout

```http
DELETE /api/auth/me
```

Response:

```http
204 No Content
```

### Me

```http
GET /api/auth/me
```

Response:

```json
{
  "data": {
    "authenticated": true,
    "user": {
      "_id": "66f...",
      "username": "admin",
      "fullName": "System Admin",
      "email": "admin@scmager.local",
      "role": {
        "_id": "66f...",
        "code": "ADMIN",
        "name": "Quản trị hệ thống",
        "level": 0
      },
      "status": "ACTIVE"
    }
  }
}
```

Nếu chưa login hoặc cookie hết hạn:

```http
401 Unauthorized
```

## User Fields

`User.status`:

```text
ACTIVE | INACTIVE | SUSPENDED
```

`roleCode` khi tạo/sửa user:

```text
OFFICE_CHIEF | COMMUNE_LEADER | DEPARTMENT_LEADER | SPECIALIST
```

User CRUD yêu cầu đã login.

Rule quyền:

```text
- User chỉ tự sửa được fullName và password.
- Muốn xem/sửa/xóa user khác thì role hiện tại phải có level cao hơn target.
- Số level càng nhỏ thì quyền càng cao. ADMIN level 0.
- Không thao tác được user có role ngang cấp hoặc cao hơn.
- Không tạo thêm ADMIN.
- Không xóa/deactivate system admin.
```

## List Users

```http
GET /api/users
```

Query params:

| Param | Type | Note |
| --- | --- | --- |
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `100` |
| `search` | string | Search `username`, `fullName`, `email`, `phone` |
| `status` | string | `ACTIVE`, `INACTIVE`, `SUSPENDED` |
| `role` | string | Role ObjectId |
| `organization` | string | Organization ObjectId |
| `department` | string | Department ObjectId |

Example:

```http
GET /api/users?page=1&limit=20&search=nguyen&status=ACTIVE
```

Response:

```json
{
  "data": [
    {
      "_id": "66f...",
      "username": "nguyenvana",
      "fullName": "Nguyễn Văn A",
      "email": "nguyenvana@scmager.local",
      "phone": "0900000000",
      "avatarUrl": "https://...",
      "role": {
        "_id": "66f...",
        "code": "SPECIALIST",
        "name": "Chuyên viên",
        "level": 4
      },
      "organization": null,
      "department": null,
      "manager": null,
      "status": "ACTIVE",
      "isSystemAdmin": false,
      "notificationSettings": {
        "inApp": true,
        "email": false,
        "push": true
      },
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

## Get User

```http
GET /api/users/:id
```

Response:

```json
{
  "data": {
    "_id": "66f...",
    "username": "nguyenvana",
    "fullName": "Nguyễn Văn A",
    "email": "nguyenvana@scmager.local",
    "role": {
      "_id": "66f...",
      "code": "SPECIALIST",
      "name": "Chuyên viên",
      "level": 4
    },
    "status": "ACTIVE"
  }
}
```

## Create User

```http
POST /api/users
Content-Type: application/json
```

Request:

```json
{
  "username": "nguyenvana",
  "fullName": "Nguyễn Văn A",
  "email": "nguyenvana@scmager.local",
  "password": "123456",
  "phone": "0900000000",
  "avatarUrl": "https://i.pravatar.cc/150?u=nguyenvana",
  "roleCode": "SPECIALIST",
  "organization": "66f...",
  "department": "66f...",
  "manager": "66f...",
  "status": "ACTIVE",
  "notificationSettings": {
    "inApp": true,
    "email": false,
    "push": true
  }
}
```

Required:

```text
username, fullName, email, password
```

Response:

```http
201 Created
```

```json
{
  "data": {
    "_id": "66f...",
    "username": "nguyenvana",
    "fullName": "Nguyễn Văn A",
    "email": "nguyenvana@scmager.local",
    "role": {
      "_id": "66f...",
      "code": "SPECIALIST",
      "name": "Chuyên viên",
      "level": 4
    },
    "status": "ACTIVE"
  }
}
```

## Update User

```http
PATCH /api/users/:id
Content-Type: application/json
```

`PUT /api/users/:id` cũng được hỗ trợ.

Request body là partial:

```json
{
  "fullName": "Nguyễn Văn A Updated",
  "phone": "0911111111",
  "roleCode": "DEPARTMENT_LEADER",
  "department": "66f..."
}
```

Đổi mật khẩu:

```json
{ "password": "new-password" }
```

Response:

```json
{
  "data": {
    "_id": "66f...",
    "username": "nguyenvana",
    "fullName": "Nguyễn Văn A Updated",
    "status": "ACTIVE"
  }
}
```

## Delete User

```http
DELETE /api/users/:id
```

Backend soft delete user sang `INACTIVE`.

Response:

```http
204 No Content
```

## Error Response

```json
{
  "error": {
    "message": "User not found.",
    "details": {}
  }
}
```

Common status:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
500 Internal Server Error
```
