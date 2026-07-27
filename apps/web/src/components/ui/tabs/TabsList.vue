<script setup>
import { reactiveOmit } from "@vueuse/core";
import { TabsIndicator, TabsList } from "reka-ui";
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
        'relative inline-flex h-9 items-center justify-center rounded-full bg-muted p-1 text-muted-foreground',
        props.class,
      )
    "
  >
    <TabsIndicator
      class="absolute bottom-1 left-0 top-1 rounded-full transition-[width,transform] duration-200 ease-out"
      style="width: var(--reka-tabs-indicator-size, var(--radix-tabs-indicator-size)); transform: translateX(var(--reka-tabs-indicator-position, var(--radix-tabs-indicator-position)));"
    >
      <div class="h-full w-full rounded-full bg-background shadow-sm"></div>
    </TabsIndicator>
    <slot />
  </TabsList>
</template>
