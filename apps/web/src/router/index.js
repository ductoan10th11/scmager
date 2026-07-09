import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/features/auth/composables/useAuth'
import LandingPage from '../pages/LandingPage.vue'
import LoginPage from '../pages/LoginPage.vue'
import DashboardPage from '../pages/DashboardPage.vue'
import SchedulePage from '../pages/SchedulePage.vue'
import AssignmentPage from '../pages/AssignmentPage.vue'
import MainLayout from '../layouts/MainLayout.vue'
import {
  DocumentsPage,
  NotificationsPage,
  OrganizationDepartmentsPage,
  DepartmentDetailPage,
  MyDepartmentPage,
  OrganizationsPage,
  SettingsPage,
  TaskDetailPage,
  TasksPage,
  UsersPage,
} from './page-loaders'

const routes = [
  {
    path: '/',
    name: 'Landing',
    component: LandingPage,
    meta: { public: true },
  },
  {
    path: '/login',
    name: 'Login',
    component: LoginPage,
    meta: { public: true },
  },
  {
    path: '/',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: DashboardPage,
        meta: { requiresAuth: true },
      },
      {
        path: 'schedule',
        name: 'Schedule',
        component: SchedulePage,
        meta: { requiresAuth: true, roles: ['COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
      },
      {
        path: 'assignments',
        name: 'Assignments',
        component: AssignmentPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER'] },
      },
      {
        path: 'assignment',
        redirect: '/assignments',
      },
      {
        path: 'users',
        name: 'Users',
        component: UsersPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF'] },
      },
      {
        path: 'organizations',
        name: 'Organizations',
        component: OrganizationsPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'] },
      },
      {
        path: 'organizations/:organizationId',
        redirect: (to) => `/organizations/${to.params.organizationId}/departments`,
      },
      {
        path: 'organizations/:organizationId/departments',
        name: 'OrganizationDepartments',
        component: OrganizationDepartmentsPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'] },
      },
      {
        path: 'organizations/:organizationId/departments/:departmentId',
        name: 'DepartmentDetail',
        component: DepartmentDetailPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER'] },
      },
      {
        path: 'my-department',
        name: 'MyDepartment',
        component: MyDepartmentPage,
        meta: { requiresAuth: true, roles: ['DEPARTMENT_LEADER'] },
      },
      {
        path: 'tasks',
        name: 'Tasks',
        component: TasksPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
      },
      {
        path: 'tasks/:taskId',
        name: 'TaskDetail',
        component: TaskDetailPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
      },
      {
        path: 'documents',
        name: 'Documents',
        component: DocumentsPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER'] },
      },
      {
        path: 'notifications',
        name: 'Notifications',
        component: NotificationsPage,
        meta: { requiresAuth: true },
      },
      {
        path: 'settings',
        name: 'Settings',
        component: SettingsPage,
        meta: { requiresAuth: true },
      },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const { user, loadMe } = useAuth()
  const currentUser = to.path === '/login'
    ? await loadMe({ force: true }).catch(() => null)
    : user.value || await loadMe().catch(() => null)

  if (!to.meta.requiresAuth) {
    if (to.path === '/login' && currentUser) return '/dashboard'
    return true
  }

  if (!currentUser) return { path: '/login', query: { redirect: to.fullPath } }

  const allowedRoles = to.meta.roles
  if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
    const roleCode = currentUser.role?.code
    if (!allowedRoles.includes(roleCode)) return '/dashboard'
  }

  return true
})
