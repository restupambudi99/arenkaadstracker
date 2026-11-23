import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
export function Card(props: HTMLAttributes<HTMLDivElement>) { return <section {...props} className={cn("rounded-lg border border-border bg-card", props.className)} />; }
