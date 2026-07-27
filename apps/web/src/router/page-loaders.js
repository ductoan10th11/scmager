const lazyPage = (loader) => {
  let promise = null
  return () => {
    promise ||= loader().catch((error) => {
      promise = null
      throw error
    })
    return promise
  }
}

export const UsersPage = lazyPage(() => import('../pages/UsersPage.vue'))
export const OrganizationsPage = lazyPage(() => import('../pages/OrganizationsPage.vue'))
export const OrganizationDepartmentsPage = lazyPage(() => import('../pages/OrganizationDepartmentsPage.vue'))
export const DepartmentDetailPage = lazyPage(() => import('../pages/DepartmentDetailPage.vue'))
export const AssignmentPage = lazyPage(() => import('../pages/AssignmentPage.vue'))
export const PerformancePage = lazyPage(() => import('../pages/PerformancePage.vue'))
export const OfficeDocumentsPage = lazyPage(() => import('../pages/OfficeDocumentsPage.vue'))
export const IngestMonitorPage = lazyPage(() => import('../pages/IngestMonitorPage.vue'))
export const ConnectorsPage = lazyPage(() => import('../pages/ConnectorsPage.vue'))
export const SettingsPage = lazyPage(() => import('../pages/SettingsPage.vue'))

export const MyDepartmentPage = lazyPage(() => import('../pages/MyDepartmentPage.vue'))
export const PrivacyPolicyPage = lazyPage(() => import('../pages/PrivacyPolicyPage.vue'))
export const ExtensionWebViewPage = lazyPage(() => import('../pages/ExtensionWebViewPage.vue'))

const preloadableRouteComponents = {
  '/users': UsersPage,
  '/organizations': OrganizationsPage,
  '/organizations/:organizationId/departments': OrganizationDepartmentsPage,
  '/organizations/:organizationId/departments/:departmentId': DepartmentDetailPage,
  '/my-department': MyDepartmentPage,
  '/assignments': AssignmentPage,
  '/performance': PerformancePage,
  '/office-documents': OfficeDocumentsPage,
  '/ingest-monitor': IngestMonitorPage,
  '/connectors': ConnectorsPage,
  '/settings': SettingsPage,
}

export const preloadRouteComponent = (path) => {
  const loader = preloadableRouteComponents[path]
  return loader ? loader().catch(() => null) : Promise.resolve(null)
}

export const preloadProtectedRouteComponents = () => {
  return Promise.all(
    Object.values(preloadableRouteComponents).map((loader) => loader().catch(() => null))
  )
}
