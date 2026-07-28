"use client"
// components/layout/CategoryTabBar.tsx
//
// Sticky horizontal category strip below the navbar — same idea as Shein's
// top nav (New In / Sale / Women / Men / ...). Sits site-wide under Navbar
// so switching categories never requires scrolling back to the top or
// opening the full CategoryGrid. Auto-highlights the active category when
// the user is on /categories/[slug].
//
// Shows only top-level categories (no subcategory nesting — this app's
// taxonomy is intentionally flat, see constants/categories.ts).

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useRef } from "react"
import { HOMEPAGE_CATEGORIES } from "@/constants/categories"
import { cn } from "@/lib/utils"

export function CategoryTabBar() {
  const pathname = usePathname()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Active slug comes straight from the URL — /categories/fashion -> "fashion"
  const activeSlug = pathname.startsWith("/categories/")
    ? pathname.split("/categories/")[1]?.split("/")[0]
    : null

  return (
    <div className="sticky top-16 z-40 bg-white border-b border-border/50 shadow-sm">
      <div
        ref={scrollRef}
        className="container flex items-center gap-1 overflow-x-auto py-2.5 no-scrollbar"
      >
        {HOMEPAGE_CATEGORIES.map(cat => {
          const isActive = cat.slug === activeSlug
          return (
            <Link
              key={cat.id}
              href={`/categories/${cat.slug}`}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-secondary hover:bg-muted"
              )}
            >
              {cat.name}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
