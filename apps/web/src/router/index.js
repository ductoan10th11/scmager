import { createRouter, createWebHistory } from 'vue-router'
import LandingPage from '../pages/LandingPage.vue'
import DashboardPage from '../pages/DashboardPage.vue'
import SchedulePage from '../pages/SchedulePage.vue'
import TaskPage from '../pages/TaskPage.vue'
import MainLayout from '../layouts/MainLayout.vue'

const routes = [
  {
    path: '/',
    name: 'Landing',
    component: LandingPage,
  },
  {
    path: '/',
    component: MainLayout,
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: DashboardPage,
      },
      {
        path: 'schedule',
        name: 'Schedule',
        component: SchedulePage,
      },
      {
        path: 'task',
        name: 'Task',
        component: TaskPage,
      },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
