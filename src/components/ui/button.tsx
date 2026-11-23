import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const styles = cva("inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45", {
  variants: { variant: { default: "bg-primary text-primary-foreground hover:bg-primary/90", secondary: "border border-border bg-card text-foreground hover:bg-muted", ghost: "text-muted-foreground hover:bg-muted hover:text-foreground", danger: "bg-destructive text-white hover:bg-destructive/90", accent: "bg-accent text-accent-foreground hover:bg-accent/90" }, size: { default: "", sm: "min-h-9 px-2.5 text-xs", icon: "h-10 w-10 px-0" } }, defaultVariants: { variant: "default", size: "default" }
});
type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof styles>;
export function Button({ className, variant, size, ...props }: Props) { return <button className={cn(styles({ variant, size }), className)} {...props} />; }
