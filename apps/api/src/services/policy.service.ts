import fs from 'fs'
import path from 'path'

export const getPrivacyPolicyService = async () => {
  const candidatePaths = [
    path.resolve(process.cwd(), 'policy/PRIVACY_POLICY.md'),
    path.resolve(process.cwd(), '../../policy/PRIVACY_POLICY.md'),
    path.resolve(__dirname, '../../../policy/PRIVACY_POLICY.md'),
    path.resolve(__dirname, '../../../../policy/PRIVACY_POLICY.md'),
    '/home/vmc03/dev/scmager/policy/PRIVACY_POLICY.md',
  ]

  let content = ''
  let foundPath = ''

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      content = fs.readFileSync(p, 'utf-8')
      foundPath = p
      break
    }
  }

  if (!content) {
    throw new Error('PRIVACY_POLICY_NOT_FOUND')
  }

  // Parse title & effective date from markdown
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const dateMatch = content.match(/Ngày hiệu lực:\s*(.+)$/m)

  return {
    data: {
      title: titleMatch ? titleMatch[1].trim() : 'Chính sách quyền riêng tư — eWork Assistant',
      effectiveDate: dateMatch ? dateMatch[1].trim() : '20/07/2026',
      content,
      sourceFile: foundPath,
    },
  }
}
