const ACTION_LABELS = {
  DOCUMENT_CREATED: 'Tạo văn bản',
  DOCUMENT_UPDATED: 'Cập nhật văn bản',
  DOCUMENT_ASSIGNED_TO_DEPARTMENT: 'Giao văn bản cho phòng ban',
  DOCUMENT_ASSIGNED_TO_USER: 'Giao văn bản cho chuyên viên',
  DOCUMENT_ATTACHMENT_ADDED: 'Thêm file đính kèm',
  DOCUMENT_ATTACHMENT_REMOVED: 'Xóa file đính kèm',
  DOCUMENT_COMPLETED: 'Hoàn thành văn bản',
  TASK_CREATED: 'Tạo nhiệm vụ',
  TASK_ASSIGNED: 'Giao nhiệm vụ',
  TASK_REASSIGNED: 'Phân công lại nhiệm vụ',
  TASK_STARTED: 'Bắt đầu xử lý',
  TASK_UPDATED: 'Cập nhật nhiệm vụ',
  TASK_SCHEDULE_UPDATED: 'Cập nhật lịch và thời hạn',
  TASK_REVIEW_SUBMITTED: 'Nộp kết quả để duyệt',
  TASK_REVIEWED: 'Duyệt kết quả nhiệm vụ',
  TASK_CANCELLED: 'Hủy nhiệm vụ',
  TASK_CANCELLED_BY_REASSIGNMENT: 'Đóng nhiệm vụ do phân công lại',
  DEPARTMENT_MEETING_CREATED: 'Tạo lịch họp phòng ban',
}

const FIELD_LABELS = {
  title: 'tiêu đề',
  description: 'mô tả',
  priority: 'độ ưu tiên',
  dueAt: 'hạn hoàn thành',
  estimatedMinutes: 'thời lượng',
  scheduleSegments: 'khung lịch',
  scheduledStartAt: 'giờ bắt đầu',
  scheduledEndAt: 'giờ kết thúc',
  summary: 'tóm tắt',
  sender: 'nơi gửi',
  category: 'loại văn bản',
  issuedAt: 'ngày ban hành',
}

export const auditActionLabel = (action) => ACTION_LABELS[action] ?? action

export const auditActionDetail = (log) => {
  const metadata = log?.metadata ?? {}
  const changedFields = Array.isArray(metadata.changedFields)
    ? metadata.changedFields.map((field) => FIELD_LABELS[field] ?? field)
    : []

  if (changedFields.length) return `Thay đổi ${changedFields.join(', ')}`
  if (log?.action === 'DOCUMENT_ATTACHMENT_ADDED') {
    const category = metadata.category === 'WORK' ? 'công việc' : 'quyết định'
    return `${metadata.count ?? 0} file ${category}`
  }
  if (log?.action === 'DOCUMENT_ATTACHMENT_REMOVED') {
    return metadata.fileName ? `File: ${metadata.fileName}` : ''
  }
  if (log?.action === 'DOCUMENT_ASSIGNED_TO_USER') {
    const count = metadata.targetUserIds?.length ?? 0
    return `${count} chuyên viên, ${metadata.taskIds?.length ?? count} nhiệm vụ`
  }
  if (['TASK_ASSIGNED', 'TASK_REASSIGNED'].includes(log?.action) && metadata.estimatedMinutes) {
    return `Thời lượng dự kiến ${metadata.estimatedMinutes} phút`
  }
  if (log?.action === 'TASK_REVIEWED') {
    return metadata.result === 'APPROVED' ? 'Kết quả: Đã duyệt' : 'Kết quả: Yêu cầu chỉnh sửa'
  }
  if (log?.action === 'TASK_REVIEW_SUBMITTED' && metadata.note) return metadata.note
  if (log?.action === 'DEPARTMENT_MEETING_CREATED' && metadata.startAt) {
    return `Bắt đầu ${new Date(metadata.startAt).toLocaleString('vi-VN')}`
  }
  return ''
}
