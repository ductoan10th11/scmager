export function viewFile(url) {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function downloadFile(url, fileName = 'attachment') {
  if (!url) return
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function formatFileSize(bytes) {
  const value = Number(bytes ?? 0)
  if (value <= 0) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`
  return `${Math.round(value / 1024 / 102.4) / 10} MB`
}

export function fileIconByContentType(contentType = '') {
  const type = String(contentType).toLowerCase()
  if (type.includes('pdf')) return 'PDF'
  if (type.includes('word') || type.includes('document')) return 'DOC'
  if (type.includes('excel') || type.includes('spreadsheet')) return 'XLS'
  if (type.includes('powerpoint') || type.includes('presentation')) return 'PPT'
  if (type.startsWith('image/')) return 'IMG'
  return 'FILE'
}
