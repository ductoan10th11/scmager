<script setup>
import { useRoute } from 'vue-router'
import DepartmentDetailFeature from '@/features/organizations/DepartmentDetailFeature.vue'

const route = useRoute()
const organizationId = route.params.organizationId
const departmentId = route.params.departmentId
</script>

<template>
  <DepartmentDetailFeature
    :organization-id="organizationId"
    :department-id="departmentId"
  />
</template>
