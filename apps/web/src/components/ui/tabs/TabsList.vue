<script setup>
import { reactiveOmit } from "@vueuse/core";
import { TabsList, TabsIndicator } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  loop: { type: Boolean, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <TabsList
    v-bind="delegatedProps"
    :class="
      cn(
        'relative inline-flex items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
        props.class,
      )
    "
  >
    <TabsIndicator
      class="absolute left-0 top-1 bottom-1 rounded-full transition-all duration-300 ease-out"
      style="width: var(--reka-tabs-indicator-size, var(--radix-tabs-indicator-size)); transform: translateX(var(--reka-tabs-indicator-position, var(--radix-tabs-indicator-position)));"
    >
      <div class="bg-background w-full h-full rounded-full shadow-sm"></div>
    </TabsIndicator>
    <slot />
  </TabsList>
</template>
