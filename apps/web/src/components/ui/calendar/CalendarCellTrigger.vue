<script setup>
import { reactiveOmit } from "@vueuse/core";
import { CalendarCellTrigger, useForwardProps } from "reka-ui";
import { cn } from "@/lib/utils";
import { buttonVariants } from '@/components/ui/button';

const props = defineProps({
  day: { type: Object, required: true },
  month: { type: Object, required: true },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});

const delegatedProps = reactiveOmit(props, "class");

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <CalendarCellTrigger
    :class="
      cn(
        buttonVariants({ variant: 'ghost' }),
        'h-8 w-8 p-0 font-normal rounded-full transition-all duration-200',
        '[&[data-today]:not([data-selected])]:bg-zinc-100 [&[data-today]:not([data-selected])]:text-zinc-950 [&[data-today]:not([data-selected])]:font-bold',
        // Selected
        'data-[selected]:bg-zinc-900 data-[selected]:text-zinc-50 data-[selected]:opacity-100 data-[selected]:hover:bg-zinc-900 data-[selected]:hover:text-zinc-50 data-[selected]:focus:bg-zinc-900 data-[selected]:focus:text-zinc-50 data-[selected]:font-semibold',
        // Disabled
        'data-[disabled]:text-muted-foreground data-[disabled]:opacity-50',
        // Unavailable
        'data-[unavailable]:text-destructive-foreground data-[unavailable]:line-through',
        // Outside months
        'data-[outside-view]:text-muted-foreground data-[outside-view]:opacity-30 [&[data-outside-view][data-selected]]:bg-zinc-900/50 [&[data-outside-view][data-selected]]:text-zinc-50',
        props.class,
      )
    "
    v-bind="forwardedProps"
  >
    <slot />
  </CalendarCellTrigger>
</template>
