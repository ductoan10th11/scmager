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
export const TasksPage = lazyPage(() => import('../pages/TasksPage.vue'))
export const TaskDetailPage = lazyPage(() => import('../pages/TaskDetailPage.vue'))
export const DocumentsPage = lazyPage(() => import('../pages/DocumentsPage.vue'))
export const NotificationsPage = lazyPage(() => import('../pages/NotificationsPage.vue'))
export const SettingsPage = lazyPage(() => import('../pages/SettingsPage.vue'))

export const MyDepartmentPage = lazyPage(() => import('../pages/MyDepartmentPage.vue'))

const preloadableRouteComponents = {
  '/users': UsersPage,
  '/organizations': OrganizationsPage,
  '/organizations/:organizationId/departments': OrganizationDepartmentsPage,
  '/organizations/:organizationId/departments/:departmentId': DepartmentDetailPage,
  '/my-department': MyDepartmentPage,
  '/tasks': TasksPage,
  '/tasks/:taskId': TaskDetailPage,
  '/documents': DocumentsPage,
  '/notifications': NotificationsPage,
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
