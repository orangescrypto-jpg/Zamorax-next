"use client"

import { AdminService, orderBy, limit } from "@/src/services"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Search, MapPin, ChevronRight, ShieldCheck, Zap, BadgeCheck, Layers } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/useAuth"
import { nigerianStates } from "@/constants/nigerianStates"
import { useEffect } from "react"

export function Hero() {
  const router = useRouter()
  const { isAuthenticated, isSeller } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedState, setSelectedState] = useState("all")
  const [trending, setTrending] = useState<string[]>([])

  useEffect(() => {
    async function fetchTrending() {
      try {
        const snap = await AdminService.getCollection("searchTrends", [orderBy("count", "desc"), limit(5)])
        const terms = snap.map((d: any) => d.term as string).filter(Boolean)
        setTrending(terms)
      } catch {
        // silently fail — no trending shown if Firestore unavailable
      }
    }
    fetchTrending()
  }, [])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams()
    if (searchQuery) params.set("q", searchQuery)
    if (selectedState !== "all") params.set("state", selectedState)

    // Log search term to Firestore for trending
    if (searchQuery.trim()) {
      try {
        const { increment } = await import("@/src/services")
        const termKey = searchQuery.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 40)
        await AdminService.updateDoc("searchTrends", termKey, {
          term: searchQuery.trim(),
          count: increment(1),
          updatedAt: new Date()
        })
      } catch { /* non-critical */ }
    }

    router.push(`/search?${params.toString()}`)
  }

  const handleSell = () => {
    // ✅ FIX: matches the homepage "Start Selling Free" CTA — sellers land
    // on their dashboard, not straight into the post form.
    if (!isAuthenticated()) router.push("/register")
    else if (isSeller()) router.push("/dashboard/seller")
    else router.push("/dashboard/become-seller")
  }

  return (
    <section className="relative overflow-hidden bg-secondary">
      {/* Geometric background pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-1/2 -left-32 w-64 h-64 rounded-full bg-accent/10 blur-2xl" />
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)`,
            backgroundSize: "32px 32px",
          }}
        />
      </div>

      <div className="relative container py-8 md:py-14">
        {/* B2B/B2C bulk pricing pill — sellers can offer bulk pricing,
            buyers (individuals or businesses) can buy in bulk at lower
            per-unit rates. Sits above the headline so it doesn't compete
            with "Zero Wahala" but still gets first-glance visibility. */}
        <div className="flex justify-center mb-5 md:justify-start">
          <span className="inline-flex items-center gap-1.5 bg-white/10 text-white/90 text-xs font-medium px-3 py-1.5 rounded-full border border-white/20">
            <Layers className="h-3.5 w-3.5 text-accent" />
            Buy & Sell in Bulk For Individuals & Businesses
          </span>
        </div>

        {/* Search card */}
        <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-2xl p-2 max-w-2xl mx-auto md:mx-0">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search phones, laptops, fashion..."
                className="pl-9 h-11 border-none focus-visible:ring-0 bg-muted/40 rounded-xl text-sm"
              />
            </div>
            <div className="relative sm:w-40">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
              <Select value={selectedState} onValueChange={setSelectedState}>
                <SelectTrigger className="pl-9 h-11 border-none bg-muted/40 rounded-xl text-sm focus:ring-0">
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Nigeria</SelectItem>
                  {nigerianStates.map(state => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="h-11 px-6 bg-primary hover:bg-primary/90 text-white rounded-xl font-semibold shrink-0">
              Search
            </Button>
          </div>
          {/* Trending — only shown once search data exists */}
          {trending.length > 0 && (
            <div className="flex items-center gap-2 px-1 pt-2 pb-1 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-medium">Trending:</span>
              {trending.map(term => (
                <button
                  key={term}
                  type="button"
                  onClick={() => router.push(`/search?q=${encodeURIComponent(term)}`)}
                  className="text-[11px] text-primary font-medium hover:underline"
                >
                  {term}
                </button>
              ))}
            </div>
          )}
        </form>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mt-5 max-w-sm mx-auto md:mx-0">
          <Button
            onClick={() => router.push("/search")}
            variant="outline"
            className="flex-1 h-11 border-white/20 text-white bg-white/10 hover:bg-white/20 hover:text-white rounded-xl font-medium"
          >
            Browse All <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
          <Button onClick={handleSell} className="flex-1 h-11 bg-primary hover:bg-primary/90 text-white rounded-xl font-semibold">
            <Zap className="mr-1.5 h-4 w-4" />
            Post Free Ad
          </Button>
        </div>

        {/* Trust stats */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 justify-center md:justify-start">
          {[
            { icon: <BadgeCheck className="h-4 w-4 text-accent" />, label: "NIN Verified Sellers" },
            { icon: <ShieldCheck className="h-4 w-4 text-primary" />, label: "Escrow Protected" },
            { icon: <Zap className="h-4 w-4 text-yellow-400" />, label: "Free 24hr Inspection" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 text-white/70 text-xs">
              {item.icon}<span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
