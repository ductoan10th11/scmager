export class ApiError extends Error {
  constructor(message, { status, details } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export async function http(endpoint, options = {}) {
  const { body, headers, ...rest } = options
  const config = {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    ...rest,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  }

  if (body !== undefined) {
    config.body = JSON.stringify(body)
  }

  const response = await fetch(endpoint, config)
  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    throw new ApiError(payload?.error?.message || payload?.message || response.statusText, {
      status: response.status,
      details: payload?.error?.details,
    })
  }

  if (response.status === 204) return null
  return payload
}
