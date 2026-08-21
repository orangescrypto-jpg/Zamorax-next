"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Clock, Tag, Search, ChevronRight, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { BlogService } from "@/src/services/blog"
import type { BlogPost } from "@/src/types/blog"
import { blogCoverImage } from "@/constants/blog"

const CATEGORIES = [
  "All", "News", "Tips & Guides", "Safety", "Seller Stories",
  "Product Updates", "Market Trends", "How It Works",
]

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric", month: "short", year: "numeric",
  })
}

function PostCard({ post, featured = false }: { post: BlogPost; featured?: boolean }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className={`group block rounded-2xl overflow-hidden bg-white border border-gray-200
        hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 transition-all
        ${featured ? "md:col-span-2 md:flex" : ""}`}
    >
      <div className={`relative overflow-hidden bg-gray-100 ${featured ? "md:w-2/5 h-52 md:h-auto" : "h-44"}`}>
        <img src={blogCoverImage(post.coverImage)} alt={post.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          onError={e => { (e.target as HTMLImageElement).src = blogCoverImage(null) }} />
        <span className="absolute top-3 left-3 bg-primary/90 text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
          {post.category}
        </span>
      </div>
      <div className={`p-5 flex flex-col justify-center space-y-3 ${featured ? "md:flex-1" : ""}`}>
        <h2 className={`text-gray-900 font-bold leading-snug group-hover:text-primary transition-colors line-clamp-2
          ${featured ? "text-xl md:text-2xl" : "text-base"}`}>
          {post.title}
        </h2>
        {post.excerpt && (
          <p className="text-gray-500 text-sm line-clamp-2">{post.excerpt}</p>
        )}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5 text-gray-400 text-xs">
            <Clock className="h-3 w-3" />
            <span>{formatDate(post.publishedAt)}</span>
            <span className="mx-1">·</span>
            <span>{post.authorName}</span>
          </div>
          <ChevronRight className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </Link>
  )
}

export default function BlogPage() {
  const [allPosts, setAllPosts]   = useState<BlogPost[]>([])
  const [loading, setLoading]     = useState(true)
  const [category, setCategory]   = useState("All")
  const [search, setSearch]       = useState("")
  const [searchInput, setSearchInput] = useState("")

  useEffect(() => {
    fetch("/api/blog?limit=50")
      .then(res => res.json())
      .then(data => setAllPosts(data.posts ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const displayed = allPosts
    .filter(p => category === "All" || p.category === category)
    .filter(p => !search || 
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.excerpt?.toLowerCase().includes(search.toLowerCase())
    )

  return (
    <main className="container py-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900">Zamorax Blog</h1>
        <p className="text-gray-500 text-sm">Tips, guides, and news to help you buy and sell smarter.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") setSearch(searchInput) }}
          placeholder="Search articles…"
          className="pl-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 rounded-xl"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => { setCategory(cat); setSearch(""); setSearchInput("") }}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all
              ${category === cat ? "bg-primary text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200"}`}>
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-2xl bg-gray-100 border border-gray-200 h-52 animate-pulse" />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Tag className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No articles found</p>
          <p className="text-sm mt-1">Try a different category or search term</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {displayed.map((post, i) => (
            <PostCard key={post.id} post={post} featured={i === 0} />
          ))}
        </div>
      )}
    </main>
  )
}
