"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Clock } from "lucide-react"
import type { BlogPost } from "@/src/types/blog"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"
import { blogCoverImage } from "@/constants/blog"

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric", month: "short", year: "numeric",
  })
}

function BlogCard({ post, featured = false }: { post: BlogPost; featured?: boolean }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className={`group block rounded-2xl overflow-hidden bg-secondary border border-white/5
        hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 transition-all
        ${featured ? "sm:col-span-2 sm:flex" : ""}`}
    >
      <div className={`relative overflow-hidden bg-white/5 ${featured ? "sm:w-2/5 h-44 sm:h-auto" : "h-40"}`}>
        <img
          src={blogCoverImage(post.coverImage)}
          alt={post.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          onError={e => { (e.target as HTMLImageElement).src = blogCoverImage(null) }}
        />
        <span className="absolute top-2 left-2 bg-primary/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
          {post.category}
        </span>
      </div>
      <div className={`p-4 flex flex-col justify-center space-y-2 ${featured ? "sm:flex-1" : ""}`}>
        <h3 className={`text-white font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors
          ${featured ? "text-base sm:text-lg" : "text-sm"}`}>
          {post.title}
        </h3>
        {post.excerpt && (
          <p className="text-white/50 text-xs line-clamp-2">{post.excerpt}</p>
        )}
        <div className="flex items-center gap-1 text-white/40 text-xs pt-1">
          <Clock className="h-3 w-3" />
          <span>{formatDate(post.publishedAt)}</span>
          {post.authorName && (
            <>
              <span className="mx-1">·</span>
              <span>{post.authorName}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}

function SkeletonCard({ featured = false }: { featured?: boolean }) {
  return (
    <div
      className={`rounded-2xl bg-secondary border border-white/5 animate-pulse
        ${featured ? "sm:col-span-2 h-44" : "h-52"}`}
    />
  )
}

export function BlogPreview() {
  const { settings } = usePlatformSettings()
  const [posts, setPosts]     = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!settings.blogEnabled) return
    fetch("/api/blog?limit=6")
      .then(res => res.json())
      .then(data => setPosts(data.posts ?? []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false))
  }, [settings.blogEnabled])

  if (!settings.blogEnabled) return null

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 bg-primary rounded-full" />
          <h2 className="text-secondary font-bold text-base">From the Blog</h2>
        </div>
        <Link href="/blog" className="flex items-center gap-1 text-primary text-xs font-semibold hover:gap-2 transition-all">
          View All <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonCard featured />
          {[1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : posts.length === 0 ? (
        <p className="text-white/40 text-xs px-1">No blog posts published yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {posts.map((post, i) => (
            <BlogCard key={post.id} post={post} featured={i === 0} />
          ))}
        </div>
      )}
    </section>
  )
}
