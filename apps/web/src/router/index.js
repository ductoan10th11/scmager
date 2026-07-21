import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/features/auth/composables/useAuth'
import LandingPage from '../pages/LandingPage.vue'
import LoginPage from '../pages/LoginPage.vue'
import ExtensionWebViewPage from '../pages/ExtensionWebViewPage.vue'
import DashboardPage from '../pages/DashboardPage.vue'
import MainLayout from '../layouts/MainLayout.vue'
import {
  DocumentsPage,
  OutgoingDocumentsPage,
  IngestDocumentsPage,
  IngestMonitorPage,
  OrganizationDepartmentsPage,
  DepartmentDetailPage,
  MyDepartmentPage,
  OrganizationsPage,
  SettingsPage,
  AssignmentPage,
  PerformancePage,
  UsersPage,
  PrivacyPolicyPage,
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
    path: '/extension',
    name: 'ExtensionWebView',
    component: ExtensionWebViewPage,
    meta: { public: true },
  },
  {
    path: '/privacy-policy',
    name: 'PrivacyPolicy',
    component: PrivacyPolicyPage,
    meta: { public: true },
  },
  {
    path: '/privacy',
    redirect: '/privacy-policy',
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
        redirect: '/assignments',
      },
      {
        path: 'assignments',
        name: 'Assignments',
        component: AssignmentPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
      },
      {
        path: 'performance',
        name: 'Performance',
        component: PerformancePage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
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
        path: 'work-declarations',
        name: 'WorkDeclarations',
        redirect: '/assignments',
      },
      {
        path: 'work-declarations/:workDeclarationId',
        name: 'WorkDeclarationDetail',
        redirect: '/assignments',
      },
      {
        path: 'tasks/:taskId?',
        redirect: '/assignments',
      },
      {
        path: 'documents',
        name: 'Documents',
        component: DocumentsPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
      },
      {
        path: 'outgoing-documents',
        name: 'OutgoingDocuments',
        component: OutgoingDocumentsPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
      },
      {
        path: 'documents/:documentId',
        name: 'DocumentDetail',
        component: DocumentsPage,
        meta: { requiresAuth: true, roles: ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST'] },
      },
      {
        path: 'ingest-documents',
        name: 'IngestDocuments',
        component: IngestDocumentsPage,
        meta: { requiresAuth: true, roles: ['ADMIN'] },
      },
      {
        path: 'ingest-monitor',
        name: 'IngestMonitor',
        component: IngestMonitorPage,
        meta: { requiresAuth: true, roles: ['ADMIN'] },
      },
      {
        path: 'notifications',
        name: 'Notifications',
        redirect: '/dashboard',
      },
      {
        path: 'reports',
        name: 'Reports',
        redirect: '/dashboard',
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
