<script setup>
import { useAuth } from '@/features/auth/composables/useAuth'
import OrganizationsFeature from '@/features/organizations/OrganizationsFeature.vue'
import OrganizationDepartmentsFeature from '@/features/organizations/OrganizationDepartmentsFeature.vue'

const { user: currentUser } = useAuth()
</script>

<template>
  <OrganizationsFeature v-if="currentUser?.role?.code === 'ADMIN'" />
  <OrganizationDepartmentsFeature v-else />
</template>
