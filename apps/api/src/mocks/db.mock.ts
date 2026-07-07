export const mockRoles = [
  {
    _id: 'role_0',
    name: 'superadmin',
    level: 0,
  },
  {
    _id: 'role_1',
    name: 'manager',
    level: 1,
  },
  {
    _id: 'role_2',
    name: 'leader',
    level: 2,
  },
  {
    _id: 'role_3',
    name: 'staff',
    level: 3,
  },
];

export const mockOrganizations = [
  {
    _id: 'org_01',
    name: 'UBND Huyện A',
    level: 'DISTRICT',
  },
  {
    _id: 'org_02',
    name: 'UBND Xã B',
    level: 'COMMUNE',
    parentId: 'org_01',
  },
];

export const mockDepartments = [
  {
    _id: 'dept_01',
    orgId: 'org_02',
    name: 'Văn phòng HĐND - UBND',
    description: 'Tiếp nhận văn bản, phân bổ công việc tổng',
  },
  {
    _id: 'dept_02',
    orgId: 'org_02',
    name: 'Bộ phận Địa chính - Xây dựng',
    description: 'Xử lý hồ sơ đất đai, cấp phép xây dựng',
  },
];

export const mockUsers = [
  {
    _id: 'usr_sa01',
    fullName: 'Trần Admin',
    email: 'admin@scmager.local',
    roleId: 'role_0',
    orgId: null,
    departmentId: null,
  },
  {
    _id: 'usr_ld01',
    fullName: 'Nguyễn Lãnh Đạo',
    email: 'chu_tich@scmager.local',
    roleId: 'role_1',
    orgId: 'org_02',
    departmentId: null,
  },
  {
    _id: 'usr_cvp01',
    fullName: 'Trần Chánh Văn Phòng',
    email: 'cvp@scmager.local',
    roleId: 'role_2',
    orgId: 'org_02',
    departmentId: 'dept_01',
  },
  {
    _id: 'usr_cv01',
    fullName: 'Phạm Chuyên Viên',
    email: 'chuyenvien_diachinh@scmager.local',
    roleId: 'role_3',
    orgId: 'org_02',
    departmentId: 'dept_02',
  },
];

export const mockTasks = [
  {
    _id: 'task_01',
    title: 'Họp giao ban UBND Huyện',
    type: 'INVITATION',
    description: 'Tham gia họp tổng kết quý. Chuẩn bị báo cáo tài chính.',
    documentId: '1234/UBND-VP',
    assignedTo: 'usr_ld01',
    assignedBy: 'usr_cvp01',
    startDate: '2026-07-05T08:00:00Z',
    dueDate: '2026-07-05T11:00:00Z',
    status: 'IN_PROGRESS',
    isOverdue: false,
  },
  {
    _id: 'task_02',
    title: 'Xử lý khiếu nại tranh chấp đất đai hộ ông A',
    type: 'DEADLINE',
    description: 'Xuống hiện trường đo đạc lại mốc giới.',
    assignedTo: 'usr_cv01',
    assignedBy: 'usr_cvp01',
    dueDate: '2026-07-10T17:00:00Z',
    status: 'TODO',
    isOverdue: false,
  },
];

export const mockTimesheets = [
  {
    _id: 'ts_01',
    userId: 'usr_cv01',
    date: '2026-07-05',
    totalEstimatedHours: 8,
    status: 'PENDING_REVIEW',
    records: [
      {
        taskId: 'task_02',
        title: 'Xử lý khiếu nại tranh chấp đất đai hộ ông A',
        estimatedHours: 5,
        actualHours: 0,
        note: 'Xuống địa bàn buổi sáng',
      },
      {
        taskId: null, 
        title: 'Trực tiếp công dân tại một cửa',
        estimatedHours: 3,
        actualHours: 0,
        note: 'Xử lý thủ tục hành chính',
      },
    ],
  },
];
